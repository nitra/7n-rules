# Заміна `withTmpCwd` на `withTmpDir` та policy-guards проти `process.chdir` у тестах

**Status:** Accepted
**Date:** 2026-05-27

## Context and Problem Statement

Хелпер `withTmpCwd` у `npm/scripts/utils/test-helpers.mjs` мутував глобальний `process.cwd()` через `process.chdir()`. При дефолтному `pool: 'threads'` у Vitest кілька тестових файлів виконувались в одному процесі паралельно. Тести `changelog/consistency` викликали `git init`/`git commit -m init`/`git checkout -b feat/x` усередині `withTmpCwd` — race між `process.chdir` перенаправляла git-операції у реальний репозиторій, створюючи rogue commits (Author: `test <test@test>`) і гілки (`feat/x`, `feat/docs`, `feat/sync`), що знищували `npm/CHANGELOG.md`, `npm/package.json` та інші файли (2350+ deletions). Stryker `@stryker-mutator/vitest-runner` запускає Vitest inline у своєму процесі та ігнорує `pool` із `vitest.config.js`, тому симптоматичний фікс через `pool: 'forks'` не захищав від race при `bunx stryker run`. Окремі тести також використовували relative-path аргументи у FS-функціях (`copyFile(src, 'values-dev.ini')`), що писало у `process.cwd()` і залишало артефакти в `npm/`.

## Considered Options

- Варіант А: окремий `vitest.stryker.config.js` із `include` тільки для `rules/test/coverage/tests/**` — Stryker не бачить git-тестів (симптоматично)
- Варіант Б: встановити `pool: 'forks'` у `vitest.config.js` — ізолює процеси при прямому запуску vitest, але ігнорується Stryker inline-runner
- Варіант В: повне видалення `withTmpCwd`, заміна на `withTmpDir(async dir => …)` без `process.chdir`; policy-guards у `npm/rules/test/` проти повторення

## Decision Outcome

Chosen option: "Варіант В — повний refactor `withTmpCwd → withTmpDir` плюс policy-guards", because `process.chdir` є process-wide операцією, несумісною з будь-яким паралельним запуском (Vitest threads, Stryker inline, майбутні воркер-пули); симптоматичні фікси не захищали б від нових race-умов при розширенні `mutate`-цілей Stryker. Policy-guards поширюють захист на всі проєкти-споживачі через `npx @nitra/cursor fix test`.

### Consequences

- Good, because `bun run coverage` і `bunx stryker run` більше не створюють rogue commits або branches — HEAD стабільний після повного прогону; 1200 тестів проходять.
- Good, because три нові JS concerns (`no-process-chdir`, `vitest-config-pool-forks`, `no-relative-fs-path`) захищають усі проєкти-споживачі через `npx @nitra/cursor fix test`; canonical `vitest.config.baseline.js` оновлено — нові проєкти race-safe з коробки.
- Bad, because mutation score `rules/test/coverage/coverage.mjs` знизився з 98.58% до 93.62%: stub-стратегія `installCoverageFixStub`, що досягала гілки `if (opts.fix)` у `L189–L192`, видалена; гілка вимагає end-to-end CLI-тесту з реальним `@nitra/cursor coverage --fix`.
- Bad, because `withTmpCwd` — breaking API change: версія bumped до `1.28.0`; 43 тестові файли переписані на явні `join(dir, …)` і `cwd: dir`; 24 production-функції (`check`/`fix` у `rules/*/js/*.mjs`) отримали `cwd` параметр зі значенням за замовчуванням `process.cwd()`.

## More Information

- `npm/scripts/utils/test-helpers.mjs` — `withTmpCwd` видалено, додано `withTmpDir(fn)`; docstring оновлено з попередженням про небезпеку `process.chdir` у будь-якому pool
- `npm/vitest.config.js` — `pool: 'forks'` залишено як defense-in-depth
- `npm/rules/test/js/no-process-chdir.mjs` — regex-сканер `process.chdir(` у `*.test.{js,mjs}`
- `npm/rules/test/js/tests/no-process-chdir.test.mjs` — 8 unit-тестів (happy path, multi-match, `*.test.js`, порожній проєкт тощо)
- `npm/rules/test/js/vitest-config-pool-forks.mjs` — перевіряє `pool: 'forks'` у `vitest.config.js`; падає якщо файл відсутній або `pool` не `'forks'`
- `npm/rules/test/js/tests/vitest-config-pool-forks.test.mjs` — 6 unit-тестів
- `npm/rules/test/js/no-relative-fs-path.mjs` — AST-сканер (oxc-parser) relative-path аргументів у FS-функціях у тестах
- `npm/rules/test/js/data/vitest_config/vitest.config.baseline.js` — `pool: 'forks'` додано до canonical baseline
- `npm/rules/test/test.mdc` — секція «Заборона `process.chdir` у тестах» із поясненням механізму race і посиланням на `pool: 'forks'`
- Виправлено source bug: `npm/rules/test/coverage/coverage.mjs:192` — dynamic import шлях `../../scripts/coverage-fix.mjs` → `../../../scripts/coverage-fix.mjs`; stub `installCoverageFixStub` видалено з тестів (маскував pre-existing bug)
- Rogue branches зафіксовані у transcript: `feat/x`, `feat/docs`, `feat/sync`; rogue author: `test <test@test>`; rogue commit: `c3f1b94 init`
- Версія: `1.27.9 → 1.28.0` (BREAKING: `withTmpCwd` видалено з публічного API `test-helpers.mjs`)
- Команди перевірки: `bun run test` (1200 passed), `bunx @stryker-mutator/core run` (93.62% mutation score, no rogue commits)

## Update 2026-05-27

Під час генерації тестів для `rules/test/coverage/coverage.mjs` виявлено, що `runCoverageSteps` вже приймає `opts.cwd ?? process.cwd()`, тому `process.chdir(tmp)` у setup-хелпері є зайвим навіть для функцій, які підтримують explicit `cwd`. Спроба `process.chdir(tmp)` у `beforeEach`/`afterEach` при паралельному запуску vitest призвела до непрошеного `git commit` у реальному репо — для відновлення: `git reset --mixed HEAD~1` + `git restore` для трьох пошкоджених файлів. Це підтвердило необхідність явної передачі `cwd` параметром замість мутації глобального стану.

## Update 2026-05-27

Тактичний фікс `pool: 'forks'` у `npm/vitest.config.js` (commit `81a1fdf`, version 1.27.7) усунув race для звичайного `bun run test` (1169 тестів без rogue-commits), але Stryker `@stryker-mutator/vitest-runner` запускає vitest inline та ігнорує `pool` — race залишалась при `bunx @stryker-mutator/core run`. `pool: 'forks'` залишено як defense-in-depth у фінальному рішенні після повного рефакторингу.

## Update 2026-05-27

Stryker mutation score `rules/test/coverage` під час ітерацій `/n-fix-tests` до рефакторингу: 65.03% → 86.71% → 97.20% → 98.58% (covered). Після рефакторингу `withTmpCwd → withTmpDir` score знизився до 93.62% через видалення stub-стратегії (докладніше — в основному ADR).

## Update 2026-05-27

Відновлення після rogue commits у реальному репо: `git reset --hard b07f220` + `git restore` для пошкоджених файлів + `git branch -D feat/x feat/docs feat/sync`. Явний запит користувача, зафіксований у transcript: «робимо Б і доповнюємо правило test, і політиками контролюємо щоб подобне повторилось в жодному проекті».

## Update 2026-05-27

Видалення stub-стратегії для `coverage-fix.mjs`: тести використовували `installCoverageFixStub()`, що записував фейковий `npm/rules/scripts/coverage-fix.mjs` у production tree — `fix-mjs-contract.test.mjs` виявляв stub як фальшиве правило і падав при паралельному прогоні. Виправлено: шлях у `coverage.mjs:192` `../../scripts/coverage-fix.mjs` → `../../../scripts/coverage-fix.mjs` (реальний файл завжди знаходився у `npm/scripts/coverage-fix.mjs`); stub та пов'язані describe-блоки видалено. Наслідок: 5 `NoCoverage` мутантів у `L189–L192` більше не покриваються unit-тестами.

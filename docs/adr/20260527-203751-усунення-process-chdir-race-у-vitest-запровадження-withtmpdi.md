---
session: b58fe9b6-2fb0-46ef-8ad3-b10064a423ed
captured: 2026-05-27T20:37:51+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/b58fe9b6-2fb0-46ef-8ad3-b10064a423ed.jsonl
---

---

## ADR Усунення `process.chdir` race у Vitest + запровадження `withTmpDir`

## Context and Problem Statement
У тестовій інфраструктурі `npm/` хелпер `withTmpCwd(fn)` з `scripts/utils/test-helpers.mjs` мутував глобальний `process.cwd()` через `process.chdir()`. При дефолтному `pool: 'threads'` у Vitest кілька тестових файлів виконувалися в одному процесі паралельно — зміна cwd одним тестом переривала операції іншого. Конкретний прояв: тести `changelog/consistency` викликали `git init/commit/checkout -b feat/x` усередині `withTmpCwd`, а race між `process.chdir` перенаправляв git-операцію у реальний репозиторій, створюючи rogue commits і гілки. Аналогічна проблема виникала під час Stryker (mutant testing) dry-run: `@stryker-mutator/vitest-runner` запускає Vitest inline у своєму процесі, ігноруючи `pool` із `vitest.config.js`, що унеможливлювало симптоматичне виправлення через зміну pool.

## Considered Options
* **Варіант А** — Symtom-fix: окремий `vitest.stryker.config.js` із `include` тільки для coverage-тестів, що не містять git-операцій; Stryker вказує на цей конфіг.
* **Варіант Б** — Root-cause fix: повне видалення `withTmpCwd` і заміна на `withTmpDir(fn)` без `process.chdir`; усі 43 тестові файли переписані на явну передачу `dir`; 24 production-функції отримують `cwd` параметр; запроваджена JS-policy проти повернення `process.chdir` у тести.

## Decision Outcome
Chosen option: "Варіант Б (root-cause fix + policy)", because користувач явно сказав "розвяжемо root cause" і "доповнюємо правило test, і політиками контролюємо щоб подібне повторилось в жодному проекті". Варіант А маскує симптом і не захищає майбутній код.

### Consequences
* Good, because `bun run coverage` і `bunx stryker run` більше не створюють rogue commits або branches — transcript фіксує: HEAD стабільний, branches 5 → 5 після повного прогону.
* Good, because transcript фіксує очікувану користь: два нові JS concerns (`no-process-chdir.mjs`, `vitest-config-pool-forks.mjs`) плюс оновлений `test.mdc` автоматично захищають усі проєкти-споживачі через `npx @nitra/cursor fix test`.
* Bad, because mutation score знизився з 98.58% до 93.62%: видалена stub-стратегія, яка досягала `if (opts.fix)` гілки у `coverage.mjs`, але створювала fs-артефакти у production tree; гілка `L189–L192` стала NoCoverage без end-to-end SDK-тестів.
* Bad, because transcript фіксує: 5 pre-existing errors у `coverage.test.mjs` з `e18e/prefer-static-regex` не усунуто; ENOTEMPTY flake у `bun run coverage` (cleanup tmp dir vs. `capture-decisions.sh` hook) залишається як окрема проблема.

## More Information
- Ключові файли: `npm/scripts/utils/test-helpers.mjs` (видалено `withTmpCwd`, додано `withTmpDir`), `npm/vitest.config.js` (залишено `pool: 'forks'` як defense-in-depth), `npm/stryker.config.mjs`, `npm/rules/test/js/no-process-chdir.mjs`, `npm/rules/test/js/vitest-config-pool-forks.mjs`, `npm/rules/test/test.mdc`, `npm/rules/test/js/data/vitest_config/vitest.config.baseline.js`.
- Виправлений pre-existing source bug: `npm/rules/test/coverage/coverage.mjs:192` — dynamic import шлях `../../scripts/coverage-fix.mjs` → `../../../scripts/coverage-fix.mjs`.
- Команди перевірки: `bun run test` (1200 passed), `bunx @stryker-mutator/core run` (93.62% mutation score, no rogue commits).
- Версія: `1.27.8` → `1.28.0` (BREAKING: `withTmpCwd` видалено з публічного API `test-helpers.mjs`).

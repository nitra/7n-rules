---
session: b58fe9b6-2fb0-46ef-8ad3-b10064a423ed
captured: 2026-05-27T21:17:24+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/b58fe9b6-2fb0-46ef-8ad3-b10064a423ed.jsonl
---

## ADR Усунення race-умови у Vitest через видалення `process.chdir` з тестів

## Context and Problem Statement
Під час запуску `bunx @stryker-mutator/core run` (через `bun run coverage`) Stryker запускає vitest dry-run inline у своєму процесі, ігноруючи `pool: 'forks'` у `vitest.config.js`. Тести з `changelog/consistency`, що викликали `withTmpCwd` → `process.chdir(tmpDir)`, конкурентно змінювали `process.cwd()` спільного процесу, через що `git init`/`git commit`/`git checkout -b feat/x` виконувались у реальному репо, створюючи rogue commits і branches (`feat/x`, `feat/docs`, `feat/sync`, `c3f1b94 init`) замість ізольованих tmp-директорій.

## Considered Options
* Залишити `withTmpCwd` + обмежити Stryker окремим `vitest.stryker.config.js` (Option A — маскування симптому)
* Видалити `withTmpCwd` повністю, замінити на `withTmpDir(fn)` без `process.chdir`, явна передача `cwd` параметром (Option Б — усунення кореня)

## Decision Outcome
Chosen option: "Option Б — видалити `withTmpCwd`, замінити на `withTmpDir`", because `process.chdir` мутує глобальний стан процесу і є небезпечним у будь-якому multi-worker середовищі (Stryker inline-runner, `pool: 'threads'` у vitest); симптоматичне виправлення через окремий конфіг Stryker'а не захищає від повторення тієї ж проблеми у інших контекстах.

### Consequences
* Good, because `bun run coverage` більше не створює rogue commits/branches: HEAD стабільний під час Stryker dry-run, перевірено з 5 branches до і після прогону.
* Good, because transcript фіксує очікувану користь: 24 production JS concerns отримали явний `cwd = process.cwd()` параметр; 43 тестових файли переписані на `join(dir, …)` + `cwd: dir` без неявної залежності від `process.cwd()`.
* Bad, because mutation score `rules/test/coverage/coverage.mjs` знизився з 98.58% → 93.62% — stub-стратегія `installCoverageFixStub`, що покривала гілку `if (opts.fix)`, була видалена разом із `withTmpCwd`-міграцією; ця гілка вимагає end-to-end CLI-тесту з реальним `@nitra/cursor coverage --fix`.

---

## ADR Видалення stub-стратегії для `coverage-fix.mjs` та виправлення реального шляху

## Context and Problem Statement
Тести `rules/test/coverage/tests/coverage.test.mjs` використовували `installCoverageFixStub()`, що записував фейковий `npm/rules/scripts/coverage-fix.mjs` у production tree. Це дозволяло тестувати `if (opts.fix)` гілку у `runCoverageSteps`. Але водночас тест `fix-mjs-contract.test.mjs` сканував `rules/*/fix.mjs` і виявляв stub як фальшиве правило, спричиняючи failures при паралельному прогоні.

## Considered Options
* Залишити stub і синхронізувати між тестами через `beforeAll`/`afterAll` ordering
* Виправити реальний шлях у `coverage.mjs:192` (`../../scripts/coverage-fix.mjs` → `../../../scripts/coverage-fix.mjs`) і видалити stub повністю

## Decision Outcome
Chosen option: "виправити реальний шлях і видалити stub", because `../../scripts/coverage-fix.mjs` резолвився в неіснуючий `npm/rules/scripts/coverage-fix.mjs`; реальний файл завжди знаходився у `npm/scripts/coverage-fix.mjs` (три рівні вище від `npm/rules/test/coverage/coverage.mjs`), тому stub маскував pre-existing source bug.

### Consequences
* Good, because transcript фіксує очікувану користь: `fix-mjs-contract.test.mjs` більше не виявляє stub як фальшиве правило; `npm/rules/scripts/` порожній каталог більше не утворюється.
* Bad, because mutation score знизився: 5 `NoCoverage` мутантів у `L189–L192` (тіло `if (opts.fix)`) більше не покриваються unit-тестами — `if (opts.fix)` gілка тепер вимагає реального dynamic import `coverage-fix.mjs`.

## More Information
- `npm/rules/test/coverage/coverage.mjs:192` — виправлений шлях dynamic import
- `npm/rules/test/coverage/tests/coverage.test.mjs` — видалено `installCoverageFixStub`, `removeCoverageFixStub`, `COVERAGE_FIX_STUB_PATH`, describe-блок `'runCoverageCli — stub-файл побічних ефектів очищається'`

---

## ADR Введення policy-guards `no-process-chdir` та `vitest-config-pool-forks` у правило `test`

## Context and Problem Statement
Race-bug через `process.chdir` у тестах виник знову б у будь-якому проєкті-споживачі `@nitra/cursor`, якщо розробник додав би новий `withTmpCwd`-виклик або встановив `pool: 'threads'` у `vitest.config.js`. Інцидент вже стався один раз і призвів до rogue commits у production репо.

## Considered Options
* Тільки документувати заборону у `test.mdc`
* Додати автоматичні JS concerns (machine-enforceable policy), що падають при `npx @nitra/cursor fix test`

## Decision Outcome
Chosen option: "додати JS concerns + оновити `test.mdc`", because документація без автоматичної перевірки не захищає нові проєкти; `npx @nitra/cursor fix test` у споживачеві має сигналізувати порушення без manual code-review.

### Consequences
* Good, because transcript фіксує очікувану користь: `rules/test/js/no-process-chdir.mjs` (8 unit-тестів) сканує `*.test.{js,mjs}` на `process.chdir(`; `rules/test/js/vitest-config-pool-forks.mjs` (6 unit-тестів) перевіряє `pool: 'forks'` у `vitest.config.js`; canonical `vitest.config.baseline.js` оновлено — нові проєкти race-safe з коробки.
* Good, because обидва concerns включені у стандартний `npx @nitra/cursor fix test` flow, тобто захист поширюється на всі проєкти-споживачі через один `npm install`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `npm/rules/test/js/no-process-chdir.mjs` — новий concern
- `npm/rules/test/js/tests/no-process-chdir.test.mjs` — 8 unit-тестів
- `npm/rules/test/js/vitest-config-pool-forks.mjs` — новий concern
- `npm/rules/test/js/tests/vitest-config-pool-forks.test.mjs` — 6 unit-тестів
- `npm/rules/test/js/data/vitest_config/vitest.config.baseline.js` — додано `pool: 'forks'`
- `npm/rules/test/test.mdc` — секція "Заборона `process.chdir` у тестах"
- Версія: `1.27.x` → `1.28.0` (BREAKING: `withTmpCwd` видалено з `scripts/utils/test-helpers.mjs`)

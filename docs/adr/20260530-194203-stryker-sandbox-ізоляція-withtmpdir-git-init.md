# Ізоляція git-залежних тестів від Stryker sandbox через withTmpDir + git init

**Status:** Accepted
**Date:** 2026-05-30

## Context and Problem Statement

`n-cursor coverage` запускає Stryker для мутаційного тестування. Stryker копіює вихідні файли у тимчасову sandbox-директорію (`npm/reports/stryker/.tmp/sandbox-XXXXX/`) без `.git/`. Тест `listShellScriptPaths` у `npm/rules/text/lint/tests/run-shellcheck.test.mjs` обчислював `NPM_ROOT` через `import.meta.url` (5 рівнів вгору) — під Stryker цей шлях вказував у sandbox, а не в реальне git-дерево. Як наслідок, `git ls-files` повертав порожній результат, тест падав у dry-run, і Stryker не запускав мутаційний аналіз взагалі.

## Considered Options

* `test.skipIf(process.env.STRYKER_MUTATOR_WORKER)` — пропускати тест у sandbox (за наявним патерном у `npm/tests/integration-repo-checks.test.mjs`)
* `inPlace: true` у `npm/stryker.config.mjs` — не створювати sandbox, мутувати у живому дереві
* Переписати тест через `withTmpDir + git init` — ізольований тимчасовий git-репо без залежності від реального `NPM_ROOT`

## Decision Outcome

Chosen option: "Переписати тест через `withTmpDir + git init`", because користувач явно обрав цей варіант як «найгігієнічніший» — тест стає повністю незалежним від cwd і коректно покриває гілку `git ls-files` як під звичайним vitest, так і під Stryker sandbox; `skipIf` залишає гілку непокритою мутаційним аналізом, `inPlace: true` знижує ізоляцію для всіх тестів.

### Consequences

* Good, because тест покриває логіку `git ls-files`-гілки у `listShellScriptPaths` незалежно від середовища запуску — sandbox, worktree чи CI.
* Bad, because тест тепер вимагає `execFileSync('git', ['init', ...])` у tmp-директорії; якщо `git` відсутній у PATH на деяких середовищах — тест падатиме (transcript не містить підтвердження цього ризику).

## More Information

* Змінений файл: `npm/rules/text/lint/tests/run-shellcheck.test.mjs:27` — замінено `NPM_ROOT` на `withTmpDir` з `git init -q --initial-branch=main` і `git add -A`.
* Патерн `withTmpDir` узятий з наявного коду: `npm/rules/ga/js/tests/workflows.test.mjs`.
* Аналогічна проблема вирішена через `skipIf` у `npm/tests/integration-repo-checks.test.mjs:49-54` — цей ADR фіксує вибір повної ізоляції замість `skipIf` для нових тестів.
* `skipIf(STRYKER_MUTATOR_WORKER)` залишається допустимим лише для top-level smoke-аудиту, де тест за природою перевіряє інваріанти живого репо.
* Change-файл: `npm/.changes/1780159016890-dd4a30.md` (`bump: patch`, `section: Fixed`).
* Stryker config: `npm/stryker.config.mjs` (`tempDirName: 'reports/stryker/.tmp'`).
* Env-змінна: `STRYKER_MUTATOR_WORKER` — Stryker ставить у worker-процесах.

## Update 2026-05-30

### Доповнення канону n-test.mdc до v2.7

Аудит ~144 тестових файлів у `npm/` виявив три класи неузгодженостей: (1) 6 файлів мутують `console.log` напряму — race-unsafe у `pool: 'forks'`; (2) декілька тестів залежать від реального git-дерева без Stryker-захисту; (3) `child_process`-виклики без явного `{ cwd: dir }` — потенційний race. Канон `npm/rules/test/test.mdc` доповнено до версії `2.7` трьома новими розділами: `## Console mocking у тестах`, `## Sandbox-aware тести (Stryker)`, `## child_process у тестах`. Дзеркало `.cursor/rules/n-test.mdc` синхронізується через `bunx @nitra/cursor`. Change-файл: `npm/.changes/1780163801646-85565f.md` (bump: minor, section: Added).

### Новий локальний файл правил `.cursor/rules/n-cursor-test.mdc`

Cursor-специфічні конвенції ізольовані від глобального канону в окремому файлі `.cursor/rules/n-cursor-test.mdc` (glob: `**/*.test.mjs`, `alwaysApply: false`): мова `test()`/`describe()` — українська; `skipIf(STRYKER_MUTATOR_WORKER)` або `withTmpDir` для тестів, що звертаються до `.n-cursor.json`/`COVERAGE.md`/`reports/stryker`; inline test-фабрики в одному файлі — допустимі без винесення в `test-helpers.mjs`.

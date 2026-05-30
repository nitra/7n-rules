---
session: 9b2ddf67-dce0-4298-88ca-c524605c3c76
captured: 2026-05-30T20:58:05+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/9b2ddf67-dce0-4298-88ca-c524605c3c76.jsonl
---

## ADR Ізоляція git-залежних тестів через withTmpDir + git init

## Context and Problem Statement
Тест `listShellScriptPaths всередині git-репо` у `npm/rules/text/lint/tests/run-shellcheck.test.mjs` обчислював `NPM_ROOT` через `import.meta.url` (5 рівнів вгору) і передавав його у функцію, яка викликає `git ls-files`. Stryker копіює репо у sandbox без `.git/`, тому `git ls-files` повертала `[]`, assertion падала, Stryker dry-run переривався й `mutation.json` не оновлювався.

## Considered Options
* Переписати тест на ізольований `withTmpDir + git init` (без залежності від реального cursor-дерева)
* Додати `test.skipIf(env.STRYKER_MUTATOR_WORKER)` — пропускати тест лише під Stryker
* Встановити `inPlace: true` у `npm/stryker.config.mjs` — відмовитись від sandbox повністю

## Decision Outcome
Chosen option: "Переписати тест на ізольований `withTmpDir + git init`", because це покриває git-гілку без залежності від реального cursor-дерева — і в звичайному vitest run, і під Stryker sandbox; `skipIf` залишає гілку непокритою мутаційним аналізом, `inPlace: true` знижує ізоляцію для всіх тестів.

### Consequences
* Good, because transcript фіксує очікувану користь: 5/5 тестів пройшли після переписування, Stryker dry-run пройшов і оновив `mutation.json` до 19:33:50.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінений файл: `npm/rules/text/lint/tests/run-shellcheck.test.mjs:27`. Аналогічний вже діючий патерн — `npm/rules/ga/js/tests/workflows.test.mjs` (execFileSync + git init). Виняток — `skipIf(STRYKER_MUTATOR_WORKER)` залишається допустимим лише для top-level smoke-аудиту (наприклад `npm/tests/integration-repo-checks.test.mjs`), де тест за природою перевіряє інваріанти живого репо.

---

## ADR Канон n-test.mdc v2.7: console mocking, sandbox-aware, child_process cwd

## Context and Problem Statement
Аудит ~144 тестових файлів у `npm/` виявив три класи неузгодженостей: (1) 6 файлів мутують `console.log` напряму (`const orig = console.log; ...`), що є race-unsafe у `pool: 'forks'`; (2) декілька тестів залежать від реального git-дерева без Stryker-захисту; (3) `child_process`-виклики без явного `{ cwd: dir }` — потенційний race у forks.

## Considered Options
* Доповнити глобальне правило `npm/rules/test/test.mdc` трьома новими канонами
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Доповнити глобальне правило `npm/rules/test/test.mdc` трьома новими канонами", because аудит зафіксував реальні відхилення, а наявна `process.chdir`-заборона (вже у v2.6) базується на тій самій аргументації — race-unsafe у `pool: 'forks'`.

### Consequences
* Good, because transcript фіксує очікувану користь: канони є перевірюваними (ESLint або check-скрипт), дублюють аргументацію v2.6 для нових категорій і поширюються через `n-cursor fix` на consumer-проекти.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Canonical файл: `npm/rules/test/test.mdc` (версія `2.7`). Дзеркало: `.cursor/rules/n-test.mdc` (синхронізується через `bunx @nitra/cursor`). Три нових розділи: `## Console mocking у тестах`, `## Sandbox-aware тести (Stryker)`, `## child_process у тестах`. Change-файл: `npm/.changes/1780163801646-85565f.md` (bump: minor, section: Added).

---

## ADR Новий локальний файл правил `.cursor/rules/n-cursor-test.mdc`

## Context and Problem Statement
Після аудиту виявлено, що деякі конвенції специфічні лише для cursor-репо: мова описів `test()`/`describe()` (українська), обов'язковий `skipIf(STRYKER_MUTATOR_WORKER)` або `withTmpDir` для тестів, що звертаються до `.n-cursor.json`, `COVERAGE.md`, `npm/reports/stryker`, і допустимість inline test-фабрик у межах одного файлу. Глобальне правило `n-test.mdc` у `npm/rules/test/test.mdc` адресоване consumer-проектам і не може містити cursor-специфіку.

## Considered Options
* Створити новий локальний файл `.cursor/rules/n-cursor-test.mdc`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Створити новий локальний файл `.cursor/rules/n-cursor-test.mdc`", because cursor-репо має файли, які за природою взаємодіють із Stryker-пайплайном (`.n-cursor.json`, `COVERAGE.md`, `incremental.json`), і ці обмеження не мають поширюватись на проекти, що використовують `@nitra/cursor` як пакет.

### Consequences
* Good, because transcript фіксує очікувану користь: cursor-специфічні обмеження ізольовані від глобального канону; локальне правило `alwaysApply: false` з glob `**/*.test.mjs` активується контекстно.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл створено: `.cursor/rules/n-cursor-test.mdc`. Глоб: `**/*.test.mjs`. Кваліфіковані обмеження: (1) мова describe/test — українська, (2) тести з `COVERAGE.md`/`.n-cursor.json`/`reports/stryker` — `skipIf(STRYKER_MUTATOR_WORKER)` або повна ізоляція, (3) inline test-фабрики в одному файлі — допустимі без винесення в `test-helpers.mjs`.

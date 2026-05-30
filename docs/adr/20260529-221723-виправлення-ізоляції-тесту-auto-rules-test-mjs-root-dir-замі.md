---
session: bb3047db-5332-4649-a713-3f1cde68927a
captured: 2026-05-29T22:17:23+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/bb3047db-5332-4649-a713-3f1cde68927a.jsonl
---

## ADR Виправлення ізоляції тесту `auto-rules.test.mjs`: `root: dir` замість `root: process.cwd()`

## Context and Problem Statement
Тест `AUTO_RULE_DEPENDENCIES: disable-rules vue → image-avif теж не додається` у `npm/scripts/tests/auto-rules.test.mjs:275` передавав `root: process.cwd()` у `detectAutoRules`, через що Stryker не міг пройти початковий dry-run і кидав `ConfigError: There were failed tests in the initial test run.` Це блокувало запуск coverage для всього workspace.

## Considered Options
* Передати `root: dir` (тимчасова директорія, створена `withTmpDir`) — аналогічно до сусіднього тесту L300.
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Передати `root: dir`", because сусідній тест того самого блоку вже використовував `root: dir`, і лише ця форма забезпечує ізоляцію від реального дерева cursor, не вносячи реальних правил у `detectAutoRules`.

### Consequences
* Good, because transcript фіксує очікувану користь: тест перейшов у `1 passed | 28 skipped`, Stryker зміг запуститись.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл: `npm/scripts/tests/auto-rules.test.mjs:282`.
Рядок до виправлення: `root: process.cwd()`.
Рядок після: `root: dir`.
Команда перевірки: `bunx vitest run scripts/tests/auto-rules.test.mjs -t "disable-rules vue"`.

---

## ADR Тактика тестів для вцілілих мутантів `opts.fix` gate у `coverage.mjs` (L189, L211)

## Context and Problem Statement
У `npm/rules/test/coverage/coverage.mjs` залишилось 4 вцілілих мутанти, два з яких стосувались рядка 189 (`if (opts.fix)`) та рядка 211 (виклик `runCoverageSteps({ fix: false })`). Наявні тести не розрізняли гілки `fix=true` / `fix=false`, тому мутант міг виживати.

## Considered Options
* Додати тести в `npm/rules/test/coverage/tests/coverage.test.mjs`, що викликають `runCoverageSteps({fix:true})` та `runCoverageSteps({fix:false})` і перевіряють різну поведінку (лог / відсутність виклику `fixSurvivedMutants`).
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Додати тести через поведінкові assertions", because метод дозволяє вловити мутацію `opts.fix` умови без прямого читання source — тест перевіряє видимий ефект (виклик/невиклик, stdout), що й є метою mutation testing.

### Consequences
* Good, because transcript фіксує очікувану користь: кількість `Tests passed` зросла з 49 до 52 після додавання тестів для `opts.fix gate` та `{ fix: false }` default.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл: `npm/rules/test/coverage/tests/coverage.test.mjs`.
Файл, що мутується: `npm/rules/test/coverage/coverage.mjs`, рядки 189, 211.
Команда перевірки: `bunx vitest run npm/rules/test/coverage/tests/coverage.test.mjs -t "opts.fix gate"`.
Baseline (до виправлень): `132/141` вбитих мутантів (93.62%).

---

## ADR Виправлення рівня заголовку CHANGELOG: `## [version]` замість `# [version]`

## Context and Problem Statement
Integration-тест `tests/integration-repo-checks.test.mjs` перевіряє, що перша секція `npm/CHANGELOG.md` відповідає версії в `npm/package.json`. Після попередніх правок рядок `# [1.30.0]` використовував h1 (`#`), тоді як правило `npm-module.mdc` вимагає h2 (`##`). Тест падав з `AssertionError: expected 1 to be +0`, що блокувало запуск Stryker через `ConfigError`.

## Considered Options
* Виправити `# [1.30.0]` → `## [1.30.0]` у `npm/CHANGELOG.md`.
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Виправити рівень заголовку на `##`", because правило `npm-module.mdc` явно вимагає `## [version]`, а check-скрипт `npx @nitra/cursor check changelog` це перевіряє.

### Consequences
* Good, because transcript фіксує очікувану користь: після виправлення integration-тест видав `✅ npm/CHANGELOG.md: перша секція [1.30.0] збігається з npm/package.json`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл: `npm/CHANGELOG.md`, рядок 6.
Команда перевірки: `bun run coverage` (інтеграційний тест у `tests/integration-repo-checks.test.mjs`).
Правило, що визначає формат: `.cursor/rules/n-changelog.mdc` / `npm-module.mdc`.

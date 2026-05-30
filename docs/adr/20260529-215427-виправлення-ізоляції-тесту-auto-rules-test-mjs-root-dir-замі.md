---
session: bb3047db-5332-4649-a713-3f1cde68927a
captured: 2026-05-29T21:54:27+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/bb3047db-5332-4649-a713-3f1cde68927a.jsonl
---

## ADR Виправлення ізоляції тесту `auto-rules.test.mjs` (root: dir замість process.cwd())

## Context and Problem Statement
Тест `AUTO_RULE_DEPENDENCIES: disable-rules vue → image-avif теж не додається` у `npm/scripts/tests/auto-rules.test.mjs:282` передавав `root: process.cwd()` замість тимчасової директорії `dir`. Це призводило до зависання / некоректної поведінки і блокувало запуск Stryker (виникала помилка "There were failed tests in the initial test run.").

## Considered Options
* Замінити `root: process.cwd()` на `root: dir` (тимчасова директорія `withTmpDir`)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Замінити `root: process.cwd()` на `root: dir`", because сусідній аналогічний тест (L300) вже використовує `root: dir`, і це єдиний спосіб коректно ізолювати тест від реального файлового дерева.

### Consequences
* Good, because transcript фіксує очікувану користь: тест `disable-rules vue` одразу пройшов (`1 passed`) після виправлення, а Stryker зміг стартувати без помилки початкового прогону.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл: `npm/scripts/tests/auto-rules.test.mjs`, рядок 282. Функція: `detectAutoRules`. Контекст запуску: `withTmpDir` callback з параметром `dir`. Перевірка: `bunx vitest run scripts/tests/auto-rules.test.mjs -t "disable-rules vue"`.

---

## ADR Тести для вцілілих мутантів `opts.fix` gate у `coverage.mjs` (L189, L211)

## Context and Problem Statement
Після запуску Stryker у `npm/rules/test/coverage/coverage.mjs` залишалися вцілілі мутанти на рядках L189 (`if (opts.fix)`) та L211 (виклик `runCoverageSteps` з дефолтними аргументами `{ fix: false }`). Жоден з наявних тестів не варіював значення `opts.fix`, тому умовна гілка не відстежувалась мутаційним тестуванням.

## Considered Options
* Додати нові `describe`/`test`-кейси у `npm/rules/test/coverage/tests/coverage.test.mjs`, що викликають `runCoverageSteps({fix:true})` і `runCoverageSteps({fix:false})` окремо
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Додати нові describe/test-кейси", because це мінімально-інвазивна зміна, що не торкається наявних 49 тестів і безпосередньо вбиває мутанти на цільових рядках.

### Consequences
* Good, because transcript фіксує очікувану користь: кількість тестів зросла з 49 до 57 (`57 passed`) у `npm/` після додавання нових describe-блоків.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл: `npm/rules/test/coverage/tests/coverage.test.mjs`. Джерело мутантів: `npm/rules/test/coverage/coverage.mjs`, рядки 189 та 211. Запуск перевірки: `cd npm && bunx vitest run rules/test/coverage/tests/coverage.test.mjs`.

---

## ADR Виправлення рівня заголовку у `npm/CHANGELOG.md` (`#` → `##`)

## Context and Problem Statement
Секція `[1.30.0]` у `npm/CHANGELOG.md` починалася з `# [1.30.0]` (H1) замість `## [1.30.0]` (H2). Інтеграційний тест `check-*` у `tests/integration-repo-checks.test.mjs` перевіряв відповідність першого розділу changelog до `package.json#version` і падав, блокуючи запуск `bun run coverage`.

## Considered Options
* Змінити `# [1.30.0]` на `## [1.30.0]` у `npm/CHANGELOG.md`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Змінити `# [1.30.0]` на `## [1.30.0]`", because формат Keep a Changelog вимагає H2 для версійних секцій, а чек `npm/CHANGELOG.md` перевіряє саме цей рівень.

### Consequences
* Good, because transcript фіксує очікувану користь: після виправлення інтеграційний тест вивів `✅ npm/CHANGELOG.md: перша секція [1.30.0] збігається з npm/package.json`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл: `npm/CHANGELOG.md`, рядок 6. Тест: `tests/integration-repo-checks.test.mjs`. Правило: `npm-module.mdc`. Команда перевірки: `npx @nitra/cursor check changelog`.

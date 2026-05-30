---
session: bb3047db-5332-4649-a713-3f1cde68927a
captured: 2026-05-29T21:46:25+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/bb3047db-5332-4649-a713-3f1cde68927a.jsonl
---

## ADR Дописування тестів для вцілілих мутантів `opts.fix` у `coverage.mjs`

## Context and Problem Statement
Stryker виявив два вцілілі мутанти у `npm/rules/test/coverage/coverage.mjs`: умова `if (opts.fix)` на L189 і виклик `runCoverageSteps({ fix: false })` на L211. Жоден існуючий тест не охоплював ці гілки, тому mutation score залишався на 93.62% (132/141).

## Considered Options
* Дописати окремі `describe`-блоки з прямими викликами `runCoverageSteps({fix:true})` та `runCoverageSteps({fix:false})` у `npm/rules/test/coverage/tests/coverage.test.mjs`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Дописати окремі `describe`-блоки з прямими викликами `runCoverageSteps`", because це прямо верифікує умову `if (opts.fix)` і default-аргумент `{ fix: false }` — мінімальна зміна, що вбиває конкретні мутанти.

### Consequences
* Good, because transcript фіксує очікувану користь: після додавання 3 тестів suite стала `57 passed` замість `54 passed`; нові тести зелені.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файли: `npm/rules/test/coverage/coverage.mjs` (L189, L211), `npm/rules/test/coverage/tests/coverage.test.mjs`. Coverage score до/після: 93.62% → перевірка після завершення Stryker.

---

## ADR Виправлення рівня Markdown-заголовка версій у `CHANGELOG.md` (`#` → `##`)

## Context and Problem Statement
Інтеграційний тест `tests/integration-repo-checks.test.mjs` виявив, що перший запис версії в `npm/CHANGELOG.md` мав рівень H1 (`# [1.30.0]`), тоді як правило `npm-module.mdc` вимагає H2 (`## [1.30.0]`). Це блокувало запуск `bun run coverage` через падіння initial test run у Stryker.

## Considered Options
* Виправити `# [1.30.0]` → `## [1.30.0]` у `npm/CHANGELOG.md`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Виправити `# [1.30.0]` → `## [1.30.0]`", because інтеграційний тест явно вказав на порушення формату з повідомленням `перша секція [1.30.0] не збігається з npm/package.json version "1.30.0"`.

### Consequences
* Good, because transcript фіксує очікувану користь: після виправлення вивід тесту змінився на `✅ npm/CHANGELOG.md: перша секція [1.30.0] збігається з npm/package.json`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файли: `npm/CHANGELOG.md` (L6), `tests/integration-repo-checks.test.mjs`, правило `npm-module.mdc`. Команда перевірки: `npx @nitra/cursor check changelog`.

---

## ADR Виправлення ізоляції тесту `auto-rules.test.mjs` — `process.cwd()` → `dir`

## Context and Problem Statement
Тест `AUTO_RULE_DEPENDENCIES: disable-rules vue → image-avif теж не додається` у `npm/scripts/tests/auto-rules.test.mjs:282` передавав `root: process.cwd()` замість тимчасової директорії `dir`. Це спричиняло timeout (5000 ms) і зупиняло Stryker із помилкою `There were failed tests in the initial test run`.

## Considered Options
* Замінити `root: process.cwd()` на `root: dir` у тесті на L282
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Замінити `root: process.cwd()` на `root: dir`", because сусідній аналогічний тест на L300 вже використовує `root: dir` — це усталений патерн ізоляції тестового середовища у цьому файлі.

### Consequences
* Good, because transcript фіксує очікувану користь: після виправлення `bunx vitest run scripts/tests/auto-rules.test.mjs -t "disable-rules vue"` повернув `1 passed | 28 skipped`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл: `npm/scripts/tests/auto-rules.test.mjs:282`; reference-патерн — тест на L300 того ж файлу. Помилка до виправлення: `Test timed out in 5000ms`.

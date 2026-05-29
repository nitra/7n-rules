---
session: 693f6687-c783-4802-b2ad-784924283c10
captured: 2026-05-29T16:28:51+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/693f6687-c783-4802-b2ad-784924283c10.jsonl
---

## ADR Розширення `.gitignore`-сніпета правила `test`: ігнорувати `**/coverage/` повністю

## Context and Problem Statement
Концерн `stryker_config` у `npm/rules/test/js/stryker_config.mjs` керує `.gitignore`-записами для тест-артефактів. Спочатку до сніпета входив лише `**/reports/stryker/`. Постало питання: чи потрібно також ігнорувати `lcov-report/` (HTML-вивід vitest v8 lcov-репортера), а потім і весь `coverage/` каталог.

## Considered Options
* Додати тільки `**/coverage/lcov-report/` — ігнорувати HTML-підкаталог, залишити `lcov.info` трекованим.
* Додати `**/coverage/` — ігнорувати весь каталог coverage цілком.

## Decision Outcome
Chosen option: "Додати `**/coverage/`", because coverage-артефакти повністю ефемерні (регенеруються при кожному прогоні), а єдиний дюрабельний результат — `COVERAGE.md`. `gitignore` не заважає `n-cursor coverage` читати `lcov.info` під час самого прогону.

### Consequences
* Good, because transcript фіксує очікувану користь: жодний coverage-файл (ні `lcov.info`, ні HTML) не потрапить у commit, що відповідає принципу "build artifacts не трекуємо".
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Змінений файл: `npm/rules/test/js/stryker_config.mjs` — константа перейменована на `TEST_GITIGNORE_ENTRIES = ['**/reports/stryker/', '**/coverage/']`; секція `.gitignore` — `# Test artifacts: Stryker + coverage`.
- Документація оновлена в `npm/rules/test/test.mdc` та `.cursor/rules/n-test.mdc`.
- Тести: `npm/rules/test/js/tests/stryker_config.test.mjs` — 16/16 passed.
- `npm/CHANGELOG.md` — зміна зафіксована в секції `## [1.29.3] - 2026-05-29`.

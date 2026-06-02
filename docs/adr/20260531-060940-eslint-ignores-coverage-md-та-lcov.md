# ESLint ignores: `COVERAGE.md` та `npm/coverage/`

**Status:** Accepted
**Date:** 2026-05-31

## Context and Problem Statement

`bun run lint-js` (ESLint) позначав `COVERAGE.md` і `npm/coverage/lcov-report/*.js` як файли з помилками (`no-undef`, `no-new-func` тощо): перший містить вбудовані code-сніпети для ілюстрації мутантів, другий — згенерований lcov HTML-звіт. ESLint трактував ці файли як вихідний код і видавав шумові помилки.

## Considered Options

* Додати `COVERAGE.md` та `npm/coverage/**` до поля `ignores` у `eslint.config.js`.
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Додати до `ignores` у `eslint.config.js`", because `COVERAGE.md` і `npm/coverage/` — документація та build artifacts, а не source-код; їх lint не дає цінності й лише шумить.

### Consequences

* Good, because зникають хибні `no-undef` / `no-new-func` помилки від `COVERAGE.md` і `npm/coverage/lcov-report/`.
* Neutral, because Stryker-sandbox директорії (`npm/reports/stryker/.tmp/sandbox-*`) також генерували >17 000 шумових ESLint-помилок і видалялись вручну; `eslint.config.js` не містив ignore-шляху для `.tmp/sandbox-*` — потребує окремого рішення.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

Змінений файл: `eslint.config.js` — поле `ignores` розширено рядками `'COVERAGE.md'` та `'npm/coverage/**'`. Паттерн `**/coverage/` вже є в `.gitignore`, але не в ESLint ignores до цього рішення.

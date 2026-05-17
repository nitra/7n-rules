---
session: 18575de0-b5fa-4b72-a235-c55731b4c22a
captured: 2026-05-17T16:22:53+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-vitaliytv-mlmail/18575de0-b5fa-4b72-a235-c55731b4c22a.jsonl
---

## ADR Міграція з Vitest на Bun Test Runner

**Контекст:** Проєкт мав залежність `vitest` у `app/package.json`, але постало питання — чи є сенс лишати окремий test runner, якщо `bun` вже є основним інструментом збірки/запуску.

**Рішення/Процедура/Факт:** Міграція вже виконана: тест-файли (`app/src/i18n/auth-errors.test.js`, `app/src/services/auth-store.test.js`) імпортують виключно з `bun:test` (`describe`, `it`, `expect`, `mock`, `beforeEach`), а `package.json` містить скрипт `"test": "bun test src/services src/i18n"` — без будь-якого виклику `vitest`.

**Обґрунтування:** Bun Test Runner вбудований у `bun` і не потребує окремої залежності; синтаксис майже ідентичний `vitest` (той самий `describe`/`it`/`expect`), тому міграція безболісна. Усуває зайву dev-залежність і прискорює `bun install`.

**Розглянуті альтернативи:** Явно не обговорювалися; питання формулювалося як «чи можна», і аналіз показав, що рішення вже реалізоване.

**Зачіпає:** `app/package.json` (скрипт `test`, залежність `vitest`), `app/src/i18n/auth-errors.test.js`, `app/src/services/auth-store.test.js`.

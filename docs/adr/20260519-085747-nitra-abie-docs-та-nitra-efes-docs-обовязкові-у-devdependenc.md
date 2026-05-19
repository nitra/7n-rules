---
session: 4f97d6f8-5b2c-472f-9d2b-42ac8442cf90
captured: 2026-05-19T08:57:47+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/4f97d6f8-5b2c-472f-9d2b-42ac8442cf90.jsonl
---

## ADR `@nitra/abie-docs` та `@nitra/efes-docs` обовʼязкові у `devDependencies`

## Context and Problem Statement
Правила `abie` та `efes` пакета `@nitra/cursor` не перевіряли наявність документаційних пакетів у споживчому репозиторії. Потрібно було гарантувати, що у кореневому `package.json` abie-проєктів присутній `@nitra/abie-docs`, а у efes-проєктів — `@nitra/efes-docs` у секції `devDependencies`.

## Considered Options
* Реалізувати перевірку через Rego (conftest policy-концерн)
* Реалізувати перевірку через JS у `check-abie.mjs` / `check-efes.mjs`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Реалізувати перевірку через Rego", because користувач явно запитав «а можна через rego?» і підтвердив цей підхід; перевірка є per-document (один файл `package.json`, структурна умова — наявність ключа в `devDependencies`), що є канонічним кейсом для Rego за правилами `conftest.mdc`.

### Consequences
* Good, because transcript фіксує очікувану користь: перевірка реалізована в одному місці (rego-policy), без дублювання логіки в JS; `discoverCheckableRules` автоматично підхоплює нові концерни за наявністю `target.json`; `conftest verify` і `regal lint` пройшли без порушень.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Нові файли: `npm/rules/abie/policy/package_json_docs/{target.json,package_json_docs.rego,package_json_docs_test.rego}`, `npm/rules/efes/policy/package_json_docs/{target.json,package_json_docs.rego,package_json_docs_test.rego}`
- `target.json` для обох концернів: `{ "files": { "single": "package.json", "required": true } }`
- `npm/rules/abie/abie.mdc` bump `1.20` → `1.21`; `npm/rules/efes/efes.mdc` заповнено (раніше порожнє) і bump `1.0` → `1.1`
- `npm/package.json` bump `1.13.43` → `1.13.44`; відповідний запис у `npm/CHANGELOG.md`
- Верифікація: `conftest verify` 5/5 тестів для кожного пакета; smoke-тест через `n-cursor.js check abie` та `check efes` у тимчасовому репо — negative-case дає `❌ devDependencies має містити @nitra/abie-docs`, positive-case дає `✅ package_json_docs: 1 файл(ів) OK (rego)`

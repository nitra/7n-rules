# `@nitra/abie-docs` та `@nitra/efes-docs` обов'язкові у `devDependencies`

**Status:** Accepted
**Date:** 2026-05-19

## Context and Problem Statement

Правила `abie` та `efes` пакета `@nitra/cursor` не перевіряли наявність документаційних пакетів у споживчому репозиторії. Потрібно гарантувати, що у кореневому `package.json` abie-проєктів присутній `@nitra/abie-docs`, а у efes-проєктів — `@nitra/efes-docs` у секції `devDependencies`.

## Considered Options

- Реалізувати перевірку через Rego (conftest policy-концерн)
- Реалізувати перевірку через JS у `check-abie.mjs` / `check-efes.mjs`
- Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Реалізувати перевірку через Rego", because це per-document перевірка (один файл `package.json`, структурна умова — наявність ключа в `devDependencies`), що є канонічним кейсом для Rego за правилами `conftest.mdc`; користувач явно підтвердив цей підхід.

### Consequences

- Good, because перевірка реалізована в одному місці (rego-policy), без дублювання логіки в JS.
- Good, because `discoverCheckableRules` автоматично підхоплює нові концерни за наявністю `target.json`.
- Good, because `conftest verify` і `regal lint` пройшли без порушень.
- Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

Нові файли:
- `npm/rules/abie/policy/package_json_docs/{target.json,package_json_docs.rego,package_json_docs_test.rego}`
- `npm/rules/efes/policy/package_json_docs/{target.json,package_json_docs.rego,package_json_docs_test.rego}`

`target.json` для обох концернів: `{ "files": { "single": "package.json", "required": true } }`.
Bump версій: `npm/rules/abie/abie.mdc` `1.20` → `1.21`; `npm/rules/efes/efes.mdc` `1.0` → `1.1`.
Версія пакету: `npm/package.json` `1.13.43` → `1.13.44`; відповідний запис у `npm/CHANGELOG.md`.
Smoke-тест: negative-case — `❌ devDependencies має містити @nitra/abie-docs`; positive-case — `✅ package_json_docs: 1 файл(ів) OK (rego)`.

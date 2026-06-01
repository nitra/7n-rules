---
session: bb9b64bf-e71f-4660-8c4a-0e1b3e8444d5
captured: 2026-06-01T21:40:07+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/bb9b64bf-e71f-4660-8c4a-0e1b3e8444d5.jsonl
---

## ADR Видалення JS-копії дозволеного образу hasura/graphql-engine на користь rego як єдиного джерела істини

## Context and Problem Statement
Канонічний тег `hasura/graphql-engine` (поле `HASURA_GRAPHQL_ENGINE_IMAGE`) існував у двох місцях: JS-константа в `npm/rules/k8s/js/manifests.mjs` і `allowed_hasura_images` у `npm/rules/k8s/policy/manifest/manifest.rego`. Під час переходу з `v2.48.15.ubi.amd64` на `v2.49.0.ubuntu.amd64` обидва місця довелося правити вручну. Це виявило ризик розсинхрону між JS-копією і rego-авторитетом.

## Considered Options
* Лишити дублювання, додати sync-тест (варіант 3)
* Генерувати `allowed_hasura_images` у rego з JS-константи через codegen або `data.json` (варіант 2, як задекларував користувач)
* Видалити мертвий JS-предикат, залишивши тег виключно в rego (конкретна реалізація, обрана в сесії)

## Decision Outcome
Chosen option: "Видалити мертвий JS-дублікат, залишивши тег виключно в `allowed_hasura_images` у rego", because JS-функції `deploymentHasuraGraphqlEngineImageViolation` / `hasuraGraphqlEngineViolation*` не мали жодного виклику у `check()` — лише юніт-тести; реальна перевірка образа вже виконувалась виключно через rego-пакет `k8s.manifest` (шлях `runAllK8sRego` → `runConftestBatch`). Найчистіша реалізація «єдиного джерела» — видалити мертвий код без додаткової інфраструктури.

### Consequences
* Good, because тег образа тепер лежить в одному місці (`manifest.rego:allowed_hasura_images`); наступний бамп вимагає зміни лише одного файлу.
* Bad, because `HASURA_GRAPHQL_ENGINE_IMAGE` і `HASURA_GRAPHQL_ENGINE_ALLOWED_IMAGES` більше не є публічними JS-експортами; transcript не містить підтверджених негативних наслідків від цього.

## More Information
Змінені файли:
- `npm/rules/k8s/js/manifests.mjs` — видалено `HASURA_GRAPHQL_ENGINE_IMAGE`, `HASURA_GRAPHQL_ENGINE_ALLOWED_IMAGES`, `hasuraGraphqlEngineViolation*`, `deploymentHasuraGraphqlEngineImageViolation`; оновлено JSDoc
- `npm/rules/k8s/js/tests/manifests/tests/check-schema.test.mjs` — видалено імпорт і `describe`-блок видалених функцій
- `npm/rules/k8s/policy/manifest/manifest.rego` — оновлено коментарі; `allowed_hasura_images` — єдиний source of truth тега
- `npm/rules/k8s/k8s.mdc` — виправлено посилання з JS-константи на rego `allowed_hasura_images`

Перевірки після змін: `bunx vitest run` — 1420 passed; `conftest verify -p npm/rules/k8s/policy/manifest` — 18 passed; `regal lint manifest.rego` — 0 violations.

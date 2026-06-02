---
session: 1f428343-c999-4b00-81c1-f8e6e25ade37
captured: 2026-06-02T15:00:25+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/1f428343-c999-4b00-81c1-f8e6e25ade37.jsonl
---

## ADR Розширення обовʼязкових env у ConfigMap Hasura-Deployment

## Context and Problem Statement
Rego-пакет `k8s.hasura_configmap` перевіряв у `data` ConfigMap, що сусідствує з Hasura-Deployment, лише один ключ: `HASURA_GRAPHQL_ENABLE_REMOTE_SCHEMA_PERMISSIONS="true"`. Команда вирішила додати контроль ще чотирьох змінних, щоб запобігти неконтрольованому увімкненню Relay, евентингу, телеметрії та зайвих типів логів у будь-якому Hasura-Deployment.

## Considered Options
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Додати чотири нові env до Rego-перевірки `k8s.hasura_configmap`", because user явно визначив перелік ключів і допустимі значення для кожного.

Повний набір обовʼязкових ключів після рішення:

| Ключ | Вимога |
|---|---|
| `HASURA_GRAPHQL_ENABLE_REMOTE_SCHEMA_PERMISSIONS` | `"true"` (існувало) |
| `HASURA_GRAPHQL_ENABLE_RELAY` | `"false"` |
| `HASURA_GRAPHQL_DISABLE_EVENTING` | ключ обовʼязковий, значення довільне |
| `HASURA_GRAPHQL_ENABLE_TELEMETRY` | `"false"` |
| `HASURA_GRAPHQL_ENABLED_LOG_TYPES` | точний рядок `"startup,http-log"` |

Булеві значення (`true`/`"TRUE"`, `false`/`"FALSE"`) приймаються однаково; для `HASURA_GRAPHQL_ENABLED_LOG_TYPES` зіставлення точне за рядком.

### Consequences
* Good, because transcript фіксує очікувану користь: `conftest verify -p npm/rules/k8s/policy/hasura_configmap` → 23 тести, 23 passed, 0 failures.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `npm/rules/k8s/policy/hasura_configmap/hasura_configmap.rego` — реалізація через data-driven `required_env` (rego.v1, `import rego.v1`).
- `npm/rules/k8s/policy/hasura_configmap/hasura_configmap_test.rego` — 23 тести (7 → 23), окремі блоки per-key.
- `npm/rules/k8s/k8s.mdc` — оновлена людинозрозуміла секція "ConfigMap для Hasura-Deployment".
- `npm/.changes/1780401296160-154217.md` — change-файл bump minor/Changed.
- Запуск перевірки: `conftest verify -p npm/rules/k8s/policy/hasura_configmap`.

---

## ADR Видалення JS-дзеркала предикатів hasura_configmap

## Context and Problem Statement
У `npm/rules/k8s/js/manifests.mjs` існував JS-мірор Rego-перевірки: `hasuraConfigMapRemoteSchemaPermissionsViolation`, `isConfigMapValueTrue` та константа `HASURA_REMOTE_SCHEMA_PERMISSIONS_KEY`. Після розширення rego-пакету `k8s.hasura_configmap` підтримка JS-копій стала ще важчою — кожен новий env треба було б додавати в обох місцях.

## Considered Options
* Видалити JS-предикати (JS-orchestrator делегує все до conftest — Rego authoritative).
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Видалити JS-предикати та їхні тести", because конвенція `conftest.mdc` (alwaysApply) забороняє залишати JS-копії rego-логіки; JS-оркестратор лише викликає conftest і отримує результат.

### Consequences
* Good, because transcript фіксує очікувану користь: `bun test rules/k8s/js/tests/manifests/tests/check-schema.test.mjs` → 178 pass, 0 fail після видалення блоку тестів і імпортів.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Видалені з `npm/rules/k8s/js/manifests.mjs`: `export const HASURA_REMOTE_SCHEMA_PERMISSIONS_KEY`, `isConfigMapValueTrue`, `hasuraConfigMapRemoteSchemaPermissionsViolation`.
- `export const HASURA_REQUIRED_ENV_KEYS` залишено — JS-оркестратор використовує його лише як довідковий список у JSDoc/pass-повідомленні.
- Видалений `describe('hasuraConfigMapRemoteSchemaPermissionsViolation', ...)` блок у `npm/rules/k8s/js/tests/manifests/tests/check-schema.test.mjs`.
- Архітектурний контекст: `docs/adr/rego-authoritative-js-orchestrator-plan-b.md` (Status: Accepted, 2026-05-10).
- `regal lint npm/rules/k8s/policy/hasura_configmap/` → 2 files linted. No violations found.

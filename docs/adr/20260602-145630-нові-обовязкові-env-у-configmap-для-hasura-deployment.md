---
session: 1f428343-c999-4b00-81c1-f8e6e25ade37
captured: 2026-06-02T14:56:30+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/1f428343-c999-4b00-81c1-f8e6e25ade37.jsonl
---

## ADR Нові обов'язкові env у ConfigMap для Hasura-Deployment

## Context and Problem Statement
K8s-правило `hasura_configmap` перевіряло лише один обов'язковий ключ (`HASURA_GRAPHQL_ENABLE_REMOTE_SCHEMA_PERMISSIONS`). Команда вирішила додати ще два обов'язкові env: `HASURA_GRAPHQL_ENABLE_RELAY` (значення фіксоване `"false"`) і `HASURA_GRAPHQL_DISABLE_EVENTING` (значення довільне, за замовчуванням `"true"`).

## Considered Options
* Додати нові перевірки у Rego-пакет `k8s.hasura_configmap` (авторитетна частина)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Додати нові перевірки у Rego-пакет `k8s.hasura_configmap`", because архітектурне рішення проєкту (ADR «Rego-authoritative + JS-orchestrator», `conftest.mdc` `alwaysApply`) вимагає, щоб per-document перевірки жили в Rego, а JS виступав лише оркестратором. Водночас стара JS-копія предиката (`hasuraConfigMapRemoteSchemaPermissionsViolation`, `HASURA_REMOTE_SCHEMA_PERMISSIONS_KEY`, `isConfigMapValueTrue`) видалена з `manifests.mjs` як порушення правила «no mirror».

### Consequences
* Good, because `conftest verify -p npm/rules/k8s/policy/hasura_configmap` дав 16 passed, 0 failures після змін; `regal lint` — 0 violations; JS-тести `bun test` — 178 pass.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінені файли:
- `npm/rules/k8s/policy/hasura_configmap/hasura_configmap.rego` — нові `deny` для `HASURA_GRAPHQL_ENABLE_RELAY` (повинно бути `"false"`) і `HASURA_GRAPHQL_DISABLE_EVENTING` (ключ має бути присутній, значення довільне)
- `npm/rules/k8s/policy/hasura_configmap/hasura_configmap_test.rego` — 16 тестів (pass 16/16)
- `npm/rules/k8s/js/manifests.mjs` — видалено `HASURA_REMOTE_SCHEMA_PERMISSIONS_KEY`, `isConfigMapValueTrue`, `hasuraConfigMapRemoteSchemaPermissionsViolation`; JSDoc оркестраторної функції узагальнено
- `npm/rules/k8s/js/tests/manifests/tests/check-schema.test.mjs` — видалено `describe`-блок для видаленого предиката та його імпорти
- `npm/rules/k8s/k8s.mdc` — секція «ConfigMap для Hasura-Deployment» оновлена: перераховано всі три ключі
- `npm/.changes/1780401296160-154217.md` — changelog entry (`minor`, `Changed`)

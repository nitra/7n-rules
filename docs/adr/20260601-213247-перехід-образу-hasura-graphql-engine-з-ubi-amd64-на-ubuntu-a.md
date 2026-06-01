---
session: bb9b64bf-e71f-4660-8c4a-0e1b3e8444d5
captured: 2026-06-01T21:32:47+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/bb9b64bf-e71f-4660-8c4a-0e1b3e8444d5.jsonl
---

## ADR Перехід образу hasura/graphql-engine з ubi.amd64 на ubuntu.amd64

## Context and Problem Statement
Для підтримки `pg_dump 18` необхідний образ на базі Ubuntu — Red Hat UBI-варіант (`ubi.amd64`) цю версію `pg_dump` не містить. Канонічний тег `HASURA_GRAPHQL_ENGINE_IMAGE` і білий список у OPA-policy мали бути оновлені синхронно у трьох вихідних файлах.

## Considered Options
* Оновити образ до `v2.49.0.ubuntu.amd64`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Оновити образ до `v2.49.0.ubuntu.amd64`", because лише ubuntu-варіант образу містить `pg_dump 18` (явне пояснення користувача у запиті).

### Consequences
* Good, because `pg_dump 18` стає доступним у production-образі Hasura.
* Bad, because `COVERAGE.md` (згенерований звіт) тимчасово містить застарілий тег до наступного прогону coverage — transcript фіксує свідому відмову від оновлення цього файлу.

## More Information
Змінені файли:
- `npm/rules/k8s/js/manifests.mjs:158` — константа `HASURA_GRAPHQL_ENGINE_IMAGE`
- `npm/rules/k8s/policy/manifest/manifest.rego:52-53` — масив `allowed_hasura_images` (обидва варіанти: `hasura/graphql-engine:…` і `docker.io/hasura/graphql-engine:…`)
- `npm/rules/k8s/policy/manifest/manifest_test.rego:192,216` — тестові fixtures (canonical image + variant з `@sha256:`-digest)

`COVERAGE.md` явно не оновлювався — він генерується автоматично й оновиться при наступному `coverage`-прогоні.

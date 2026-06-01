---
session: bb9b64bf-e71f-4660-8c4a-0e1b3e8444d5
captured: 2026-06-01T21:52:25+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/bb9b64bf-e71f-4660-8c4a-0e1b3e8444d5.jsonl
---

Зараз проаналізую транскрипт і сформую MADR-документи.

## ADR Перехід образу hasura/graphql-engine з ubi.amd64 на ubuntu.amd64

## Context and Problem Statement
`pg_dump 18` доступний лише в Ubuntu-варіанті образу `hasura/graphql-engine`. Образ на базі Red Hat UBI (`ubi.amd64`) цю версію `pg_dump` не містить, тому канонічний тег потребував заміни на `v2.49.0.ubuntu.amd64`.

## Considered Options
* Замінити тег на `v2.49.0.ubuntu.amd64` (ubuntu-база)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Замінити тег на `v2.49.0.ubuntu.amd64`", because тільки ubuntu-варіант образу містить `pg_dump 18`, що є технічною вимогою.

### Consequences
* Good, because transcript фіксує очікувану користь: доступність `pg_dump 18` у k8s Deployment.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінені файли:
- `npm/rules/k8s/js/manifests.mjs` — константа `HASURA_GRAPHQL_ENGINE_IMAGE` (видалена пізніше у наступному рішенні)
- `npm/rules/k8s/policy/manifest/manifest.rego` — `allowed_hasura_images` (рядки 47–53)
- `npm/rules/k8s/policy/manifest/manifest_test.rego` — фікстури тестів (рядки 192, 216)

---

## ADR Видалення JS-дубліката перевірки образа Hasura — єдине джерело істини у rego

## Context and Problem Statement
Після переходу на новий тег виявилось, що тег `hasura/graphql-engine` потребував синхронного оновлення в двох місцях: JS-константа `HASURA_GRAPHQL_ENGINE_IMAGE` у `manifests.mjs` і `allowed_hasura_images` у `manifest.rego`. Розслідування показало, що JS-перевірка (`deploymentHasuraGraphqlEngineImageViolation`, `HASURA_GRAPHQL_ENGINE_ALLOWED_IMAGES` тощо) є мертвою в продакшені — вона ніде не викликається в `check()`, лише в юніт-тестах, тоді як жива перевірка вже делегована rego-пакету `k8s.manifest` через `runAllK8sRego` → `runConftestBatch`.

## Considered Options
* Залишити дублювання, оновлювати обидва місця вручну
* Генерувати `allowed_hasura_images` у rego з JS-константи (codegen або `data.json` для conftest)
* Видалити мертвий JS-дублікат — єдине джерело у `manifest.rego`

## Decision Outcome
Chosen option: "Видалити мертвий JS-дублікат — єдине джерело у `manifest.rego`", because живий `check()` вже делегує пер-документну перевірку образа в rego через `runAllK8sRego` (рядок 6749 `manifests.mjs`); JS-функції були мертвими після міграції «Plan B» і генератор — надмірна інфраструктура для одного рядка.

### Consequences
* Good, because тег `v2.49.0.ubuntu.amd64` тепер живе рівно в одному місці (`manifest.rego` + тест-фікстури), розсинхрон при наступному бампі неможливий.
* Good, because transcript фіксує очікувану користь: `conftest verify` — 18 tests passed, vitest — 1420 passed, `regal lint` — no violations.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінені файли:
- `npm/rules/k8s/js/manifests.mjs` — видалено: `HASURA_GRAPHQL_ENGINE_IMAGE`, `HASURA_GRAPHQL_ENGINE_ALLOWED_IMAGES`, `deploymentHasuraGraphqlEngineImageViolation`, `hasuraGraphqlEngineViolation*`; лишено: `isHasuraGraphqlEngineImageRef`, `HASURA_GRAPHQL_ENGINE_RE` (потрібні живій `isHasuraDeploymentManifest`)
- `npm/rules/k8s/js/tests/manifests/tests/check-schema.test.mjs` — видалено describe-блок і два імпорти мертвої функції
- `npm/rules/k8s/policy/manifest/manifest.rego` — `allowed_hasura_images` позначено як єдине джерело істини; оновлено коментарі (рядки 47–50, 165)
- `npm/rules/k8s/k8s.mdc` — правило тепер вказує на `allowed_hasura_images` у rego, а не на JS-константу (рядок 155)
Верифікація: `conftest verify -p npm/rules/k8s/policy/manifest`, `bunx vitest run`, `regal lint`

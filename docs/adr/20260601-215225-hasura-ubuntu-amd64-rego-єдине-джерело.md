---
type: ADR
title: "Hasura image: перехід на ubuntu.amd64 і rego як єдине джерело"
---

# Hasura image: перехід на ubuntu.amd64 і rego як єдине джерело

**Status:** Accepted
**Date:** 2026-06-01

## Context and Problem Statement

Для підтримки `pg_dump 18` необхідний образ `hasura/graphql-engine` на базі Ubuntu — Red Hat UBI-варіант (`ubi.amd64`) цієї версії `pg_dump` не містить. Після заміни тегу виявилося, що він підтримувався в двох місцях: JS-константа `HASURA_GRAPHQL_ENGINE_IMAGE` у `manifests.mjs` і масив `allowed_hasura_images` у `manifest.rego`. Розслідування показало, що JS-перевірки (`deploymentHasuraGraphqlEngineImageViolation` тощо) не мали жодного виклику у `check()` — лише в юніт-тестах; жива перевірка вже делегована rego-пакету `k8s.manifest` через `runAllK8sRego` → `runConftestBatch`.

## Considered Options

- Замінити тег і залишити JS-константу як дублювання (ручна синхронізація обох місць при кожному бампі)
- Генерувати `allowed_hasura_images` у rego з JS-константи (codegen або `data.json` для conftest)
- Видалити мертвий JS-дублікат — єдине джерело у `manifest.rego`
- Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Замінити тег на `v2.49.0.ubuntu.amd64` і видалити мертвий JS-дублікат — єдине джерело у `manifest.rego`", because тільки ubuntu-варіант містить `pg_dump 18` (технічна вимога, явно назвав користувач); JS-функції були мертвими після міграції «Plan B» (живий `check()` вже делегує пер-документну перевірку образа в rego через `runAllK8sRego`); codegen — надмірна інфраструктура для одного рядка; найчистіша реалізація єдиного джерела — видалити мертвий код.

### Consequences

- Good, because `pg_dump 18` стає доступним у production-образі Hasura.
- Good, because тег образа тепер живе рівно в одному місці (`manifest.rego:allowed_hasura_images`); розсинхрон при наступному бампі неможливий.
- Good, because верифікація після змін: `conftest verify` — 18 tests passed; `bunx vitest run` — 1420 passed; `regal lint` — no violations.
- Bad, because `HASURA_GRAPHQL_ENGINE_IMAGE` і `HASURA_GRAPHQL_ENGINE_ALLOWED_IMAGES` більше не є публічними JS-експортами; transcript не містить підтверджених негативних наслідків від цього.
- Neutral, because `COVERAGE.md` (згенерований звіт) тимчасово містить застарілий тег до наступного coverage-прогону — свідома відмова від оновлення цього файлу.

## More Information

Змінені файли:
- `npm/rules/k8s/js/manifests.mjs` — видалено: `HASURA_GRAPHQL_ENGINE_IMAGE`, `HASURA_GRAPHQL_ENGINE_ALLOWED_IMAGES`, `deploymentHasuraGraphqlEngineImageViolation`, `hasuraGraphqlEngineViolation*`; лишено: `isHasuraGraphqlEngineImageRef`, `HASURA_GRAPHQL_ENGINE_RE` (потрібні живій `isHasuraDeploymentManifest`)
- `npm/rules/k8s/js/tests/manifests/tests/check-schema.test.mjs` — видалено describe-блок і два імпорти мертвих функцій
- `npm/rules/k8s/policy/manifest/manifest.rego:47–53` — `allowed_hasura_images` позначено як єдине джерело істини; обидва варіанти тега (`hasura/graphql-engine:…` і `docker.io/hasura/graphql-engine:…`)
- `npm/rules/k8s/policy/manifest/manifest_test.rego:192,216` — тестові fixtures (canonical image + variant з `@sha256:`-digest)
- `npm/rules/k8s/k8s.mdc:155` — правило тепер вказує на `allowed_hasura_images` у rego, а не на JS-константу

## Update 2026-06-18

- Мінімальну дозволену версію `hasura/graphql-engine` у whitelist піднято з `v2.49.0.ubuntu.amd64` до `v2.49.2.ubuntu.amd64`.
- Оновлено `npm/rules/k8s/policy/manifest/manifest.rego`: `allowed_hasura_images` містить `hasura/graphql-engine:v2.49.2.ubuntu.amd64` і `docker.io/hasura/graphql-engine:v2.49.2.ubuntu.amd64`.
- Оновлено `npm/rules/k8s/policy/manifest/manifest_test.rego`: canonical-image і digest-image test cases переведено на `v2.49.2`.
- Посилання `v2.49.0` у `npm/rules/k8s/js/tests/manifests/tests/check-schema.test.mjs` залишено без змін, бо transcript фіксує його як generic-маркер HTTPRoute-перевірки, а не частину whitelist.
- Верифікація: `conftest verify -p npm/rules/k8s/policy/manifest` → 20/20 passed.
- Change-file: `npm/.changes/260618-1537.md` з patch bump.

# Нові rego-пакети abie з тестами та виправлення health_check_policy

**Status:** Accepted
**Date:** 2026-05-10

## Контекст

47 rego-файлів у `npm/policy/` поза `k8s/` не мали `_test.rego`. Пер-документні правила abie для Deployment, clean-merged-branch workflow та HTTPRoute hostnames існували лише в JS-функціях — без IDE-фідбеку через `conftest`. Крім того, виявлено drift-bug у `health_check_policy.rego`: правило читало `spec.config.httpHealthCheck`, тоді як JS перевіряв `spec.default.config.httpHealthCheck`, і розбіжність місяцями існувала непоміченою.

## Рішення/Процедура/Факт

Додано чотири rego-пакети з `_test.rego`:

- `npm/policy/abie/base_deployment_preem/` — Deployment у `…/k8s/.../base/…` повинен мати `spec.template.spec.nodeSelector.preem: true` або `"true"`. 8 rego-тестів.
- `npm/policy/abie/clean_merged_ignore_branches/` — workflow `clean-merged-branch.yml` повинен мати `with.ignore_branches` з токенами `dev`, `ua`, `ru` без урахування регістру. 7 rego-тестів.
- `npm/policy/abie/health_check_policy/` — переписано: виправлено шлях `spec.config` → `spec.default.config`; додано перевірки `apiVersion == networking.gke.io/v1`, `metadata.name`, `targetRef.kind == Service`, точний збіг `targetRef.name == "<hcp.name>-hl"` замість лише `endswith "-hl"`. 10 rego-тестів.
- `npm/policy/abie/http_route_base/` — додано перший `http_route_base_test.rego`. 10 тестів.

Оновлено `npm/scripts/lint-conftest.mjs` (таблиця TARGETS): 2 нові abie-таргети, уточнено `policyDir` для існуючих пакетів. Оновлено `npm/mdc/abie.mdc`: додано розділ «Швидкий gate через conftest (Rego)» з повною мапою пакетів і namespaces.

## Обґрунтування

IDE-фідбек через `tsandall.opa` працює лише при наявності rego-пакету у відповідній теці. Без `_test.rego` зміни в rego можуть мовчки зламати правило — саме так виник drift-bug у `health_check_policy.rego`, що існував непоміченим до аудиту. Тести ловлять такі баги негайно.

## Розглянуті альтернативи

Не обговорювалися — пріоритет покриття очевидний з аудиту 47 нетестованих rego-файлів.

## Зачіпає

`npm/policy/abie/base_deployment_preem/`, `npm/policy/abie/clean_merged_ignore_branches/`, `npm/policy/abie/health_check_policy/`, `npm/policy/abie/http_route_base/`, `npm/scripts/lint-conftest.mjs`, `npm/mdc/abie.mdc`.

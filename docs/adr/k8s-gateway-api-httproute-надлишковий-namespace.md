# Gateway API HTTPRoute — заборона надлишкового namespace у backendRefs

**Status:** Accepted
**Date:** 2026-05-05

## Контекст

У маніфестах Gateway API (`HTTPRoute` та споріднені) розробники інколи явно вказують `namespace` у `backendRefs`, навіть якщо він збігається з `metadata.namespace` документа. Це надлишкова інформація, яка порушує DRY і може вводити в оману.

## Рішення/Процедура/Факт

Додано нову перевірку в `npm/scripts/check-k8s.mjs`: функція `collectGatewayApiRouteBackendRefsWithRedundantNamespace` сканує `spec.rules[*].backendRefs` у документах групи `gateway.networking.k8s.io` і повертає помилку, якщо `namespace` у будь-якому `backendRef` збігається з `metadata.namespace` того ж документа. Функція інтегрована у `scanGatewayApiRouteBackendRefsInYamlBody`. До `npm/mdc/k8s.mdc` додано секцію «Gateway API HTTPRoute: надлишковий `namespace` у `backendRefs`» з прикладами ❌/✅. До `npm/tests/check-k8s-schema.test.mjs` додані unit-тести. Версія: 1.8.175.

## Обґрунтування

Явно заданий `namespace`, що дублює `metadata.namespace`, є надлишком: Kubernetes застосовує той самий namespace для in-cluster `backendRef` за замовчуванням. Автоматична перевірка забезпечує консистентність маніфестів і виключає плутанину при рев'ю.

## Розглянуті альтернативи

Не обговорювалися; підхід відповідав усталеному патерну проєкту.

## Зачіпає

`npm/scripts/check-k8s.mjs` (нова функція + інтеграція), `npm/mdc/k8s.mdc` (нова секція правила), `npm/tests/check-k8s-schema.test.mjs` (нові тести), `npm/package.json` (v1.8.175), `npm/CHANGELOG.md`.

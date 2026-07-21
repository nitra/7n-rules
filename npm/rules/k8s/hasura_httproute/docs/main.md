---
type: JS Module
title: main.mjs
resource: npm/rules/k8s/hasura_httproute/main.mjs
docgen:
  crc: 2f28a731
  model: openai-codex/gpt-5.4-mini
  score: 90
  issues: internal-name:validateHasuraHttpRouteCanon,judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Read-only `lint`-обгортка для Kubernetes YAML у `k8s`, яка не має власного `main.mjs` і тому через `hasHandWrittenMain` у `scripts/lib/lint-surface/detect.mjs` не повинна промотуватися в ungated standalone detector. Її роль — делегувати перевірку в `k8s/manifests/main.mjs` через `validateHasuraHttpRouteCanon`, де `collectHasuraDeploymentsAndHttpRoutes` зв’язує `hasura_httproute.rego` лише з HTTPRoute, що має поруч Hasura Deployment з тим самим `metadata.name`. Це запобігає запуску `hasura_httproute.rego` напряму на всі `hr.yaml` під `k8s` і прибирає false positive на HTTPRoute без Hasura.

## Поведінка

1. `lint` збирає стан перевірки для поточного робочого каталогу й працює лише на читання.
2. `lint` знаходить Kubernetes YAML у межах `k8s` з урахуванням ignore-шляхів з `.cursor`.
3. Якщо під `k8s` немає YAML-файлів, `lint` фіксує пропуск і завершує роботу без помилки.
4. Якщо YAML-файли є, `lint` запускає перевірку `hasura_httproute` тільки на цьому наборі файлів.
5. Перевірка навмисно gated: вона не повинна перетворюватися на ungated standalone detector для всіх `hr.yaml` під `k8s`, бо тоді з’являлися б false positive для HTTPRoute без відповідного Hasura Deployment з тим самим `metadata.name`.
6. `lint` повертає підсумок із зафіксованими порушеннями або повідомленням про пропуск, не змінюючи файлову систему чи бази даних.

## Публічний API

- lint — Detector k8s/hasura_httproute (read-only).

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).

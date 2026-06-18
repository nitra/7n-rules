---
type: ADR
title: "Додавання NATS-порту TCP 4222 до in-cluster egress-блоку NetworkPolicy"
---

# Додавання NATS-порту TCP 4222 до in-cluster egress-блоку NetworkPolicy

**Status:** Accepted
**Date:** 2026-06-04

## Context and Problem Statement

Поди з лейблом `app=admin-db-api` падали у `CrashLoopBackOff` через `TimeoutError` у `nats.js` при спробі підключення до `nats.nats.svc:4222`. Перевірка `nc -zw6` підтвердила: `NetworkPolicy`, згенерований `@nitra/cursor`, блокував порт `4222` — в канонічному in-cluster egress-блоці (`namespaceSelector: {}`) були присутні `4317/4318` (OTel), але не `4222` (NATS).

## Considered Options

- Додати `port: 4222` до in-cluster egress-блоку (`to: [{ namespaceSelector: {} }]`) — де живуть сервіси всередині кластера
- Додати `port: 4222` до зовнішнього egress-блоку (`ipBlock: cidr: 0.0.0.0/0`) — дозволяє вихід у публічний інтернет
- Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Додати `port: 4222` до in-cluster egress-блоку (`namespaceSelector: {}`)", because NATS-сервіс живе у namespace `nats` всередині кластера; трафік на `nats.nats.svc:4222` є внутрішньокластерним, а не зовнішнім, тому блок `0.0.0.0/0` (80/443) для цього не підходить.

### Consequences

- Good, because `buildNetworkPolicyYaml('admin-db-api', …, 'Deployment')` і `StatefulSet` після правки генерують in-cluster блок із `port: 4222`, тоді як `0.0.0.0/0` залишається лише 80/443.
- Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

Змінені файли у пакеті `@nitra/cursor`:
- `npm/rules/k8s/policy/network_policy/template/deployment.snippet.yaml` — додано `- protocol: TCP / port: 4222` між `port: 8080` і `port: 4317` в in-cluster egress
- `npm/rules/k8s/policy/network_policy/template/stateful-set.snippet.yaml` — аналогічно
- `npm/rules/k8s/k8s.mdc` — inline-приклад і текстовий перелік портів (`…6379, 8080, 4222, 4317, 4318`); `version: '1.42'` → `'1.43'`

Архітектурний факт: snippet-файли є єдиним джерелом істини для набору портів — JS-генератор (`NETWORK_POLICY_SNIPPET_URLS` у `npm/rules/k8s/js/manifests.mjs:4059`) і rego-перевірки читають порти напряму з `*.snippet.yaml`; окремого hardcode-переліку портів у `*.mjs` або `*.rego` не існує.

Верифікація: `vitest run` — 221/221 ✅; `opa test --ignore '*.yaml'` — 12/12 ✅; change-файл `npm/.changes/260604-2112.md` (`bump: minor`, section `Changed`).

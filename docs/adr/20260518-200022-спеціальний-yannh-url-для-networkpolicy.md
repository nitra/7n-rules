---
session: 6b287fba-9e9c-4f99-9574-9f5e865598bb
captured: 2026-05-18T20:00:22+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/6b287fba-9e9c-4f99-9574-9f5e865598bb.jsonl
---

## ADR Спеціальний yannh URL для NetworkPolicy

## Context and Problem Statement
Репозиторій yannh/kubernetes-json-schema для ресурсу `networking.k8s.io/v1 NetworkPolicy` зберігає файл під назвою `networkpolicy-networking-v1.json`, а не `networkpolicy-networking-k8s-io-v1.json`. Загальна логіка в `check.mjs` будувала URL з повним доменом групи (`networking.k8s.io` → `networking-k8s-io`), що давало 404 при виконанні `check k8s` і при генерації `buildNetworkPolicyYaml`.

## Considered Options
* Виправити URL лише для `NetworkPolicy` (точковий виняток у `expectedSchemaUrlForTypedManifest` + `buildNetworkPolicyYaml`)
* Системно виправити логіку для всіх `*.k8s.io` груп (Ingress, Role, ClusterRole, StorageClass, …)

## Decision Outcome
Chosen option: "Виправити URL лише для `NetworkPolicy`", because користувач явно обрав скоп «Тільки NetworkPolicy», залишивши загальний паттерн для решти груп поза межами цього патчу.

### Consequences
* Good, because transcript фіксує очікувану користь: всі 180 тестів проходять після точкового виправлення; `check k8s` і `buildNetworkPolicyYaml` більше не генерують 404-URL.
* Bad, because загальна логіка yannh URL для решти `*.k8s.io` груп (Ingress, IngressClass, Role, ClusterRole, StorageClass та ін.) лишається помилковою — ті ресурси й надалі отримуватимуть 404-URL.

## More Information
- Виправлені файли: `npm/rules/k8s/fix/manifests/check.mjs`, `npm/rules/k8s/k8s.mdc` (bump `1.34` → `1.35`), `.cursor/rules/n-k8s.mdc` (bump `1.34` → `1.35`), `npm/package.json` (`1.13.40` → `1.13.41`), `npm/CHANGELOG.md`.
- Перевірено HTTP-статуси: `networkpolicy-networking-v1.json` → 200; `networkpolicy-networking-k8s-io-v1.json` → 404.
- Аналогічна 404-поведінка підтверджена для: `ingress-networking-k8s-io-v1.json`, `role-rbac-authorization-k8s-io-v1.json`, `customresourcedefinition-apiextensions-v1.json` та інших груп з `*.k8s.io`.
- Команда перевірки тестів: `bun test npm/rules/k8s/fix/manifests/check-schema.test.mjs`.

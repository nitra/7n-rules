---
session: 6b287fba-9e9c-4f99-9574-9f5e865598bb
captured: 2026-05-18T20:04:38+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/6b287fba-9e9c-4f99-9574-9f5e865598bb.jsonl
---

## ADR Виправлення yannh URL для груп `*.k8s.io` у `check.mjs`

## Context and Problem Statement

У `expectedSchemaUrlForTypedManifest` і `buildNetworkPolicyYaml` (файл `npm/rules/k8s/fix/manifests/check.mjs`) URL схем для груп типу `networking.k8s.io` формувався як `<kind>-<group-з-крапками-як-дефіси>-<version>.json` — наприклад, `networkpolicy-networking-k8s-io-v1.json`. Репозиторій yannh/kubernetes-json-schema зберігає ці файли під скороченою назвою (лише перший сегмент до першої крапки), тому такі URL повертають HTTP 404.

## Considered Options

* Виправити лише `NetworkPolicy` — захардкодований виняток для `networking.k8s.io/v1`
* Виправити системно — у `expectedSchemaUrlForTypedManifest` брати лише перший сегмент `group` (до першої крапки) для всіх груп із `YANNH_GROUPS`

## Decision Outcome

Chosen option: "Виправити системно", because HTTP-перевірка підтвердила однаковий патерн для всіх груп типу `*.k8s.io`: `ingress-networking-k8s-io-v1.json` → 404, `ingress-networking-v1.json` → 200; `role-rbac-authorization-k8s-io-v1.json` → 404, `role-rbac-v1.json` → 200. Загальне правило `group.slice(0, firstDot)` усуває клас помилок одразу, а не по одному ресурсу.

### Consequences

* Good, because transcript фіксує очікувану користь: всі 218 тестів у `npm/rules/k8s/` проходять після заміни; залишків зламаних URL (`networking-k8s-io`, `rbac-authorization-k8s-io` тощо) у кодовій базі не знайдено.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

- Змінені файли: `npm/rules/k8s/fix/manifests/check.mjs`, `npm/rules/k8s/k8s.mdc` (version `1.34` → `1.35`), `.cursor/rules/n-k8s.mdc` (version `1.34` → `1.35`), `npm/package.json` (`1.13.40` → `1.13.41`), `npm/CHANGELOG.md`
- HTTP-верифікація URL виконувалась через `curl -sI` до `https://raw.githubusercontent.com/yannh/kubernetes-json-schema/master/v1.33.9-standalone-strict/`
- Правило трансформації: `group.indexOf('.') === -1 ? group : group.slice(0, group.indexOf('.'))` перед підстановкою у шаблон `<kind>-<groupPart>-<version>.json`
- Тести: `bun test npm/rules/k8s/fix/manifests/check-schema.test.mjs` — 180 pass; `bun test npm/rules/k8s/` — 218 pass

---
session: 1f428343-c999-4b00-81c1-f8e6e25ade37
captured: 2026-06-02T15:14:22+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/1f428343-c999-4b00-81c1-f8e6e25ade37.jsonl
---

Помилка changelog (`3.12.0` vs опублікована `3.13.0`) — це **pre-existing** стан, не від моїх змін. Npm уже опублікував `3.13.0` до того, як `package.json` встиг оновитися; CI зробить bump автоматично після merge change-файлу.

Усе що могло бути зроблено — зроблено:

**Статус перевірок:**
- conftest base: 27/27 ✅
- conftest overlay: 6/6 ✅
- regal lint (4 файли): чисто ✅
- bun test: 178/178 ✅
- git status: 6 файлів змінено + 1 новий каталог

**Підсумок змін:**

| Env | Де вимагається | Значення |
|---|---|---|
| `HASURA_GRAPHQL_ENABLED_APIS` | `k8s/base/configmap.yaml` | `"metadata,graphql,pgdump"` |
| `HASURA_GRAPHQL_ENABLED_APIS` | `k8s/<env>/configmap.yaml` (overlay) | `"metadata,graphql"` |

**Нові файли:**
- `npm/rules/k8s/policy/hasura_configmap_overlay/hasura_configmap_overlay.rego` — overlay rego-пакет
- `npm/rules/k8s/policy/hasura_configmap_overlay/hasura_configmap_overlay_test.rego` — 6 тестів

**Overlay detection у JS** (`validateHasuraConfigMapOverlayApis`): шукає `k8s/<env>/configmap.yaml` де `env ≠ base,components`, перевіряє що `../base/` містить Hasura-Deployment, запускає `k8s.hasura_configmap_overlay` rego.

Закомітити?

---

## ADR Обов'язкові Hasura env у ConfigMap: base vs overlay

## Context and Problem Statement
Hasura-Deployment у k8s потребує специфічних env-змінних у ConfigMap для коректної роботи. До цього перевірявся лише `HASURA_GRAPHQL_ENABLE_REMOTE_SCHEMA_PERMISSIONS`. Виникла потреба розширити набір обов'язкових ключів і розрізнити вимоги для base (`k8s/base/configmap.yaml`) та overlay-середовищ (`k8s/<env>/configmap.yaml`, де `<env>` ≠ `base`), зокрема щодо `HASURA_GRAPHQL_ENABLED_APIS`.

## Considered Options
* Один спільний rego-пакет для base і overlay з параметром середовища через `templateData`
* Два окремих rego-пакети: `k8s.hasura_configmap` (base) і `k8s.hasura_configmap_overlay` (overlay)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Два окремих rego-пакети з JS-оркестратором як cross-file детектором", because rego authoritative per-document (конвенція `conftest.mdc`), JS відповідає лише за cross-file логіку (sibling-директорія `../base/` з Hasura-Deployment); різні очікувані значення `HASURA_GRAPHQL_ENABLED_APIS` природно розкладаються в окремі пакети без template-параметризації.

### Consequences
* Good, because rego-пакети залишаються простими (no template injection), тести ізольовані — conftest verify на кожен пакет окремо.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `npm/rules/k8s/policy/hasura_configmap/hasura_configmap.rego` — base-пакет: 6 обов'язкових ключів, включно з `HASURA_GRAPHQL_ENABLED_APIS="metadata,graphql,pgdump"`
- `npm/rules/k8s/policy/hasura_configmap_overlay/hasura_configmap_overlay.rego` — overlay-пакет: лише `HASURA_GRAPHQL_ENABLED_APIS="metadata,graphql"`
- JS-оркестратор: `validateHasuraConfigMapOverlayApis` у `npm/rules/k8s/js/manifests.mjs` — знаходить `k8s/<env>/configmap.yaml` де `env ≠ base,components`, перевіряє наявність Hasura-Deployment у sibling `../base/`, передає файли conftest
- Namespace `k8s.hasura_configmap_overlay` підключено в головному `check()` після `validateHasuraConfigMapRemoteSchemaPermissions`

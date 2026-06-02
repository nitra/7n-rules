---
session: 1f428343-c999-4b00-81c1-f8e6e25ade37
captured: 2026-06-02T16:22:02+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/1f428343-c999-4b00-81c1-f8e6e25ade37.jsonl
---

=== worktree list after removal ===
/Users/vitalii/www/nitra/cursor                                        5ab342d [main]
/Users/vitalii/www/nitra/cursor/.worktrees/main-hasura-apis            0f004d9 [main-hasura-apis]
[assistant]
[thinking]

[assistant]
[tool: Bash] {"command":"cd /Users/vitalii/www/nitra/cursor\nnpx @nitra/cursor worktree remove main-hasura-apis 2>&1 | tail -5; echo \"exit=$?\""}
[user]
[tool_result] ✅ Worktree видалено: .worktrees/main-hasura-apis
exit=0
[assistant]
[thinking]

[assistant]
Готово. Ось що зроблено:

- **6 дублюючих ADR-чернеток** видалено (unstaged `D`). Лишилась одна канонічна: `docs/adr/20260602-161654-обовязкові-env-ключі-у-hasura-configmap-data-driven-rego-req.md`
- **Worktree** `.worktrees/main-hasura-apis` (і гілку) видалено — вміст уже в `main@5ab342d`
- Нічого не застейджено

Можеш закомітити видалення 6 ADR одним дрібним комітом (або разом з чимось іншим).

---

I analyzed this transcript. Here is the ADR documentation produced:

## ADR Обовʼязкові env-ключі у Hasura ConfigMap — data-driven rego `required_env` + Variant B overlay override

## Context and Problem Statement

У системі k8s-правил уже існувала перевірка `HASURA_GRAPHQL_ENABLE_REMOTE_SCHEMA_PERMISSIONS="true"` для `k8s/base/configmap.yaml` Hasura-Deployment. Під час сесії виникло завдання розширити перелік обовʼязкових env-ключів і додати перевірку для не-base overlays, де значення `HASURA_GRAPHQL_ENABLED_APIS` відрізняється залежно від типу середовища.

## Considered Options

* **data-driven `required_env` map у rego** — один `required_env` обʼєкт із типами очікувань (`"true"`, `"false"`, `null`=будь-яке, точний рядок), загальні deny-правила по типах
* **Варіант A (overlay rego package)** — окремий rego-пакет `k8s.hasura_configmap_overlay` для overlay ConfigMap-файлів (`k8s/<env>/configmap.yaml`)
* **Варіант B (JS cross-file, patch у kustomization.yaml)** — перевірка наявності `patches[]` у `k8s/<env>/kustomization.yaml`, що зводить `HASURA_GRAPHQL_ENABLED_APIS` до `"metadata,graphql"` для не-base overlays

## Decision Outcome

Chosen option: "data-driven `required_env` map у rego + Variant B JS cross-file overlay check", because:
1. Підхід data-driven відповідає існуючій конвенції (`conftest.mdc`, «Rego-authoritative + JS-orchestrator», ADR `rego-js-mirror-drift-та-object-get.md`) і дозволяє додавати нові env-ключі без нових deny-правил.
2. Variant B (патч у `kustomization.yaml`, перевірка через JS) обрано замість Variant A, оскільки значення для не-base overlays задається через Kustomize-патч, а не через окремий ConfigMap-файл на кожен overlay.

Фінальний перелік `required_env` у base/dev (`k8s/base/configmap.yaml`):

| Ключ | Очікуване значення |
|---|---|
| `HASURA_GRAPHQL_ENABLE_REMOTE_SCHEMA_PERMISSIONS` | `"true"` |
| `HASURA_GRAPHQL_ENABLE_RELAY` | `"false"` |
| `HASURA_GRAPHQL_ENABLE_TELEMETRY` | `"false"` |
| `HASURA_GRAPHQL_ENABLED_LOG_TYPES` | `"startup,http-log"` (точний рядок) |
| `HASURA_GRAPHQL_DISABLE_EVENTING` | ключ обовʼязковий, значення довільне |
| `HASURA_GRAPHQL_ENABLED_APIS` | `"metadata,graphql,pgdump"` (точний рядок, строго base/dev) |

Для не-base overlays (env ≠ `base`, `dev`): `kustomization.yaml` **обовʼязково** містить `patches[]` на ConfigMap, що встановлює `HASURA_GRAPHQL_ENABLED_APIS="metadata,graphql"`.

### Consequences

* Good, because rego-пакет `k8s.hasura_configmap` залишається авторитетним для per-document перевірок base/dev; JS не дублює rego-логіку (фіксується видаленням `hasuraConfigMapRemoteSchemaPermissionsViolation` і `isConfigMapValueTrue` з `manifests.mjs`).
* Good, because transcript фіксує очікувану користь: `conftest verify` 27/27, `regal lint` чисто, `bun test` 189/189, `eslint` 0 errors.
* Bad, because Variant B вимагає `patches[]` у кожному overlay `kustomization.yaml`, але transcript не містить підтверджених негативних наслідків для існуючих проєктів.

## More Information

- `npm/rules/k8s/policy/hasura_configmap/hasura_configmap.rego` — `required_env` map, deny-правила по 4 типах очікування
- `npm/rules/k8s/policy/hasura_configmap/hasura_configmap_test.rego` — 27 тестів
- `npm/rules/k8s/js/manifests.mjs` — `HASURA_REQUIRED_ENV_KEYS`, `validateHasuraOverlayEnabledApisOverride`, `kustomizationTreeHasHasuraDeployment`, `enabledApisValueFromPatchText`, `hasuraEnabledApisOverrideValue`
- `npm/rules/k8s/js/tests/manifests/tests/check-schema.test.mjs` — 189 тестів; видалено `describe('hasuraConfigMapRemoteSchemaPermissionsViolation')` і `describe('hasuraEnabledApisOverrideValue')`
- `npm/rules/k8s/k8s.mdc` — оновлені секції «ConfigMap для Hasura-Deployment» і «поза base/dev»
- Коміт `5ab342d` (main): `HASURA_OVERLAY_ENABLED_APIS`
- Orphan-пакет `npm/rules/k8s/policy/hasura_configmap_overlay/` (Variant A, від зупинених агентів) видалений тим самим флотом до мерджу

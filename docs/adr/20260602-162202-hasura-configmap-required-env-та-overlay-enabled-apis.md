# Hasura ConfigMap required_env data-driven та overlay ENABLED_APIS override

**Status:** Accepted
**Date:** 2026-06-02

## Context and Problem Statement

У `k8s/base/configmap.yaml` для Hasura-Deployment перевірявся лише один env-ключ. Потрібно: (1) розширити перелік обов'язкових ключів без дублювання deny-правил; (2) визначити механізм перевірки `HASURA_GRAPHQL_ENABLED_APIS` для не-base overlays, де значення має бути `"metadata,graphql"` замість `"metadata,graphql,pgdump"`.

## Considered Options

- Окремі deny-правила на кожен ключ _vs_ data-driven `required_env` map із типами очікування
- Variant A: overlay ConfigMap-файли + rego-пакет `k8s.hasura_configmap_overlay`
- Variant B: патч у `k8s/<env>/kustomization.yaml` + JS cross-file перевірка

## Decision Outcome

Chosen option: "data-driven `required_env` map + Variant B", because data-driven дозволяє додавати ключі без нових deny-правил; Variant B відповідає реальному layout (kustomize-патчі, не окремі configmap-файли).

Required env у base/dev: `HASURA_GRAPHQL_ENABLE_REMOTE_SCHEMA_PERMISSIONS=true`, `ENABLE_RELAY=false`, `ENABLE_TELEMETRY=false`, `ENABLED_LOG_TYPES=startup,http-log`, `DISABLE_EVENTING=<any>`, `ENABLED_APIS=metadata,graphql,pgdump`. Не-base overlays: `patches[]` у `kustomization.yaml` зводять `ENABLED_APIS` до `metadata,graphql`.

### Consequences

- Good, because `conftest verify` 27/27, `regal lint` чисто, `bun test` 189/189, `eslint` 0.
- Good, because JS не дублює rego: `hasuraConfigMapRemoteSchemaPermissionsViolation` і `isConfigMapValueTrue` видалені з `manifests.mjs`.
- Bad, because `kind: Component` overlays пропускаються — порушення не виявляються.
- Bad, because Variant B вимагає `patches[]` у кожному overlay `kustomization.yaml`.

## More Information

- `npm/rules/k8s/policy/hasura_configmap/hasura_configmap.rego` — 4 типи: boolean-insensitive true/false, presence-only (null), точний рядок
- `npm/rules/k8s/policy/hasura_configmap/hasura_configmap_test.rego` — 27 тестів
- `npm/rules/k8s/js/manifests.mjs` — `validateHasuraOverlayEnabledApisOverride`, `enabledApisValueFromPatchText`, `kustomizationTreeHasHasuraDeployment`
- `npm/rules/k8s/js/tests/manifests/tests/check-schema.test.mjs` — 189 тестів
- Коміт `5ab342d`. Orphan `npm/rules/k8s/policy/hasura_configmap_overlay/` (Variant A) видалено.

## Update 2026-06-02

### Ізоляція роботи в git-worktree при конфлікті автономних агентів

Флот із 7 автономних Claude-агентів (Zed, `--allow-dangerously-skip-permissions`) двічі скидав головне дерево через `git reset --hard origin/main`, знищуючи незакомічені зміни. Паралельна сесія реалізувала Variant A (відкинутий) у `main`-working-tree.

Рішення: `kill 50039 78003 66408 66557 66617 66658 66708` (PID поточної сесії виключено) + `npx @nitra/cursor worktree add main-hasura-apis`. Ізольований worktree не зачіпається `reset` головного дерева. Після завершення: `git restore --source=main-hasura-apis --worktree -- <files>` (unstaged). Коміт `0f004d9`, злитий у `main@5ab342d`.

---
session: 1f428343-c999-4b00-81c1-f8e6e25ade37
captured: 2026-06-02T16:16:54+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/1f428343-c999-4b00-81c1-f8e6e25ade37.jsonl
---

## ADR Обовязкові env-ключі у Hasura ConfigMap — data-driven rego required_env

## Context and Problem Statement
У `k8s/base/configmap.yaml` для Deployment з образом `hasura/graphql-engine` перевірявся лише один ключ (`HASURA_GRAPHQL_ENABLE_REMOTE_SCHEMA_PERMISSIONS`). Треба було додати кілька нових обовʼязкових env із різними типами зіставлення: `"true"`, `"false"`, довільне значення (ключ обовʼязковий), та точний рядок.

## Considered Options
* Зберегти окремі deny-правила на кожен ключ
* Узагальнити в одну data-driven `required_env` мапу з типами очікування

## Decision Outcome
Chosen option: "Узагальнити в `required_env` мапу", because дозволяє додавати нові ключі без написання нових правил — лише новий рядок у `required_env`; `expected_hint` виводиться автоматично.

### Consequences
* Good, because transcript фіксує очікувану користь: `hasura_configmap.rego` покриває всі 6 ключів з 27 тестами без дублювання deny-правил.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файли: `npm/rules/k8s/policy/hasura_configmap/hasura_configmap.rego`, `…_test.rego`. Типи в `required_env`: `"true"` — boolean-insensitive; `"false"` — boolean-insensitive; `null` — ключ обовʼязковий, значення не перевіряється; точний рядок — посимвольний збіг. Команда верифікації: `conftest verify -p npm/rules/k8s/policy/hasura_configmap`.

---

## ADR Перевірка HASURA_GRAPHQL_ENABLED_APIS через патч kustomization.yaml (Варіант B)

## Context and Problem Statement
`HASURA_GRAPHQL_ENABLED_APIS` має різні значення залежно від середовища: `base`/`dev` — `"metadata,graphql,pgdump"`, усі інші overlays — `"metadata,graphql"`. Потрібно вибрати механізм перевірки не-base середовищ.

## Considered Options
* Варіант A — кожен overlay має власний повний `k8s/<env>/configmap.yaml` з потрібним значенням; rego-пакет `k8s.hasura_configmap_overlay` перевіряє ці файли пер-документно
* Варіант B — значення для не-base задається патчем у `k8s/<env>/kustomization.yaml`; JS-оркестратор перевіряє наявність `patches[]` зі встановленим значенням `"metadata,graphql"`

## Decision Outcome
Chosen option: "Варіант B", because користувач явно вибрав його; реальний layout проєктів використовує kustomize-патчі, а не окремі configmap-файли для overlays.

### Consequences
* Good, because transcript фіксує очікувану користь: новий `validateHasuraOverlayEnabledApisOverride` в `manifests.mjs` є прямим мірором `validateProdKustomizationOverrides` — той самий патерн cross-file JS-аналізу, що вже використовується для HPA/PDB.
* Bad, because `kind: Component` overlays пропускаються (не білдяться окремо — аналогічно до kubescape), тому потенційні порушення в Component-оверлеях не виявляються.

## More Information
Файли: `npm/rules/k8s/js/manifests.mjs` (функції `validateHasuraOverlayEnabledApisOverride`, `enabledApisValueFromPatchText`, `hasuraEnabledApisOverrideValue`, `kustomizationTreeHasHasuraDeployment`). Тригер: overlay з `k8sEnvSegmentFromRelPath` ≠ `"base"` і ≠ `"dev"`, що успадковує Hasura-base. Вимога: `patches[]` зводить `/data/HASURA_GRAPHQL_ENABLED_APIS` до `"metadata,graphql"` (JSON6902 або Strategic Merge на ConfigMap). Тести: 189/189 pass (`check-schema.test.mjs`).

---

## ADR Виконання фічі в ізольованому git-worktree через конфлікт автономних агентів

## Context and Problem Statement
Під час реалізації ENABLED_APIS флот автономних агентів (7 Claude Agent SDK сесій із прапором `--allow-dangerously-skip-permissions`, запущених через Zed) двічі скидав робоче дерево `main` командами `git reset --hard origin/main`, знищуючи незакомічені зміни. Паралельна сесія встигла реалізувати Варіант A (відкинутий) і потрапила в `main`'s working tree.

## Considered Options
* Продовжувати реалізацію в головному дереві (`main`) за живого флоту
* Зупинити флот і ізолювати роботу в окремому git-worktree

## Decision Outcome
Chosen option: "Зупинити флот + ізольований worktree", because поєднання двох дій: `kill` 7 PID-ів автономних сесій із головного дерева + `npx @nitra/cursor worktree add main-hasura-apis` — усуває і деструктивний агент, і ризик повторного `reset`. Ізольований worktree не зачіпається `reset` головного дерева.

### Consequences
* Good, because transcript фіксує очікувану користь: всі 6 файлів у `.worktrees/main-hasura-apis/` збережено та закомічено (`0f004d9`) без нових reset-інцидентів.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Команди: `kill 50039 78003 66408 66557 66617 66658 66708`; `npx @nitra/cursor worktree add main-hasura-apis "..."`. PID 97867 (поточна сесія) виключено з kill. Зміни повернуто в `main` через `git restore --source=main-hasura-apis --worktree -- <files>` (unstaged, index не зачіпався).

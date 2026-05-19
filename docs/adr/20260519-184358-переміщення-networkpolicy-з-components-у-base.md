---
session: ad135efd-59fa-47be-a7a4-25a9bcbf00c1
captured: 2026-05-19T18:43:58+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/ad135efd-59fa-47be-a7a4-25a9bcbf00c1.jsonl
---

---

## ADR Переміщення NetworkPolicy з `components/` у `base/`

## Context and Problem Statement
До цієї зміни NetworkPolicy жив у sibling-каталозі `components/networkpolicy.yaml` і підключався тільки через overlay, тому dev-середовище не мало мережевих обмежень. Вимога: обмеження мусять бути видні і на dev, тобто NetworkPolicy треба тримати у `base/`, де він застосовується до всіх overlays (включно з dev).

## Considered Options
* NetworkPolicy у `base/networkpolicy.yaml`, підключений через `base/kustomization.yaml` → `resources:`
* NetworkPolicy у `components/networkpolicy.yaml` (попередній стан)
* Overlay-specific NetworkPolicy поруч з маніфестами overlay (допустимо як override)

## Decision Outcome
Chosen option: "NetworkPolicy у `base/networkpolicy.yaml`", because це єдиний спосіб гарантувати, що мережеві обмеження застосовуються на всіх середовищах, у тому числі на dev.

### Consequences
* Good, because NetworkPolicy бачать усі overlays, включно з dev — порушення правила помітні ще до prod.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінені файли:
- `npm/rules/k8s/k8s.mdc` — перероблено секції HPA/PDB/NP; секція `components/` зберігає лише `[hpa.yaml, pdb.yaml]`; версія `1.39` → `1.41`.
- `npm/rules/k8s/fix/manifests/check.mjs` — видалено `failIfBaseLayerHasLocalNetworkPolicy`, `validateComponentsNetworkPolicyFile`; `validateNetworkPoliciesForK8sWorkloads` / `ensureNetworkPoliciesForWorkloadsInDir` тепер завжди шукають `networkpolicy.yaml` поруч із шаром; autofix додає запис у `base/kustomization.yaml` → `resources:`.
- `npm/rules/k8s/policy/base_kustomization/base_kustomization.rego` + `_test.rego` — прибрано `deny` на `networkpolicy.yaml` у `base/resources`; додано `test_allow_networkpolicy_yaml_in_resources`.
- `npm/rules/k8s/fix/manifests/check-schema.test.mjs`, `run-roots.test.mjs` — тести оновлені під нову структуру `components/`.
- Версія `npm/package.json`: `1.13.52` → `1.13.54`; записи в `npm/CHANGELOG.md`.

Підтверджено `bun test npm/rules/k8s/` — 222 pass; `conftest verify -p npm/rules` — 465 pass; `regal lint npm/rules` — 0 violations.

---

## ADR Обмеження розширень k8s YAML лише до `.yaml`

## Context and Problem Statement
Правила `check k8s` і `lint-k8s` обробляли обидва розширення — `.yaml` і `.yml`. У проєкті канонічне розширення для k8s YAML — лише `.yaml`; файли `.yml` заборонені (відповідне правило вже існує), тому подвійна підтримка в регулярних виразах і glob-ах була надлишковою.

## Considered Options
* Видалити підтримку `.yml` — обробляти лише `.yaml`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Видалити підтримку `.yml`", because `.yml` вже заборонений правилом, тому підтримувати його в логіці перевірок зайве.

### Consequences
* Good, because код і glob-и спрощуються; правило стає консистентним із забороною `.yml`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінені файли:
- `npm/rules/k8s/fix/manifests/check.mjs` — `YAML_EXTENSION_RE` змінено з `/\.ya?ml$/iu` на `/\.yaml$/iu`; `.yml`-гілка у `checkK8sYamlFile` видалена; оновлено JSDoc і повідомлення у валідаторі kustomization.
- `npm/rules/k8s/policy/manifest/target.json`, `base_manifest/target.json`, `gateway/target.json`, `hpa_pdb/target.json` — `walkGlob` скорочено до `["**/k8s/**/*.yaml"]`.
- `npm/rules/k8s/policy/base_kustomization/base_kustomization.rego` — `is_hpa_or_pdb_filename` більше не перевіряє `.yml`-варіанти.
- `npm/rules/k8s/policy/base_kustomization/base_kustomization_test.rego` — `test_deny_hpa_yml_in_subdir` → `test_deny_hpa_yaml_in_subdir`.
- `npm/rules/k8s/k8s.mdc` — заміна `.yaml / .yml` на `.yaml` у секції локальних шляхів kustomization.

Підтверджено `bun test npm/rules/k8s/` — 222 pass; `conftest verify -p npm/rules` — 465 pass; `regal lint npm/rules` — 0 violations.

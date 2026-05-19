---
session: ad135efd-59fa-47be-a7a4-25a9bcbf00c1
captured: 2026-05-19T18:48:30+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/ad135efd-59fa-47be-a7a4-25a9bcbf00c1.jsonl
---

## ADR Переміщення NetworkPolicy з `components/` у `base/`

## Context and Problem Statement
У проєкті діяв канон: NetworkPolicy для кожного Deployment живе у sibling-каталозі `components/networkpolicy.yaml` і підключається через overlay. Це означало, що на dev-середовищі, де overlays часто не застосовуються, мережеві обмеження були відсутні.

## Considered Options
* NetworkPolicy у `components/` (попередній канон)
* NetworkPolicy у `base/networkpolicy.yaml`, підключений через `base/kustomization.yaml` `resources:`

## Decision Outcome
Chosen option: "NetworkPolicy у `base/networkpolicy.yaml`", because обмеження мають бути видимі і на dev-середовищі — `base/` застосовується завжди, незалежно від overlay.

### Consequences
* Good, because NetworkPolicy активний у всіх середовищах (dev, ua, prod) без додаткових overlay-підключень.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінені файли: `npm/rules/k8s/k8s.mdc` (version `1.39` → `1.40`), `npm/rules/k8s/fix/manifests/check.mjs` (видалено `failIfBaseLayerHasLocalNetworkPolicy`, `validateComponentsNetworkPolicyFile`; NP autofix тепер пише у `base/kustomization.yaml` `resources:`), `npm/rules/k8s/policy/base_kustomization/base_kustomization.rego` (deny на NP у base-resources знято, додано `test_allow_networkpolicy_yaml_in_resources`). Overlay-specific NetworkPolicy поряд дозволено. `npm/package.json` 1.13.52 → 1.13.53; `npm/CHANGELOG.md` запис `[1.13.53]`.

---

## ADR Аналіз лише `.yaml` у правилах `k8s`, збереження safety-net для `.yml`

## Context and Problem Statement
Правила під `npm/rules/k8s/` читали і обробляли файли з розширеннями `.yaml` і `.yml`. У проєкті `.yml` під `k8s/` заборонено, але `check k8s` мовчки пропускав такі файли або обробляв їх нарівні з `.yaml`.

## Considered Options
* Фільтрувати лише `*.yaml` (тихо ігнорувати `.yml`)
* Пропускати `.yml` через обхідник, але одразу завершувати `checkK8sYamlFile` з помилкою-вказівкою перейменувати

## Decision Outcome
Chosen option: "Пропускати `.yml` через обхідник із fail-повідомленням", because тихий skip дозволяв `.yml`-файлам під `k8s/` уникати будь-якої перевірки — safety-net `fail(\`${rel}: розширення .yml — перейменуй на .yaml\`)` є єдиним gate для випадково доданих файлів.

### Consequences
* Good, because transcript фіксує очікувану користь: `.yml`-файли не залишаються непоміченими — `check k8s` одразу вказує на потребу перейменування.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
`YAML_EXTENSION_RE` і `K8S_YAML_EXT_RE` у `npm/rules/k8s/fix/manifests/check.mjs` залишено як `/\.ya?ml$/iu`; `target.json` для rego-policies (`manifest/`, `base_manifest/`, `gateway/`, `hpa_pdb/`) змінено на `"**/k8s/**/*.yaml"` (rego не валідує розширення — fail відбувається раніше, у JS). `base_kustomization.rego`: `is_hpa_or_pdb_filename` позбавлено `.yml`-варіантів. `npm/package.json` 1.13.53 → 1.13.54; `npm/CHANGELOG.md` запис `[1.13.54]`.

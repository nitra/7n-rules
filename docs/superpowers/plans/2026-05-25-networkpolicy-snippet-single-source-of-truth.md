# NetworkPolicy snippet як єдине джерело правди — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Зробити `common.snippet.yaml` єдиним джерелом правди для canonical NetworkPolicy spec: JS читає snippet, rego перевіряє через superset-порівняння з snippet (через conftest `templateData`), StatefulSet отримує окремий snippet для intra-replica правил.

**Architecture:** JS-тонкий шар читає snippet-файли й передає їх у `templateData` → `runConftestBatch`. Rego отримує `data.template.snippet` (common) і `data.template.statefulset_snippet` (для StatefulSet) та перевіряє що всі canonical-правила присутні в `input.spec.egress` (superset, не exact-match). `buildNetworkPolicyYaml` приймає `kind`, додає анотацію `nitra.dev/workload-kind`, для StatefulSet вливає правила з `statefulset.snippet.yaml`.

**Tech Stack:** Bun (tester), `yaml` npm package, OPA Rego 1.x + conftest 0.62, JSDoc, ESM modules.

---

## Поточний стан (вже зроблено в working tree)

До початку виконання плану — ці зміни вже є в uncommitted diff:
- `buildNetworkPolicyYaml` читає з snippet, `readNetworkPolicySnippet()` — новий export
- `NETWORK_POLICY_EGRESS_YAML`, `NETWORK_POLICY_IN_CLUSTER_DEFAULT_PORTS` — видалено
- Тести `check-schema.test.mjs` оновлені під нові функції
- `networkpolicy.snippet.yaml` оновлено (link-local DNS блок)
- Line 6510: `templateData: { snippet: readNetworkPolicySnippet() }` — вже передає snippet у conftest

**Залишається зробити:** Tasks 1-8 нижче.

---

## Файли змін

| Дія | Файл |
|-----|------|
| Rename | `npm/rules/k8s/policy/network_policy/template/networkpolicy.snippet.yaml` → `common.snippet.yaml` |
| Create | `npm/rules/k8s/policy/network_policy/template/statefulset.snippet.yaml` |
| Modify | `npm/rules/k8s/js/manifests.mjs` (4 місця) |
| Modify | `npm/rules/k8s/policy/network_policy/network_policy.rego` |
| Modify | `npm/rules/k8s/policy/network_policy/network_policy_test.rego` |
| Modify | `npm/rules/k8s/js/tests/manifests/tests/check-schema.test.mjs` |
| Modify | `npm/rules/k8s/k8s.mdc` |
| Modify | `npm/CHANGELOG.md` |

---

## Task 1: Перейменувати snippet і створити statefulset.snippet.yaml

**Files:**
- Rename: `npm/rules/k8s/policy/network_policy/template/networkpolicy.snippet.yaml` → `common.snippet.yaml`
- Create: `npm/rules/k8s/policy/network_policy/template/statefulset.snippet.yaml`
- Modify: `npm/rules/k8s/js/manifests.mjs:~4247`

- [ ] **Крок 1: Перейменувати файл**

```bash
cd /Users/vitaliytv/www/nitra/cursor
mv npm/rules/k8s/policy/network_policy/template/networkpolicy.snippet.yaml \
   npm/rules/k8s/policy/network_policy/template/common.snippet.yaml
```

- [ ] **Крок 2: Оновити URL у manifests.mjs (~рядок 4247)**

Знайти:
```js
const NETWORK_POLICY_SNIPPET_URL = new URL(
  '../policy/network_policy/template/networkpolicy.snippet.yaml',
  import.meta.url
)
```

Замінити на:
```js
const NETWORK_POLICY_SNIPPET_URL = new URL(
  '../policy/network_policy/template/common.snippet.yaml',
  import.meta.url
)
```

- [ ] **Крок 3: Створити statefulset.snippet.yaml**

Файл `npm/rules/k8s/policy/network_policy/template/statefulset.snippet.yaml`:

```yaml
spec:
  egress:
    # intra-replica реплікація (StatefulSet pod ↔ pod у тому ж namespace)
    - to:
        - podSelector:
            matchLabels: {}
  ingress:
    # intra-replica реплікація (StatefulSet pod ↔ pod у тому ж namespace)
    - from:
        - podSelector:
            matchLabels: {}
```

- [ ] **Крок 4: Запустити bun test**

```bash
cd /Users/vitaliytv/www/nitra/cursor
bun test npm/rules/k8s/js/tests/manifests/tests/check-schema.test.mjs 2>&1 | tail -5
```

Очікується: усі тести pass.

- [ ] **Крок 5: Commit**

```bash
git add npm/rules/k8s/policy/network_policy/template/
git add npm/rules/k8s/js/manifests.mjs
git commit -m "refactor(k8s): rename networkpolicy.snippet.yaml → common.snippet.yaml, add statefulset.snippet.yaml"
```

---

## Task 2: Виправити dangling виклик networkPolicyManifestViolations

**Files:**
- Modify: `npm/rules/k8s/js/manifests.mjs:~5040-5054`

Функція `networkPolicyManifestViolations` видалена у working tree, але виклик у `validateNetworkPolicyForWorkload` (~5048) лишився — runtime-помилка при реальному виконанні. Структурна перевірка делегована rego.

- [ ] **Крок 1: Переписати validateNetworkPolicyForWorkload**

Знайти (~5040-5054):
```js
function validateNetworkPolicyForWorkload(npDocs, workloadName, appLabel, workloadKind, npRel, fail, passFn) {
  const matchedNp = findNetworkPolicyByDeployName(npDocs, workloadName)
  if (matchedNp === undefined) {
    fail(
      `${npRel}: відсутній або не знайдено NetworkPolicy з metadata.name='${workloadName}' для ${workloadKind} (k8s.mdc)`
    )
    return
  }
  const npErrs = networkPolicyManifestViolations(matchedNp, workloadName, appLabel)
  if (npErrs.length === 0) {
    passFn(`${npRel}: NetworkPolicy для ${workloadKind} '${workloadName}' валідний (k8s.mdc)`)
  } else {
    for (const e of npErrs) fail(`${npRel}: ${e} (k8s.mdc)`)
  }
}
```

Замінити на:
```js
function validateNetworkPolicyForWorkload(npDocs, workloadName, appLabel, workloadKind, npRel, fail, passFn) {
  const matchedNp = findNetworkPolicyByDeployName(npDocs, workloadName)
  if (matchedNp === undefined) {
    fail(
      `${npRel}: відсутній або не знайдено NetworkPolicy з metadata.name='${workloadName}' для ${workloadKind} (k8s.mdc)`
    )
    return
  }
  const spec = /** @type {Record<string, unknown>} */ (matchedNp).spec
  const app = networkPolicyPodSelectorAppLabel(spec)
  if (app !== appLabel) {
    fail(
      `${npRel}: NetworkPolicy для ${workloadKind} '${workloadName}': podSelector.matchLabels.app='${app}' не збігається з очікуваним '${appLabel}' (k8s.mdc)`
    )
    return
  }
  passFn(`${npRel}: NetworkPolicy для ${workloadKind} '${workloadName}' знайдено (k8s.mdc)`)
}
```

- [ ] **Крок 2: Переконатись що bun test проходить**

```bash
cd /Users/vitaliytv/www/nitra/cursor
bun test npm/rules/k8s/js/tests/manifests/tests/check-schema.test.mjs 2>&1 | tail -5
```

Очікується: pass.

- [ ] **Крок 3: Commit**

```bash
git add npm/rules/k8s/js/manifests.mjs
git commit -m "fix(k8s): remove dangling networkPolicyManifestViolations call, delegate structural check to rego"
```

---

## Task 3: Додати kind-параметр і StatefulSet-підтримку в buildNetworkPolicyYaml

**Files:**
- Modify: `npm/rules/k8s/js/manifests.mjs` (~4246-4280, ~6247-6265, ~6316-6339, ~6510)
- Modify: `npm/rules/k8s/js/tests/manifests/tests/check-schema.test.mjs`

- [ ] **Крок 1: Додати loadSnippetSpec і оновити buildNetworkPolicyYaml**

Знайти у `manifests.mjs` від `const NETWORK_POLICY_SNIPPET_URL` до кінця `buildNetworkPolicyYaml` (~4246-4280), замінити весь блок:

```js
const NETWORK_POLICY_COMMON_SNIPPET_URL = new URL(
  '../policy/network_policy/template/common.snippet.yaml',
  import.meta.url
)
const NETWORK_POLICY_STATEFULSET_SNIPPET_URL = new URL(
  '../policy/network_policy/template/statefulset.snippet.yaml',
  import.meta.url
)

/** @type {Record<string, Record<string, unknown>>} */
const _snippetCache = {}

/**
 * Читає snippet-файл і повертає розпарсений spec. Результат кешується.
 * @param {'common' | 'statefulset'} snippetName ім'я сніпету
 * @returns {{ podSelector?: Record<string, unknown>, policyTypes?: string[], ingress?: unknown[], egress?: unknown[] }}
 */
export function loadSnippetSpec(snippetName) {
  if (_snippetCache[snippetName]) return _snippetCache[snippetName]
  const url = snippetName === 'statefulset'
    ? NETWORK_POLICY_STATEFULSET_SNIPPET_URL
    : NETWORK_POLICY_COMMON_SNIPPET_URL
  const raw = readFileSync(fileURLToPath(url), 'utf-8')
  _snippetCache[snippetName] = /** @type {any} */ (parseDocument(raw).toJS()).spec
  return _snippetCache[snippetName]
}

/**
 * Читає common.snippet.yaml і повертає розпарсений spec.
 * @deprecated Використовуй loadSnippetSpec('common')
 */
export function readNetworkPolicySnippet() {
  return loadSnippetSpec('common')
}

/**
 * Канонічний YAML **NetworkPolicy** для workload з іменем `deployName` і міткою `app`.
 * Структура spec береться зі snippet — не дублюється в коді.
 * @param {string} deployName `metadata.name` workload (Deployment, StatefulSet, …)
 * @param {string} appLabel `spec.selector.matchLabels.app`
 * @param {string} [kind] `kind` workload — впливає на набір canonical правил (default: 'Deployment')
 * @returns {string} вміст `networkpolicy.yaml`
 */
export function buildNetworkPolicyYaml(deployName, appLabel, kind = 'Deployment') {
  const schemaUrl = `${YANNH_BASE}networkpolicy-networking-v1.json`
  const spec = JSON.parse(JSON.stringify(loadSnippetSpec('common')))
  spec.podSelector.matchLabels = { app: appLabel }
  if (kind === 'StatefulSet') {
    const ssSpec = loadSnippetSpec('statefulset')
    spec.egress = [...(spec.egress ?? []), ...(ssSpec.egress ?? [])]
    spec.ingress = [...(spec.ingress ?? []), ...(ssSpec.ingress ?? [])]
  }
  const specYaml = stringify(spec, { indent: 2 }).replace(/^(?!$)/gm, '  ').trimEnd()
  return `# yaml-language-server: $schema=${schemaUrl}
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: ${deployName}
  annotations:
    nitra.dev/workload-kind: ${kind}
spec:
${specYaml}`
}
```

- [ ] **Крок 2: Оновити appendNetworkPolicyDocuments (~6247) — передати kind**

Знайти у функції `appendNetworkPolicyDocuments` виклик `buildNetworkPolicyYaml(name, appLabel)` і замінити на `buildNetworkPolicyYaml(name, appLabel, kind)`.

Переконатись що `for (const { name, appLabel, kind } of toAdd)` деструктурує `kind`.

- [ ] **Крок 3: Оновити regenerateLegacyNetworkPolicyDocsInFile (~6316) — читати kind з анотації**

Знайти у функції `regenerateLegacyNetworkPolicyDocsInFile` цикл `for (const doc of docs)`. Замінити:
```js
    if (typeof name === 'string' && name !== '' && appLabel !== '') specs.push({ name, appLabel })
```
На:
```js
    const docRec = /** @type {Record<string, unknown>} */ (doc)
    const meta = docRec.metadata
    const annotations = (meta !== null && typeof meta === 'object' && !Array.isArray(meta))
      ? /** @type {Record<string, unknown>} */ (meta).annotations
      : null
    const rawKind = (annotations !== null && typeof annotations === 'object' && !Array.isArray(annotations))
      ? /** @type {Record<string, unknown>} */ (annotations)['nitra.dev/workload-kind']
      : null
    const kind = typeof rawKind === 'string' && rawKind !== '' ? rawKind : 'Deployment'
    if (typeof name === 'string' && name !== '' && appLabel !== '') specs.push({ name, appLabel, kind })
```

Оновити `.map` нижче:
```js
  const blocks = specs.map(({ name, appLabel, kind }, i) => {
    const block = buildNetworkPolicyYaml(name, appLabel, kind)
```

- [ ] **Крок 4: Оновити templateData (~6510)**

Знайти:
```js
{ ns: 'k8s.network_policy', dir: 'k8s/network_policy', files: allYaml, templateData: { snippet: readNetworkPolicySnippet() } },
```

Замінити на:
```js
{
  ns: 'k8s.network_policy',
  dir: 'k8s/network_policy',
  files: allYaml,
  templateData: {
    snippet: loadSnippetSpec('common'),
    statefulset_snippet: loadSnippetSpec('statefulset'),
  },
},
```

- [ ] **Крок 5: Запустити bun test**

```bash
cd /Users/vitaliytv/www/nitra/cursor
bun test npm/rules/k8s/js/tests/manifests/tests/check-schema.test.mjs 2>&1 | tail -5
```

Очікується: pass.

- [ ] **Крок 6: Оновити тести у check-schema.test.mjs**

Додати `loadSnippetSpec` до imports (поряд з `readNetworkPolicySnippet`).

Знайти тест `'buildNetworkPolicyYaml: name, app та spec.egress/ingress відповідають snippet'` (~2217), замінити на два тести:

```js
test('buildNetworkPolicyYaml (Deployment): name, app, annotation та spec відповідають common snippet', () => {
  const snippet = loadSnippetSpec('common')
  const result = parseYaml(buildNetworkPolicyYaml('api', 'api', 'Deployment'))
  expect(result.metadata.name).toBe('api')
  expect(result.metadata.annotations['nitra.dev/workload-kind']).toBe('Deployment')
  expect(result.spec.podSelector.matchLabels.app).toBe('api')
  expect(result.spec.egress).toEqual(snippet.egress)
  expect(result.spec.ingress).toEqual(snippet.ingress)
})

test('buildNetworkPolicyYaml (StatefulSet): annotation та egress/ingress = common + statefulset merged', () => {
  const common = loadSnippetSpec('common')
  const ss = loadSnippetSpec('statefulset')
  const result = parseYaml(buildNetworkPolicyYaml('db', 'db', 'StatefulSet'))
  expect(result.metadata.annotations['nitra.dev/workload-kind']).toBe('StatefulSet')
  expect(result.spec.podSelector.matchLabels.app).toBe('db')
  for (const rule of common.egress) {
    expect(result.spec.egress).toContainEqual(rule)
  }
  for (const rule of ss.egress) {
    expect(result.spec.egress).toContainEqual(rule)
  }
})
```

- [ ] **Крок 7: Запустити bun test фінально**

```bash
cd /Users/vitaliytv/www/nitra/cursor
bun test npm/rules/k8s/js/tests/manifests/tests/check-schema.test.mjs 2>&1 | tail -5
```

Очікується: pass.

- [ ] **Крок 8: Commit**

```bash
git add npm/rules/k8s/js/manifests.mjs
git add npm/rules/k8s/js/tests/manifests/tests/check-schema.test.mjs
git commit -m "feat(k8s): buildNetworkPolicyYaml kind param, nitra.dev/workload-kind annotation, StatefulSet snippet merge"
```

---

## Task 4: Переписати network_policy.rego на superset check

**Files:**
- Modify: `npm/rules/k8s/policy/network_policy/network_policy.rego`

- [ ] **Крок 1: Написати новий network_policy.rego**

Замінити файл повністю:

```rego
# Пер-документна структурна перевірка NetworkPolicy.
# Cross-file (metadata.name = workload, podSelector.app = мітка app) — JS (validateNetworkPolicyForWorkload).
# Структура spec.egress перевіряється через superset-порівняння зі snippet (common.snippet.yaml,
# statefulset.snippet.yaml). Snippet передається через templateData → data.template.snippet /
# data.template.statefulset_snippet при виклику runConftestBatch для k8s.network_policy.
#
# Семантика: кожне canonical-правило зі snippet має бути присутнє в input.spec.egress/ingress.
# Додаткові правила (extra egress/ingress) — дозволені (superset, не exact-match).
#
# Запуск (dev):
#   conftest test path/to/networkpolicy.yaml -p npm/rules/k8s/policy/network_policy \
#     --namespace k8s.network_policy --data <template-data.json>
# де template-data.json = {"template": {"snippet": <common.spec>, "statefulset_snippet": <ss.spec>}}
package k8s.network_policy

import rego.v1

deny contains msg if {
	is_np_doc
	input.kind != "NetworkPolicy"
	msg := sprintf("kind має бути NetworkPolicy (зараз: %v) (k8s.mdc)", [input.kind])
}

deny contains msg if {
	is_np_doc
	input.apiVersion != "networking.k8s.io/v1"
	msg := sprintf("apiVersion має бути networking.k8s.io/v1 (зараз: %v) (k8s.mdc)", [input.apiVersion])
}

deny contains "spec відсутній або некоректний (NetworkPolicy; k8s.mdc)" if {
	is_np_doc
	not is_object(object.get(input, "spec", null))
}

deny contains "spec.podSelector.matchLabels відсутній (NetworkPolicy; k8s.mdc)" if {
	is_np_doc
	spec := object.get(input, "spec", null)
	is_object(spec)
	selector := object.get(spec, "podSelector", null)
	is_object(selector)
	not is_object(object.get(selector, "matchLabels", null))
}

deny contains "spec.podSelector.matchLabels.app відсутній або порожній (NetworkPolicy; k8s.mdc)" if {
	is_np_doc
	spec := object.get(input, "spec", null)
	is_object(spec)
	selector := object.get(spec, "podSelector", null)
	is_object(selector)
	ml := object.get(selector, "matchLabels", null)
	is_object(ml)
	object.get(ml, "app", null) == null
}

deny contains "spec.policyTypes має містити Ingress і Egress (NetworkPolicy; k8s.mdc)" if {
	is_np_doc
	spec := object.get(input, "spec", null)
	is_object(spec)
	types := object.get(spec, "policyTypes", [])
	not policy_types_has_ingress_and_egress(types)
}

deny contains "spec.ingress має містити from.podSelector (NetworkPolicy; k8s.mdc)" if {
	is_np_doc
	spec := object.get(input, "spec", null)
	is_object(spec)
	not ingress_has_pod_selector_rule(spec)
}

# Superset check: кожне canonical egress-правило зі common.snippet має бути присутнє в input.spec.egress.
deny contains msg if {
	is_np_doc
	is_object(input.spec)
	some canon_rule in data.template.snippet.egress
	not list_contains(input.spec.egress, canon_rule)
	msg := sprintf(
		"NetworkPolicy %v: відсутнє обов'язкове egress-правило (common.snippet.yaml; k8s.mdc): %v",
		[input.metadata.name, json.marshal(canon_rule)],
	)
}

# Superset check для StatefulSet: intra-replica egress-правила зі statefulset.snippet.
deny contains msg if {
	is_np_doc
	input.metadata.annotations["nitra.dev/workload-kind"] == "StatefulSet"
	is_object(input.spec)
	some canon_rule in data.template.statefulset_snippet.egress
	not list_contains(input.spec.egress, canon_rule)
	msg := sprintf(
		"NetworkPolicy %v (StatefulSet): відсутнє intra-replica egress-правило (statefulset.snippet.yaml; k8s.mdc): %v",
		[input.metadata.name, json.marshal(canon_rule)],
	)
}

# Superset check для StatefulSet: intra-replica ingress-правила зі statefulset.snippet.
deny contains msg if {
	is_np_doc
	input.metadata.annotations["nitra.dev/workload-kind"] == "StatefulSet"
	is_object(input.spec)
	some canon_rule in data.template.statefulset_snippet.ingress
	not list_contains(input.spec.ingress, canon_rule)
	msg := sprintf(
		"NetworkPolicy %v (StatefulSet): відсутнє intra-replica ingress-правило (statefulset.snippet.yaml; k8s.mdc): %v",
		[input.metadata.name, json.marshal(canon_rule)],
	)
}

is_np_doc if input.kind == "NetworkPolicy"

is_np_doc if startswith(object.get(input, "apiVersion", ""), "networking.k8s.io/")

policy_types_has_ingress_and_egress(types) if {
	is_array(types)
	"Ingress" in types
	"Egress" in types
}

ingress_has_pod_selector_rule(spec) if {
	ingress := object.get(spec, "ingress", null)
	is_array(ingress)
	some rule in ingress
	is_object(rule)
	from_list := object.get(rule, "from", null)
	is_array(from_list)
	some peer in from_list
	is_object(peer)
	object.get(peer, "podSelector", null) != null
}

# Helper: перевіряє чи список items містить елемент item (структурна рівність, порядок байдужий).
list_contains(items, item) if {
	is_array(items)
	some i
	items[i] == item
}
```

- [ ] **Крок 2: Перевірити синтаксис**

```bash
which opa && opa check --strict npm/rules/k8s/policy/network_policy/network_policy.rego || echo "opa not in PATH, skip"
```

- [ ] **Крок 3: Commit**

```bash
git add npm/rules/k8s/policy/network_policy/network_policy.rego
git commit -m "refactor(k8s/rego): superset check for NetworkPolicy egress/ingress, StatefulSet annotation dispatch"
```

---

## Task 5: Переписати network_policy_test.rego

**Files:**
- Modify: `npm/rules/k8s/policy/network_policy/network_policy_test.rego`

Тести не залежать від реального snippet-файлу (OPA tests mock via `with data as`). Використовуємо мінімальний `mock_template` з двома правилами — достатньо, щоб перевірити superset-логіку rego.

- [ ] **Крок 1: Написати новий network_policy_test.rego**

```rego
package k8s.network_policy_test

import rego.v1

import data.k8s.network_policy

# Мінімальний мок canonical даних для тестів.
# Реальний canonical (common.snippet.yaml) передається через runConftestBatch templateData у CI;
# тут — мінімальний набір для перевірки superset-логіки rego, без синхронізації з файлом.
mock_common_egress := [
	{
		"to": [{"namespaceSelector": {"matchLabels": {"kubernetes.io/metadata.name": "kube-system"}}, "podSelector": {"matchLabels": {"k8s-app": "kube-dns"}}}],
		"ports": [{"protocol": "UDP", "port": 53}, {"protocol": "TCP", "port": 53}],
	},
	{
		"to": [{"ipBlock": {"cidr": "169.254.0.0/16"}}],
		"ports": [{"protocol": "UDP", "port": 53}, {"protocol": "TCP", "port": 53}],
	},
]

mock_ss_egress := [{"to": [{"podSelector": {"matchLabels": {}}}]}]

mock_ss_ingress := [{"from": [{"podSelector": {"matchLabels": {}}}]}]

mock_template := {
	"snippet": {
		"egress": mock_common_egress,
		"ingress": [{"from": [{"podSelector": {}}]}],
	},
	"statefulset_snippet": {
		"egress": mock_ss_egress,
		"ingress": mock_ss_ingress,
	},
}

valid_np := {
	"apiVersion": "networking.k8s.io/v1",
	"kind": "NetworkPolicy",
	"metadata": {"name": "api", "annotations": {"nitra.dev/workload-kind": "Deployment"}},
	"spec": {
		"podSelector": {"matchLabels": {"app": "api"}},
		"policyTypes": ["Ingress", "Egress"],
		"ingress": [{"from": [{"podSelector": {}}]}],
		"egress": mock_common_egress,
	},
}

test_valid_network_policy if {
	count(network_policy.deny) == 0 with input as valid_np
		with data.template as mock_template
}

test_extra_egress_rules_allowed if {
	extra_rule := {"to": [{"ipBlock": {"cidr": "203.0.113.0/24"}}], "ports": [{"protocol": "TCP", "port": 9000}]}
	extra_np := json.patch(valid_np, [{"op": "replace", "path": "/spec/egress", "value": array.concat(mock_common_egress, [extra_rule])}])
	count(network_policy.deny) == 0 with input as extra_np
		with data.template as mock_template
}

test_wrong_kind if {
	bad := json.patch(valid_np, [{"op": "replace", "path": "/kind", "value": "Service"}])
	some msg in network_policy.deny with input as bad
		with data.template as mock_template
	contains(msg, "kind має бути NetworkPolicy")
}

test_missing_match_labels if {
	bad := json.patch(valid_np, [{"op": "remove", "path": "/spec/podSelector/matchLabels"}])
	some msg in network_policy.deny with input as bad
		with data.template as mock_template
	contains(msg, "podSelector.matchLabels")
}

test_deny_missing_app_label if {
	bad := json.patch(valid_np, [{"op": "remove", "path": "/spec/podSelector/matchLabels/app"}])
	some msg in network_policy.deny with input as bad
		with data.template as mock_template
	contains(msg, "matchLabels.app")
}

test_deny_egress_missing_canonical_rule if {
	# Виймаємо link-local правило — superset-check повинен поскаржитись
	egress_without_link_local := [r | some r in mock_common_egress; r.to[0] != {"ipBlock": {"cidr": "169.254.0.0/16"}}]
	bad := json.patch(valid_np, [{"op": "replace", "path": "/spec/egress", "value": egress_without_link_local}])
	some msg in network_policy.deny with input as bad
		with data.template as mock_template
	contains(msg, "відсутнє обов'язкове egress-правило")
}

test_statefulset_requires_intra_replica_egress if {
	ss_np := json.patch(valid_np, [
		{"op": "replace", "path": "/metadata/annotations/nitra.dev~1workload-kind", "value": "StatefulSet"},
		{"op": "replace", "path": "/spec/egress", "value": mock_common_egress},
	])
	some msg in network_policy.deny with input as ss_np
		with data.template as mock_template
	contains(msg, "intra-replica egress-правило")
}

test_statefulset_valid_with_all_rules if {
	full_egress := array.concat(mock_common_egress, mock_ss_egress)
	full_ingress := array.concat([{"from": [{"podSelector": {}}]}], mock_ss_ingress)
	ss_np := json.patch(valid_np, [
		{"op": "replace", "path": "/metadata/annotations/nitra.dev~1workload-kind", "value": "StatefulSet"},
		{"op": "replace", "path": "/spec/egress", "value": full_egress},
		{"op": "replace", "path": "/spec/ingress", "value": full_ingress},
	])
	count(network_policy.deny) == 0 with input as ss_np
		with data.template as mock_template
}
```

- [ ] **Крок 2: Перевірити rego-тести (якщо є conftest у PATH)**

```bash
which conftest && conftest verify \
  -p npm/rules/k8s/policy/network_policy \
  --namespace k8s.network_policy_test || echo "conftest not in PATH — тести запустить CI (lint-js.yml)"
```

- [ ] **Крок 3: Commit**

```bash
git add npm/rules/k8s/policy/network_policy/network_policy_test.rego
git commit -m "test(k8s/rego): rewrite network_policy tests — superset semantics, StatefulSet dispatch, extra-rules-allowed"
```

---

## Task 6: Оновити k8s.mdc

**Files:**
- Modify: `npm/rules/k8s/k8s.mdc`

- [ ] **Крок 1: Знайти NetworkPolicy-блок у k8s.mdc**

```bash
grep -n "NetworkPolicy\|network_policy\|5432\|kube-dns\|169\.254" /Users/vitaliytv/www/nitra/cursor/npm/rules/k8s/k8s.mdc | head -20
```

Визначити рядки, де перераховані порти (5432, 3306, 6379 тощо) у контексті NetworkPolicy egress.

- [ ] **Крок 2: Прибрати вбудований перелік портів і структуру egress**

Знайти і видалити/замінити YAML-блок з переліком egress-правил та портів у `.mdc`.

Замінити на:
```markdown
**Канон NetworkPolicy spec:**

Структура `spec.egress`/`ingress`/`policyTypes` визначається **виключно** у snippet-файлах:
- `npm/rules/k8s/policy/network_policy/template/common.snippet.yaml` — для всіх workload-типів.
- `npm/rules/k8s/policy/network_policy/template/statefulset.snippet.yaml` — для StatefulSet (intra-replica).

Для зміни канону — редагуй лише ці файли. JS-генератор (`buildNetworkPolicyYaml`) і rego-перевірка підтягнуться автоматично.

**DNS через GKE NodeLocal DNSCache:**

У GKE з NodeLocal DNSCache `/etc/resolv.conf` podу вказує не на ClusterIP kube-dns, а на link-local адресу ноди (`169.254.0.0/16`, RFC 3927). Запит спочатку йде туди → CoreDNS. Тому `egress` без `ipBlock: cidr: 169.254.0.0/16` блокує DNS навіть при наявності kube-system-правила. Обидва правила — у `common.snippet.yaml`.

**StatefulSet:** annotate NP з `nitra.dev/workload-kind: StatefulSet` (проставляє `buildNetworkPolicyYaml`) → rego також перевіряє intra-replica правила з `statefulset.snippet.yaml`.
```

- [ ] **Крок 3: Перевірити lint-text**

```bash
cd /Users/vitaliytv/www/nitra/cursor
npx @nitra/cursor lint-text 2>&1 | tail -10
```

- [ ] **Крок 4: Commit**

```bash
git add npm/rules/k8s/k8s.mdc
git commit -m "docs(k8s): NetworkPolicy — remove duplicate port list, reference snippets as source of truth"
```

---

## Task 7: CHANGELOG + version bump

**Files:**
- Modify: `npm/CHANGELOG.md`
- Modify: `npm/package.json` (version field)

- [ ] **Крок 1: Перевірити поточну версію**

```bash
cat /Users/vitaliytv/www/nitra/cursor/npm/package.json | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['version'])"
```

- [ ] **Крок 2: Перевірити check changelog**

```bash
cd /Users/vitaliytv/www/nitra/cursor
npx @nitra/cursor check changelog 2>&1 | tail -10
```

- [ ] **Крок 3: Додати запис у CHANGELOG.md**

Видалення `networkPolicyManifestViolations` (було public export) → **major** bump або minor якщо вже видалена в попередній версії. Додавання `loadSnippetSpec` + 3rd param у `buildNetworkPolicyYaml` → minor. Обери відповідно.

Приклад запису (адаптуй номер версії):
```markdown
## [X.Y.0] — 2026-05-25

### Added
- `loadSnippetSpec(snippetName)` — reads and caches canonical NetworkPolicy spec from snippet files (`common` | `statefulset`).
- `buildNetworkPolicyYaml` optional `kind` parameter (default: `'Deployment'`); adds `nitra.dev/workload-kind` annotation.
- `statefulset.snippet.yaml` — canonical intra-replica egress/ingress rules for StatefulSet NetworkPolicy.

### Changed
- `network_policy.rego` uses **superset check**: all canonical rules from snippet must be present; additional rules allowed.
- StatefulSet NetworkPolicy also validated against `statefulset.snippet.yaml` via `nitra.dev/workload-kind` annotation dispatch.
- `networkpolicy.snippet.yaml` renamed to `common.snippet.yaml`.

### Deprecated
- `readNetworkPolicySnippet()` — use `loadSnippetSpec('common')`.
```

- [ ] **Крок 4: Bump версія у npm/package.json**

Оновити `version` поле.

- [ ] **Крок 5: Commit**

```bash
git add npm/CHANGELOG.md npm/package.json
git commit -m "chore(npm): CHANGELOG + version bump for NetworkPolicy snippet-as-source-of-truth"
```

---

## Task 8: Фінальна перевірка

- [ ] **Крок 1: Повний bun test**

```bash
cd /Users/vitaliytv/www/nitra/cursor
bun test npm/rules/k8s/ 2>&1 | tail -10
```

Очікується: усі pass.

- [ ] **Крок 2: Rego-тести через conftest verify (якщо є)**

```bash
which conftest && conftest verify \
  -p npm/rules/k8s/policy/network_policy \
  --namespace k8s.network_policy_test || echo "skip: conftest not in PATH"
```

- [ ] **Крок 3: Smoke check — що n-fix не падає на порожньому дереві**

```bash
tmp=$(mktemp -d)
mkdir -p "$tmp/k8s/base"
cat > "$tmp/k8s/base/deployment.yaml" << 'EOF'
# yaml-language-server: $schema=https://raw.githubusercontent.com/yannh/kubernetes-json-schema/master/v1.27.0/deployment-apps-v1.json
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
  namespace: test
spec:
  selector:
    matchLabels:
      app: api
  template:
    metadata:
      labels:
        app: api
    spec:
      containers:
        - name: api
          image: example.com/api:1.0.0
          resources:
            requests:
              cpu: '0.02'
              memory: 128Mi
EOF
cd "$tmp" && npx @nitra/cursor check k8s 2>&1 | grep -E "NetworkPolicy|Error|error" | head -5
rm -rf "$tmp"
```

Очікується: повідомлення «відсутній NetworkPolicy» (не crash, не unhandled).

- [ ] **Крок 4: Перевірити чистий working tree**

```bash
git status
```

Очікується: `nothing to commit, working tree clean`.

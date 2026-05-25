# NetworkPolicy snippet v2 (multi-canon + annotation dispatch) — Delta Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Довести часткову v1.5-реалізацію (у working tree, ще не комічено) до повного v2 спека: два повних snippet'и (`deployment.snippet.yaml` + `statefulset.snippet.yaml`), annotation `nitra.dev/workload-kind` як dispatch, rego deep-subset (superset) з safety-net.

**Architecture:** Snippet'и → єдине джерело правди. JS читає обидва через `loadSnippetSpec(name)`, обирає за `kind` через `KIND_TO_SNIPPET`, ставить anonimacy `nitra.dev/workload-kind` у згенерованому NP. Rego через `data.template.deployment_snippet.spec` / `data.template.statefulset_snippet.spec` диспатчить за анотацією, перевіряє subset (кожне канонічне правило — у `input.spec`). Safety-net deny — для kind/apiVersion/allow-all/missing-app.

**Tech Stack:** Bun (тести JS), yaml v2 (`parseDocument`, `stringify`), Node.js `readFileSync`, OPA rego v1, conftest з `templateData`.

**Reference spec:** `docs/superpowers/specs/2026-05-25-networkpolicy-snippet-single-source-of-truth-design.md`

**Pre-state:** Working tree має часткову v1.5 (snippet → JS via `readNetworkPolicySnippet`, snippet → rego via `templateData: { snippet }`, deep-equal rego deny, видалені `NETWORK_POLICY_EGRESS_YAML`/`NETWORK_POLICY_IN_CLUSTER_DEFAULT_PORTS`/`networkPolicyManifestViolations`). **Bug:** `manifests.mjs:5048` досі викликає видалену `networkPolicyManifestViolations`. **Інше:** valid_np в rego-тестах не співпадає зі snippet.

---

## File Structure

| Файл | Створити / Редагувати | Відповідальність |
|---|---|---|
| `npm/rules/k8s/policy/network_policy/template/deployment.snippet.yaml` | rename з `networkpolicy.snippet.yaml` | Повний канон NP для Deployment/Job/CronJob/DaemonSet |
| `npm/rules/k8s/policy/network_policy/template/statefulset.snippet.yaml` | create | Повний канон NP для StatefulSet (deployment + 2 intra-replica правила) |
| `npm/rules/k8s/js/manifests.mjs` | edit | `loadSnippetSpec(name)`, `KIND_TO_SNIPPET`, `snippetNameForKind`, `buildNetworkPolicyYaml(name, app, kind)` з анотацією, fix call site видаленої `networkPolicyManifestViolations`, drift detection |
| `npm/rules/k8s/js/tests/manifests/tests/check-schema.test.mjs` | edit | Тести під kind-based generation, обидва snippets, drift detection, annotation присутність |
| `npm/rules/k8s/policy/network_policy/network_policy.rego` | edit | Annotation dispatch, deep-subset deny, safety-net (allow-all, missing-app) |
| `npm/rules/k8s/policy/network_policy/network_policy_test.rego` | edit | Sync `valid_np` зі snippet, тести для StatefulSet, extra-rules, missing annotation |
| `npm/CHANGELOG.md` | edit | Major bump (breaking видалення `networkPolicyManifestViolations` + breaking signature `buildNetworkPolicyYaml(name, app, kind)`) |
| `npm/rules/k8s/k8s.mdc` | edit | Скоротити NP-блок: посилання на обидва snippets, анотацію, link-local пояснення |
| `docs/adr/2026-05-25-networkpolicy-snippet-canon.md` | create | Фінальний ADR на основі чернеток |
| `docs/adr/20260525-20*nodelocal*.md` + `20260525-203700-networkpolicy-snippet-*.md` | delete | 9 авточернеток, які перекриваються |

---

### Task 1: Fix broken `validateNetworkPolicyForWorkload` (hot-fix)

`manifests.mjs:5048` досі викликає `networkPolicyManifestViolations`, видалену з working tree. Це silent bug — call site не покритий тестами, але впаде на runtime коли `n-fix` запуститься на реальному дереві. Виправляємо ПЕРЕД будь-яким іншим — щоб подальші task'и працювали в чистому стані.

**Files:**
- Modify: `npm/rules/k8s/js/manifests.mjs` (рядки ~5121-5135, `validateNetworkPolicyForWorkload`)

- [ ] **Step 1: Прочитати поточний стан функції**

```bash
sed -n '5100,5140p' npm/rules/k8s/js/manifests.mjs
```

Очікувано: видно `validateNetworkPolicyForWorkload` із викликом `networkPolicyManifestViolations(matchedNp, workloadName, appLabel)` на ~5048 (рядки можуть зсунутися — шукай `networkPolicyManifestViolations`).

- [ ] **Step 2: Видалити виклик і блок про npErrs**

Знайди (десь у `validateNetworkPolicyForWorkload`):
```js
const npErrs = networkPolicyManifestViolations(matchedNp, workloadName, appLabel)
if (npErrs.length === 0) {
  passFn(`${npRel}: NetworkPolicy для ${workloadKind} '${workloadName}' валідний (k8s.mdc)`)
} else {
  for (const e of npErrs) fail(`${npRel}: ${e} (k8s.mdc)`)
}
```

Заміни на:
```js
passFn(`${npRel}: NetworkPolicy для ${workloadKind} '${workloadName}' знайдено (структуру перевіряє rego; k8s.mdc)`)
```

(Cross-file прив'язка лишається — функція й далі знаходить NP за `metadata.name`. Структурну перевірку повністю делегуємо rego через conftest.)

- [ ] **Step 3: Прогнати тести**

```bash
cd npm && bun test --parallel rules/k8s/js/tests/manifests/tests/check-schema.test.mjs 2>&1 | tail -10
```

Очікувано: 182/182 pass.

- [ ] **Step 4: Перевірити, що ніщо більше не посилається на `networkPolicyManifestViolations`**

```bash
grep -n 'networkPolicyManifestViolations' npm/rules/k8s/js/manifests.mjs
```

Очікувано: порожній вивід (грep нічого).

- [ ] **Step 5: Commit**

```bash
git add npm/rules/k8s/js/manifests.mjs
git commit -m "fix(k8s): прибрати виклик видаленої networkPolicyManifestViolations у validateNetworkPolicyForWorkload"
```

---

### Task 2: Перейменувати snippet → `deployment.snippet.yaml`

**Files:**
- Rename: `npm/rules/k8s/policy/network_policy/template/networkpolicy.snippet.yaml` → `deployment.snippet.yaml`
- Modify: `npm/rules/k8s/js/manifests.mjs` (path constant + comments)

- [ ] **Step 1: Перейменувати файл через git**

```bash
git mv npm/rules/k8s/policy/network_policy/template/networkpolicy.snippet.yaml \
       npm/rules/k8s/policy/network_policy/template/deployment.snippet.yaml
```

- [ ] **Step 2: Оновити path в `manifests.mjs`**

Знайди:
```js
const NETWORK_POLICY_SNIPPET_URL = new URL(
  '../policy/network_policy/template/networkpolicy.snippet.yaml',
  import.meta.url
)
```

Заміни на:
```js
const NETWORK_POLICY_SNIPPET_URL_DEPLOYMENT = new URL(
  '../policy/network_policy/template/deployment.snippet.yaml',
  import.meta.url
)
const NETWORK_POLICY_SNIPPET_URL_STATEFULSET = new URL(
  '../policy/network_policy/template/statefulset.snippet.yaml',
  import.meta.url
)
```

(Statefulset URL використовується далі в Task 3+4. Зараз додаємо щоб не повертатися двічі.)

- [ ] **Step 3: Тимчасово зробити `readNetworkPolicySnippet` сумісним (поки не змігруємо все)**

Знайди:
```js
export function readNetworkPolicySnippet() {
  const raw = readFileSync(fileURLToPath(NETWORK_POLICY_SNIPPET_URL), 'utf-8')
  return /** @type {any} */ (parseDocument(raw).toJS()).spec
}
```

Заміни на:
```js
/**
 * Читає deployment.snippet.yaml і повертає розпарсений spec.
 * @deprecated Використовуй `loadSnippetSpec('deployment')` або `loadSnippetSpec('statefulset')` — Task 4.
 * @returns {Record<string, unknown>}
 */
export function readNetworkPolicySnippet() {
  const raw = readFileSync(fileURLToPath(NETWORK_POLICY_SNIPPET_URL_DEPLOYMENT), 'utf-8')
  return /** @type {any} */ (parseDocument(raw).toJS()).spec
}
```

- [ ] **Step 4: Прогнати тести**

```bash
cd npm && bun test --parallel rules/k8s/js/tests/manifests/tests/check-schema.test.mjs 2>&1 | tail -10
```

Очікувано: 182/182 pass (snippet перейменовано, але path в JS оновлено).

- [ ] **Step 5: Commit**

```bash
git add npm/rules/k8s/policy/network_policy/template/deployment.snippet.yaml \
        npm/rules/k8s/js/manifests.mjs
git commit -m "refactor(k8s): rename networkpolicy.snippet.yaml → deployment.snippet.yaml; add statefulset URL"
```

---

### Task 3: Створити `statefulset.snippet.yaml` (повний канон)

**Files:**
- Create: `npm/rules/k8s/policy/network_policy/template/statefulset.snippet.yaml`

- [ ] **Step 1: Створити файл з повним каноном для StatefulSet**

Шлях: `npm/rules/k8s/policy/network_policy/template/statefulset.snippet.yaml`

Вміст:
```yaml
spec:
  podSelector:
    matchLabels: {}
  policyTypes:
    - Ingress
    - Egress
  ingress:
    - from:
        - podSelector: {}
    # intra-replica реплікація (StatefulSet pod ↔ pod у тому ж namespace)
    - from:
        - podSelector:
            matchLabels: {}
  egress:
    # DNS через kube-dns (kube-system)
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
          podSelector:
            matchLabels:
              k8s-app: kube-dns
      ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53
    # DNS через NodeLocal DNSCache (GKE, link-local RFC 3927)
    - to:
        - ipBlock:
            cidr: 169.254.0.0/16
      ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53
    # Зовнішній HTTP/S
    - to:
        - ipBlock:
            cidr: 0.0.0.0/0
      ports:
        - protocol: TCP
          port: 80
        - protocol: TCP
          port: 443
    # In-cluster
    - to:
        - namespaceSelector: {}
      ports:
        - protocol: TCP
          port: 80
        - protocol: TCP
          port: 443
        - protocol: TCP
          port: 5432
        - protocol: TCP
          port: 3306
        - protocol: TCP
          port: 1433
        - protocol: TCP
          port: 6379
        - protocol: TCP
          port: 8080
        - protocol: TCP
          port: 4317
        - protocol: TCP
          port: 4318
    # intra-replica реплікація (StatefulSet pod ↔ pod у тому ж namespace)
    - to:
        - podSelector:
            matchLabels: {}
```

> **Важливо:** intra-replica `podSelector: matchLabels: {}` — НЕ placeholder для JS-substitution. Це справжній «будь-який pod у тому ж namespace» selector. Якщо команда захоче вужчу ізоляцію — додасть extra-rule (rego subset дозволить).

- [ ] **Step 2: Перевірити, що YAML парситься**

```bash
node --input-type=module <<'EOF'
import { readFileSync } from 'node:fs'
import { parseDocument } from 'yaml'
const raw = readFileSync('npm/rules/k8s/policy/network_policy/template/statefulset.snippet.yaml', 'utf-8')
const doc = parseDocument(raw).toJS()
console.log('egress count:', doc.spec.egress.length)
console.log('ingress count:', doc.spec.ingress.length)
EOF
```

Очікувано: `egress count: 5`, `ingress count: 2`.

- [ ] **Step 3: Commit**

```bash
git add npm/rules/k8s/policy/network_policy/template/statefulset.snippet.yaml
git commit -m "feat(k8s): додати statefulset.snippet.yaml — повний канон NP з intra-replica трафіком"
```

---

### Task 4: `KIND_TO_SNIPPET` + `loadSnippetSpec(name)` + `snippetNameForKind(kind)` у JS

**Files:**
- Modify: `npm/rules/k8s/js/manifests.mjs` (~4243-4258, біля існуючої `readNetworkPolicySnippet`)

- [ ] **Step 1: Замінити існуючий блок константою-кешем і helper'ами**

Знайди:
```js
const NETWORK_POLICY_SNIPPET_URL_DEPLOYMENT = new URL(
  '../policy/network_policy/template/deployment.snippet.yaml',
  import.meta.url
)
const NETWORK_POLICY_SNIPPET_URL_STATEFULSET = new URL(
  '../policy/network_policy/template/statefulset.snippet.yaml',
  import.meta.url
)

/**
 * Читає deployment.snippet.yaml і повертає розпарсений spec.
 * @deprecated ...
 */
export function readNetworkPolicySnippet() {
  const raw = readFileSync(fileURLToPath(NETWORK_POLICY_SNIPPET_URL_DEPLOYMENT), 'utf-8')
  return /** @type {any} */ (parseDocument(raw).toJS()).spec
}
```

Заміни на:
```js
const NETWORK_POLICY_SNIPPET_URLS = {
  deployment: new URL('../policy/network_policy/template/deployment.snippet.yaml', import.meta.url),
  statefulset: new URL('../policy/network_policy/template/statefulset.snippet.yaml', import.meta.url),
}

/** @type {Record<string, Record<string, unknown>>} */
const _snippetSpecCache = {}

/**
 * Lazy-кешований loader спека з конкретного snippet'у.
 * @param {'deployment' | 'statefulset'} snippetName
 * @returns {Record<string, unknown>}
 */
export function loadSnippetSpec(snippetName) {
  if (_snippetSpecCache[snippetName]) return _snippetSpecCache[snippetName]
  const url = NETWORK_POLICY_SNIPPET_URLS[snippetName]
  if (!url) throw new Error(`Unknown NetworkPolicy snippet: ${snippetName}`)
  const raw = readFileSync(fileURLToPath(url), 'utf-8')
  _snippetSpecCache[snippetName] = /** @type {any} */ (parseDocument(raw).toJS()).spec
  return _snippetSpecCache[snippetName]
}

/**
 * Mapping workload-kind → snippet name. Єдине джерело dispatch'а в JS.
 * @type {Record<string, 'deployment' | 'statefulset'>}
 */
export const KIND_TO_SNIPPET = {
  Deployment: 'deployment',
  Job: 'deployment',
  CronJob: 'deployment',
  DaemonSet: 'deployment',
  StatefulSet: 'statefulset',
}

/**
 * @param {string} kind workload-kind
 * @returns {'deployment' | 'statefulset'}
 */
export function snippetNameForKind(kind) {
  const name = KIND_TO_SNIPPET[kind]
  if (!name) throw new Error(`Unknown workload kind for NetworkPolicy canon: ${kind}`)
  return name
}

/**
 * @deprecated Використовуй `loadSnippetSpec('deployment')`. Лишається для backward compat одного релізу.
 * @returns {Record<string, unknown>}
 */
export function readNetworkPolicySnippet() {
  return loadSnippetSpec('deployment')
}
```

- [ ] **Step 2: Прогнати тести**

```bash
cd npm && bun test --parallel rules/k8s/js/tests/manifests/tests/check-schema.test.mjs 2>&1 | tail -10
```

Очікувано: 182/182 pass (поведінка `readNetworkPolicySnippet()` зберігається через alias).

- [ ] **Step 3: Commit**

```bash
git add npm/rules/k8s/js/manifests.mjs
git commit -m "feat(k8s): loadSnippetSpec(name) + KIND_TO_SNIPPET + snippetNameForKind"
```

---

### Task 5: `buildNetworkPolicyYaml(name, app, kind)` — додати `kind` + анотацію

**Files:**
- Modify: `npm/rules/k8s/js/manifests.mjs` (`buildNetworkPolicyYaml`, ~рядок 4289+)

- [ ] **Step 1: Знайти поточну функцію**

```bash
grep -n 'export function buildNetworkPolicyYaml' npm/rules/k8s/js/manifests.mjs
```

- [ ] **Step 2: Замінити сигнатуру і тіло**

Поточна (із Task working tree):
```js
export function buildNetworkPolicyYaml(deployName, appLabel) {
  const schemaUrl = `${YANNH_BASE}networkpolicy-networking-v1.json`
  const spec = JSON.parse(JSON.stringify(readNetworkPolicySnippet()))
  spec.podSelector.matchLabels = { app: appLabel }
  const specYaml = stringify(spec, { indent: 2 }).replace(/^(?!$)/gm, '  ').trimEnd()
  return `# yaml-language-server: $schema=${schemaUrl}
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: ${deployName}
spec:
${specYaml}`
}
```

Заміни на:
```js
/**
 * Канонічний YAML **NetworkPolicy** для workload з іменем `deployName`, міткою `app` і типом `kind`.
 * Структура `spec` береться зі snippet'а, обраного за `kind` через `KIND_TO_SNIPPET`. Анотація
 * `nitra.dev/workload-kind` дозволяє rego диспатчити на правильний канон.
 * @param {string} deployName `metadata.name` workload
 * @param {string} appLabel `spec.selector.matchLabels.app`
 * @param {string} kind workload-kind (Deployment | StatefulSet | Job | CronJob | DaemonSet)
 * @returns {string} вміст `networkpolicy.yaml`
 */
export function buildNetworkPolicyYaml(deployName, appLabel, kind) {
  const schemaUrl = `${YANNH_BASE}networkpolicy-networking-v1.json`
  const snippetName = snippetNameForKind(kind)
  const spec = JSON.parse(JSON.stringify(loadSnippetSpec(snippetName)))
  spec.podSelector.matchLabels = { app: appLabel }
  const docObj = {
    apiVersion: 'networking.k8s.io/v1',
    kind: 'NetworkPolicy',
    metadata: {
      name: deployName,
      annotations: { 'nitra.dev/workload-kind': kind },
    },
    spec,
  }
  return `# yaml-language-server: $schema=${schemaUrl}\n${stringify(docObj).trimEnd()}\n`
}
```

(Цикл `replace(/^(?!$)/gm, '  ')` для індентації прибраний — повний `stringify(docObj)` дає валідний YAML без ручної обробки.)

- [ ] **Step 3: Подивитись, чи тести падають (через нову сигнатуру)**

```bash
cd npm && bun test --parallel rules/k8s/js/tests/manifests/tests/check-schema.test.mjs 2>&1 | tail -20
```

Очікувано: тести `buildNetworkPolicyYaml('api', 'api')` без `kind` падають (TypeError у `snippetNameForKind(undefined)`). Це нормально — фіксимо тести в Task 11.

- [ ] **Step 4: Тимчасово додати default `kind = 'Deployment'`, щоб тести не вибухали посеред task'у**

В `buildNetworkPolicyYaml` поміняй сигнатуру:
```js
export function buildNetworkPolicyYaml(deployName, appLabel, kind = 'Deployment') {
```

Це default-параметр на час Task 5-11. У Task 11 default буде прибраний разом з оновленими тестами.

- [ ] **Step 5: Прогнати тести**

```bash
cd npm && bun test --parallel rules/k8s/js/tests/manifests/tests/check-schema.test.mjs 2>&1 | tail -10
```

Очікувано: 182/182 pass.

- [ ] **Step 6: Commit**

```bash
git add npm/rules/k8s/js/manifests.mjs
git commit -m "feat(k8s): buildNetworkPolicyYaml(name, app, kind) — kind dispatch + nitra.dev/workload-kind annotation"
```

---

### Task 6: Update call sites `buildNetworkPolicyYaml` — pass workload kind

**Files:**
- Modify: `npm/rules/k8s/js/manifests.mjs` (call sites — `appendNetworkPolicyDocuments` ~6328, `regenerateLegacyNetworkPolicyDocsInFile` ~6397)

- [ ] **Step 1: Знайти всі виклики**

```bash
grep -n 'buildNetworkPolicyYaml(' npm/rules/k8s/js/manifests.mjs
```

Очікувано: 2 виклики (приблизно рядки 6336, 6415).

- [ ] **Step 2: Виклик 1 — `appendNetworkPolicyDocuments`**

Знайди:
```js
const blocks = toAdd.map(({ name, appLabel }, i) => {
  const block = buildNetworkPolicyYaml(name, appLabel)
  return i === 0 && content === '' ? block.trimEnd() : stripYamlLanguageServerModeline(block).trimEnd()
})
```

Заміни на:
```js
const blocks = toAdd.map(({ name, appLabel, kind }, i) => {
  const block = buildNetworkPolicyYaml(name, appLabel, kind)
  return i === 0 && content === '' ? block.trimEnd() : stripYamlLanguageServerModeline(block).trimEnd()
})
```

(У `toAdd` вже містить `kind` — це поле додається в `ensureNetworkPoliciesForWorkloadsInDir` `~6450`. Перевір, що це так — `grep -n 'toAdd.push' npm/rules/k8s/js/manifests.mjs`.)

- [ ] **Step 3: Виклик 2 — `regenerateLegacyNetworkPolicyDocsInFile`**

Знайди:
```js
const blocks = specs.map(({ name, appLabel }, i) => {
  const block = buildNetworkPolicyYaml(name, appLabel)
  return i === 0 ? block.trimEnd() : stripYamlLanguageServerModeline(block).trimEnd()
})
```

Тут `specs` поки не містить `kind`. Потрібно його туди додати. Знайди вище (~рядок 6406):
```js
const specs = []
for (const doc of docs) {
  const name = manifestMetadataName(doc)
  const spec = /** @type {Record<string, unknown>} */ (doc).spec
  const appLabel = networkPolicyPodSelectorAppLabel(spec)
  if (typeof name === 'string' && name !== '' && appLabel !== '') specs.push({ name, appLabel })
}
```

Заміни на:
```js
const specs = []
for (const doc of docs) {
  const name = manifestMetadataName(doc)
  const spec = /** @type {Record<string, unknown>} */ (doc).spec
  const appLabel = networkPolicyPodSelectorAppLabel(spec)
  // Витягуємо kind з анотації, якщо є; інакше fallback на Deployment.
  const annotations = /** @type {Record<string, unknown>} */ (
    /** @type {any} */ (doc).metadata?.annotations ?? {}
  )
  const annotatedKind = typeof annotations['nitra.dev/workload-kind'] === 'string'
    ? /** @type {string} */ (annotations['nitra.dev/workload-kind'])
    : 'Deployment'
  if (typeof name === 'string' && name !== '' && appLabel !== '') {
    specs.push({ name, appLabel, kind: annotatedKind })
  }
}
```

Тоді map:
```js
const blocks = specs.map(({ name, appLabel, kind }, i) => {
  const block = buildNetworkPolicyYaml(name, appLabel, kind)
  return i === 0 ? block.trimEnd() : stripYamlLanguageServerModeline(block).trimEnd()
})
```

- [ ] **Step 4: Прогнати тести**

```bash
cd npm && bun test --parallel rules/k8s/js/tests/manifests/tests/check-schema.test.mjs 2>&1 | tail -10
```

Очікувано: 182/182 pass.

- [ ] **Step 5: Commit**

```bash
git add npm/rules/k8s/js/manifests.mjs
git commit -m "refactor(k8s): передавати workload kind у buildNetworkPolicyYaml з усіх call sites"
```

---

### Task 7: `regenerateLegacyNetworkPolicyDocsInFile` — drift detection (subset)

Зараз функція перевіряє лише `networkPolicyHasLegacyCatchAllEgress`. Розширюємо: тригер — якщо існуючий spec НЕ містить канон-snippet як subset (тобто **бракує** канонічних правил), або відсутня анотація `nitra.dev/workload-kind`.

**Files:**
- Modify: `npm/rules/k8s/js/manifests.mjs` (нова helper `networkPolicySpecDiffersFromCanon`, оновити `regenerateLegacyNetworkPolicyDocsInFile`)

- [ ] **Step 1: Додати helper `canonContainedIn`**

Знайди блок `networkPolicyHasLegacyCatchAllEgress` (~6353). Перед ним вставити:

```js
/**
 * Перевіряє, чи кожне правило з `canonList` присутнє в `actualList` як deep-equal-копія.
 * Порядок у `actualList` довільний; `actualList` може містити додаткові правила (superset).
 * @param {unknown[]} canonList
 * @param {unknown[]} actualList
 * @returns {boolean}
 */
function canonContainedIn(canonList, actualList) {
  if (!Array.isArray(canonList) || !Array.isArray(actualList)) return false
  for (const canonItem of canonList) {
    const canonJson = JSON.stringify(canonItem)
    const found = actualList.some(actual => JSON.stringify(actual) === canonJson)
    if (!found) return false
  }
  return true
}

/**
 * Перевіряє, чи existing NP-документ відхиляється від канону для свого workload-kind:
 * - відсутня анотація `nitra.dev/workload-kind` → drift,
 * - канон-snippet НЕ є subset для `spec.egress` або `spec.ingress` → drift.
 * @param {unknown} npDoc розпарсений NetworkPolicy-документ
 * @returns {boolean} true, якщо документ розсинхронізований з каноном
 */
function networkPolicySpecDiffersFromCanon(npDoc) {
  if (npDoc === null || typeof npDoc !== 'object' || Array.isArray(npDoc)) return false
  const doc = /** @type {Record<string, unknown>} */ (npDoc)
  const meta = /** @type {Record<string, unknown>} */ (doc.metadata ?? {})
  const ann = /** @type {Record<string, unknown>} */ (meta.annotations ?? {})
  const kind = ann['nitra.dev/workload-kind']
  if (typeof kind !== 'string' || !KIND_TO_SNIPPET[kind]) return true
  const canon = loadSnippetSpec(snippetNameForKind(kind))
  const spec = /** @type {Record<string, unknown>} */ (doc.spec ?? {})
  const actualEgress = /** @type {unknown[]} */ (spec.egress ?? [])
  const actualIngress = /** @type {unknown[]} */ (spec.ingress ?? [])
  if (!canonContainedIn(/** @type {unknown[]} */ (canon.egress) ?? [], actualEgress)) return true
  if (!canonContainedIn(/** @type {unknown[]} */ (canon.ingress) ?? [], actualIngress)) return true
  return false
}
```

- [ ] **Step 2: Оновити тригер у `regenerateLegacyNetworkPolicyDocsInFile`**

Знайди (~6401):
```js
const needsMigration = docs.some(d => networkPolicyHasLegacyCatchAllEgress(d))
```

Заміни на:
```js
const needsMigration = docs.some(d =>
  networkPolicyHasLegacyCatchAllEgress(d) || networkPolicySpecDiffersFromCanon(d)
)
```

- [ ] **Step 3: Прогнати тести**

```bash
cd npm && bun test --parallel rules/k8s/js/tests/manifests/tests/check-schema.test.mjs 2>&1 | tail -10
```

Очікувано: існуючий тест «переписує catch-all egress на канон з 9 портами» лишається зеленим (catch-all досі тригер). Можливо новий тест «valid spec але без анотації → переписується» додамо в Task 11.

- [ ] **Step 4: Commit**

```bash
git add npm/rules/k8s/js/manifests.mjs
git commit -m "feat(k8s): drift detection у regenerateLegacyNetworkPolicyDocsInFile — superset проти canon-snippet"
```

---

### Task 8: rego — annotation dispatch + subset (superset) check

**Files:**
- Modify: `npm/rules/k8s/policy/network_policy/network_policy.rego`

- [ ] **Step 1: Прочитати поточний `network_policy.rego`**

```bash
cat npm/rules/k8s/policy/network_policy/network_policy.rego
```

Зараз містить:
- safety-net deny: kind, apiVersion, spec object, podSelector.matchLabels, matchLabels.app, policyTypes contains Ingress+Egress, ingress has podSelector
- deep-equal deny: `input.spec.egress != data.template.snippet.egress`

- [ ] **Step 2: Замінити deep-equal deny на subset з annotation dispatch**

Знайди:
```rego
# Structural compare: spec.egress має точно відповідати networkpolicy.snippet.yaml.
# Дані snippet передаються через templateData → data.template.snippet.
deny contains msg if {
	is_np_doc
	snippet_egress := data.template.snippet.egress
	input.spec.egress != snippet_egress
	msg := sprintf(
		"NetworkPolicy %v: spec.egress не відповідає канону networkpolicy.snippet.yaml (k8s.mdc)",
		[input.metadata.name],
	)
}
```

Заміни на:
```rego
# Annotation dispatch: за nitra.dev/workload-kind обираємо канонічний snippet.
# Невідоме / відсутнє значення → fallback на deployment.snippet (+ warn у deny_annotation).
canon_for_kind("StatefulSet") := data.template.statefulset_snippet
canon_for_kind(_) := data.template.deployment_snippet

snippet_name_for_kind("StatefulSet") := "statefulset"
snippet_name_for_kind(_) := "deployment"

workload_kind := k if {
	k := object.get(object.get(input.metadata, "annotations", {}), "nitra.dev/workload-kind", "")
}

# Warn якщо анотації немає — не блокує, але мітить файли для уваги
deny contains msg if {
	is_np_doc
	workload_kind == ""
	msg := "metadata.annotations['nitra.dev/workload-kind'] відсутня — JS-генератор має ставити її автоматично (k8s.mdc)"
}

# Subset deny на egress: кожне канонічне правило має бути в input.spec.egress
deny contains msg if {
	is_np_doc
	is_object(input.spec)
	canon := canon_for_kind(workload_kind)
	canon_egress := object.get(canon.spec, "egress", [])
	some canon_rule in canon_egress
	not list_contains(object.get(input.spec, "egress", []), canon_rule)
	msg := sprintf(
		"spec.egress: бракує канонічного правила (%s.snippet.yaml): %s (k8s.mdc)",
		[snippet_name_for_kind(workload_kind), json.marshal(canon_rule)],
	)
}

# Аналогічно для ingress
deny contains msg if {
	is_np_doc
	is_object(input.spec)
	canon := canon_for_kind(workload_kind)
	canon_ingress := object.get(canon.spec, "ingress", [])
	some canon_rule in canon_ingress
	not list_contains(object.get(input.spec, "ingress", []), canon_rule)
	msg := sprintf(
		"spec.ingress: бракує канонічного правила (%s.snippet.yaml): %s (k8s.mdc)",
		[snippet_name_for_kind(workload_kind), json.marshal(canon_rule)],
	)
}

# Helper: чи елемент структурно міститься у списку (order-independent на верхньому рівні)
list_contains(list, item) if {
	some i
	list[i] == item
}

# Safety-net: allow-all egress {} — заборонено
deny contains "spec.egress: заборонено allow-all {} — додавай явні правила (k8s.mdc)" if {
	is_np_doc
	some rule in object.get(input.spec, "egress", [])
	is_object(rule)
	count(object.keys(rule)) == 0
}
```

- [ ] **Step 3: Прогнати opa тести**

```bash
opa test npm/rules/k8s/policy/network_policy/ -v 2>&1 | tail -20
```

Очікувано: ймовірно частина тестів падає, бо `valid_np` не співпадає зі snippet. Це нормально — фіксимо в Task 10. Поки що позначити, які саме впали.

- [ ] **Step 4: Commit (intermediate — тести впадуть, але код переходу зафіксовано)**

```bash
git add npm/rules/k8s/policy/network_policy/network_policy.rego
git commit -m "feat(rego): annotation-based dispatch + subset deny проти deployment/statefulset snippet"
```

---

### Task 9: Передати обидва snippets через `templateData` в `runConftestBatch`

**Files:**
- Modify: `npm/rules/k8s/js/manifests.mjs` (~6505, `runAllK8sRego`)

- [ ] **Step 1: Знайти існуючий блок templateData**

```bash
grep -n 'templateData' npm/rules/k8s/js/manifests.mjs
```

Поточно: `templateData: { snippet: readNetworkPolicySnippet() }` — один snippet.

- [ ] **Step 2: Замінити на обидва snippet'и під фіксованими ключами**

Знайди:
```js
{ ns: 'k8s.network_policy', dir: 'k8s/network_policy', files: allYaml, templateData: { snippet: readNetworkPolicySnippet() } },
```

Заміни на:
```js
{ ns: 'k8s.network_policy', dir: 'k8s/network_policy', files: allYaml, templateData: {
  deployment_snippet: { spec: loadSnippetSpec('deployment') },
  statefulset_snippet: { spec: loadSnippetSpec('statefulset') },
} },
```

(Структура повторює rego-доступ `data.template.deployment_snippet.spec.egress` — тому передаємо обʼєкт з `spec` як ключем, а зовнішній ключ — назва snippet'а.)

- [ ] **Step 3: Прогнати JS тести**

```bash
cd npm && bun test --parallel rules/k8s/ 2>&1 | tail -15
```

Очікувано: всі тести JS pass (rego call site лише в integration-тестах, які покривають конкретний conftest output — деталі в Task 10).

- [ ] **Step 4: Commit**

```bash
git add npm/rules/k8s/js/manifests.mjs
git commit -m "feat(k8s): передавати deployment+statefulset snippets через templateData у k8s.network_policy"
```

---

### Task 10: rego-тести — sync `valid_np` зі snippet, додати StatefulSet/annotation тести

**Files:**
- Modify: `npm/rules/k8s/policy/network_policy/network_policy_test.rego`

- [ ] **Step 1: Прочитати поточний `network_policy_test.rego`**

```bash
cat npm/rules/k8s/policy/network_policy/network_policy_test.rego
```

- [ ] **Step 2: Замінити фіктивний `canonical_egress` на справжній (з deployment.snippet)**

Видали поточний `canonical_egress` (~рядки 7-47) і `valid_np`, заміни на:

```rego
package k8s.network_policy_test

import rego.v1

import data.k8s.network_policy

# Канонічні правила Deployment (синхронізовано вручну з deployment.snippet.yaml).
# При оновленні snippet'а — оновити цей блок (CI bun-тест перевіряє синхронність).
deployment_canon_egress := [
	{
		"to": [{
			"namespaceSelector": {"matchLabels": {"kubernetes.io/metadata.name": "kube-system"}},
			"podSelector": {"matchLabels": {"k8s-app": "kube-dns"}},
		}],
		"ports": [
			{"protocol": "UDP", "port": 53},
			{"protocol": "TCP", "port": 53},
		],
	},
	{
		"to": [{"ipBlock": {"cidr": "169.254.0.0/16"}}],
		"ports": [
			{"protocol": "UDP", "port": 53},
			{"protocol": "TCP", "port": 53},
		],
	},
	{
		"to": [{"ipBlock": {"cidr": "0.0.0.0/0"}}],
		"ports": [
			{"protocol": "TCP", "port": 80},
			{"protocol": "TCP", "port": 443},
		],
	},
	{
		"to": [{"namespaceSelector": {}}],
		"ports": [
			{"protocol": "TCP", "port": 80},
			{"protocol": "TCP", "port": 443},
			{"protocol": "TCP", "port": 5432},
			{"protocol": "TCP", "port": 3306},
			{"protocol": "TCP", "port": 1433},
			{"protocol": "TCP", "port": 6379},
			{"protocol": "TCP", "port": 8080},
			{"protocol": "TCP", "port": 4317},
			{"protocol": "TCP", "port": 4318},
		],
	},
]

deployment_canon_ingress := [{"from": [{"podSelector": {}}]}]

statefulset_canon_egress := array.concat(deployment_canon_egress, [
	{"to": [{"podSelector": {"matchLabels": {}}}]},
])

statefulset_canon_ingress := array.concat(deployment_canon_ingress, [
	{"from": [{"podSelector": {"matchLabels": {}}}]},
])

test_data := {
	"template": {
		"deployment_snippet": {"spec": {
			"egress": deployment_canon_egress,
			"ingress": deployment_canon_ingress,
		}},
		"statefulset_snippet": {"spec": {
			"egress": statefulset_canon_egress,
			"ingress": statefulset_canon_ingress,
		}},
	}
}

valid_deployment_np := {
	"apiVersion": "networking.k8s.io/v1",
	"kind": "NetworkPolicy",
	"metadata": {
		"name": "api",
		"annotations": {"nitra.dev/workload-kind": "Deployment"},
	},
	"spec": {
		"podSelector": {"matchLabels": {"app": "api"}},
		"policyTypes": ["Ingress", "Egress"],
		"ingress": deployment_canon_ingress,
		"egress": deployment_canon_egress,
	},
}

valid_statefulset_np := {
	"apiVersion": "networking.k8s.io/v1",
	"kind": "NetworkPolicy",
	"metadata": {
		"name": "db",
		"annotations": {"nitra.dev/workload-kind": "StatefulSet"},
	},
	"spec": {
		"podSelector": {"matchLabels": {"app": "db"}},
		"policyTypes": ["Ingress", "Egress"],
		"ingress": statefulset_canon_ingress,
		"egress": statefulset_canon_egress,
	},
}

test_valid_deployment if {
	count(network_policy.deny) == 0 with input as valid_deployment_np with data as test_data
}

test_valid_statefulset if {
	count(network_policy.deny) == 0 with input as valid_statefulset_np with data as test_data
}

test_wrong_kind if {
	bad := json.patch(valid_deployment_np, [{"op": "replace", "path": "/kind", "value": "Service"}])
	some msg in network_policy.deny with input as bad with data as test_data
	contains(msg, "kind має бути NetworkPolicy")
}

test_missing_match_labels if {
	bad := json.patch(valid_deployment_np, [{"op": "remove", "path": "/spec/podSelector/matchLabels"}])
	some msg in network_policy.deny with input as bad with data as test_data
	contains(msg, "podSelector.matchLabels")
}

test_missing_app_label if {
	bad := json.patch(valid_deployment_np, [{"op": "remove", "path": "/spec/podSelector/matchLabels/app"}])
	some msg in network_policy.deny with input as bad with data as test_data
	contains(msg, "matchLabels.app")
}

test_missing_annotation if {
	bad := json.patch(valid_deployment_np, [{"op": "remove", "path": "/metadata/annotations"}])
	some msg in network_policy.deny with input as bad with data as test_data
	contains(msg, "nitra.dev/workload-kind")
}

test_missing_link_local_egress if {
	# Deployment без link-local DNS правила (індекс 1 у канон-egress) — має fail
	without_link_local := [deployment_canon_egress[0], deployment_canon_egress[2], deployment_canon_egress[3]]
	bad := json.patch(valid_deployment_np, [{"op": "replace", "path": "/spec/egress", "value": without_link_local}])
	some msg in network_policy.deny with input as bad with data as test_data
	contains(msg, "бракує канонічного правила")
}

test_statefulset_missing_intra_replica if {
	# StatefulSet, але egress без intra-replica правила (тобто лише deployment-канон) → fail
	bad := json.patch(valid_statefulset_np, [{"op": "replace", "path": "/spec/egress", "value": deployment_canon_egress}])
	some msg in network_policy.deny with input as bad with data as test_data
	contains(msg, "statefulset.snippet.yaml")
}

test_extra_egress_rule_allowed if {
	# Deployment + додаткове правило (S3 CIDR) — superset дозволяє extra
	with_extra := array.concat(deployment_canon_egress, [
		{"to": [{"ipBlock": {"cidr": "52.92.0.0/15"}}], "ports": [{"protocol": "TCP", "port": 443}]},
	])
	good := json.patch(valid_deployment_np, [{"op": "replace", "path": "/spec/egress", "value": with_extra}])
	count(network_policy.deny) == 0 with input as good with data as test_data
}

test_allow_all_egress_denied if {
	# Allow-all {} — заборонено safety-net
	bad := json.patch(valid_deployment_np, [{"op": "add", "path": "/spec/egress/-", "value": {}}])
	some msg in network_policy.deny with input as bad with data as test_data
	contains(msg, "allow-all")
}
```

- [ ] **Step 3: Прогнати opa тести**

```bash
opa test npm/rules/k8s/policy/network_policy/ -v 2>&1 | tail -30
```

Очікувано: всі тести pass (9-10 testів). Якщо щось падає — читати повідомлення, типово syntax-помилка в `array.concat` / `json.patch` (правила Rego v1).

- [ ] **Step 4: Commit**

```bash
git add npm/rules/k8s/policy/network_policy/network_policy_test.rego
git commit -m "test(rego): sync valid_np з deployment.snippet, додати StatefulSet/annotation/extra-rules тести"
```

---

### Task 11: bun-тести — kind-based generation, drift, прибрати default kind

**Files:**
- Modify: `npm/rules/k8s/js/tests/manifests/tests/check-schema.test.mjs` + видалити default `kind = 'Deployment'` з `buildNetworkPolicyYaml` сигнатури (Task 5 крок 4)

- [ ] **Step 1: Знайти тести в `check-schema.test.mjs`**

```bash
grep -n 'buildNetworkPolicyYaml\|readNetworkPolicySnippet\|loadSnippetSpec' npm/rules/k8s/js/tests/manifests/tests/check-schema.test.mjs
```

- [ ] **Step 2: Замінити існуючі тести на kind-aware**

Знайди тест:
```js
test('readNetworkPolicySnippet: парситься без помилок, link-local 169.254.0.0/16 присутній', () => { ... })
```

Та:
```js
test('buildNetworkPolicyYaml: name, app та spec.egress/ingress відповідають snippet', () => { ... })
```

Заміни на:
```js
test('loadSnippetSpec("deployment"): парситься, link-local 169.254.0.0/16 присутній', () => {
  const spec = loadSnippetSpec('deployment')
  expect(Array.isArray(spec.egress)).toBe(true)
  const hasLinkLocal = spec.egress.some(
    rule => Array.isArray(rule.to) && rule.to.some(peer => peer?.ipBlock?.cidr === '169.254.0.0/16')
  )
  expect(hasLinkLocal).toBe(true)
})

test('loadSnippetSpec("statefulset"): має intra-replica правила (egress + ingress)', () => {
  const spec = loadSnippetSpec('statefulset')
  // egress: останнє правило — intra-replica podSelector
  const lastEgress = spec.egress[spec.egress.length - 1]
  expect(lastEgress.to[0].podSelector.matchLabels).toEqual({})
  // ingress: друге правило — intra-replica
  expect(spec.ingress.length).toBe(2)
  expect(spec.ingress[1].from[0].podSelector.matchLabels).toEqual({})
})

test('snippetNameForKind: Deployment/Job/CronJob/DaemonSet → deployment, StatefulSet → statefulset', () => {
  for (const k of ['Deployment', 'Job', 'CronJob', 'DaemonSet']) {
    expect(snippetNameForKind(k)).toBe('deployment')
  }
  expect(snippetNameForKind('StatefulSet')).toBe('statefulset')
})

test('snippetNameForKind: невідомий kind → throws', () => {
  expect(() => snippetNameForKind('Pod')).toThrow(/Unknown workload kind/)
})

test('buildNetworkPolicyYaml(name, app, "Deployment"): метадані, анотація, deployment.spec', () => {
  const yaml = buildNetworkPolicyYaml('api', 'api', 'Deployment')
  const doc = parseYaml(yaml)
  expect(doc.metadata.name).toBe('api')
  expect(doc.metadata.annotations['nitra.dev/workload-kind']).toBe('Deployment')
  expect(doc.spec.podSelector.matchLabels.app).toBe('api')
  const snippet = loadSnippetSpec('deployment')
  expect(doc.spec.egress).toEqual(snippet.egress)
  expect(doc.spec.ingress).toEqual(snippet.ingress)
})

test('buildNetworkPolicyYaml(name, app, "StatefulSet"): метадані, анотація, statefulset.spec з intra-replica', () => {
  const yaml = buildNetworkPolicyYaml('db', 'db', 'StatefulSet')
  const doc = parseYaml(yaml)
  expect(doc.metadata.annotations['nitra.dev/workload-kind']).toBe('StatefulSet')
  const snippet = loadSnippetSpec('statefulset')
  expect(doc.spec.egress).toEqual(snippet.egress)
  expect(doc.spec.ingress).toEqual(snippet.ingress)
})

test('buildNetworkPolicyYaml(name, app, undefined): throws (kind обовʼязковий)', () => {
  expect(() => buildNetworkPolicyYaml('api', 'api', undefined)).toThrow(/Unknown workload kind/)
})
```

- [ ] **Step 3: Оновити import у тестах**

Знайди:
```js
import {
  ...
  buildNetworkPolicyYaml,
  readNetworkPolicySnippet,
  ensureResourceInKustomizationYaml,
  ...
} from '...'
```

Заміни на:
```js
import {
  ...
  buildNetworkPolicyYaml,
  loadSnippetSpec,
  snippetNameForKind,
  ensureResourceInKustomizationYaml,
  ...
} from '...'
```

(`readNetworkPolicySnippet` лишається в exports — alias deprecated, але без тесту.)

- [ ] **Step 4: Оновити тест міграції — додати очікування на анотацію**

Знайди тест `regenerateLegacyNetworkPolicyDocsInFile` (`переписує catch-all egress на канон ...`):

Додай після `expect(out).toContain('name: api')`:
```js
expect(out).toContain("nitra.dev/workload-kind: Deployment")
```

(Бо `regenerateLegacyNetworkPolicyDocsInFile` тепер кидає документи через `buildNetworkPolicyYaml`, який ставить анотацію.)

- [ ] **Step 5: Додати тест drift detection**

В `describe('NetworkPolicy helpers', ...)` додай:
```js
test('regenerateLegacyNetworkPolicyDocsInFile: valid spec без анотації → переписується', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'np-drift-'))
  try {
    const npAbs = join(dir, 'networkpolicy.yaml')
    // Валідний spec, але без анотації nitra.dev/workload-kind
    const noAnnotation = `# yaml-language-server: $schema=https://example/np.json
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: api
spec:
  podSelector:
    matchLabels:
      app: api
  policyTypes:
    - Ingress
    - Egress
  ingress:
    - from:
        - podSelector: {}
  egress:
${stringify(loadSnippetSpec('deployment').egress).split('\n').map(l => l ? '    ' + l : l).join('\n')}
`
    await writeFile(npAbs, noAnnotation, 'utf8')
    const changed = await regenerateLegacyNetworkPolicyDocsInFile(npAbs)
    expect(changed).toBe(true)
    const out = await readFile(npAbs, 'utf8')
    expect(out).toContain("nitra.dev/workload-kind: Deployment")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
```

Додай імпорт `stringify` у тести:
```js
import { parse as parseYaml, stringify } from 'yaml'
```

- [ ] **Step 6: Прибрати default `kind = 'Deployment'` з `buildNetworkPolicyYaml`**

В `manifests.mjs` знайди:
```js
export function buildNetworkPolicyYaml(deployName, appLabel, kind = 'Deployment') {
```

Заміни на:
```js
export function buildNetworkPolicyYaml(deployName, appLabel, kind) {
```

- [ ] **Step 7: Прогнати тести**

```bash
cd npm && bun test --parallel rules/k8s/ 2>&1 | tail -20
```

Очікувано: всі тести pass. Якщо tests на `buildNetworkPolicyYaml('api', 'api')` (без kind) залишилися — додай `'Deployment'` третім параметром або (якщо тест саме перевіряє throw) — лишай.

- [ ] **Step 8: Commit**

```bash
git add npm/rules/k8s/js/manifests.mjs npm/rules/k8s/js/tests/manifests/tests/check-schema.test.mjs
git commit -m "test(k8s): kind-aware buildNetworkPolicyYaml + drift detection + прибрати default kind"
```

---

### Task 12: `k8s.mdc` — скоротити NP-блок, додати посилання на 2 snippets + annotation

**Files:**
- Modify: `npm/rules/k8s/k8s.mdc` (близько ряд. 510, блок про NetworkPolicy)

- [ ] **Step 1: Знайти поточний блок NetworkPolicy у k8s.mdc**

```bash
grep -n '^##.*NetworkPolicy\|kube-dns\|169.254' npm/rules/k8s/k8s.mdc
```

- [ ] **Step 2: Замінити блок (точне місце залежить від git diff — скоріше за все 4-5 параграфів)**

Знайди розділ «NetworkPolicy» (близько `## NetworkPolicy` або `### NetworkPolicy egress …`) — там зараз перелік портів (5432, 6379, 8080, ...), приклад egress YAML і пояснення.

Заміни цілий блок на:

````markdown
## NetworkPolicy

Для кожного `Deployment`, `StatefulSet`, `DaemonSet`, `Job`, `CronJob` під `k8s/` обов'язковий канонічний **NetworkPolicy** у `networkpolicy.yaml` поруч з workload-маніфестом.

### Канон — два snippet-файли

Структура `spec` живе в:

- `npm/rules/k8s/policy/network_policy/template/deployment.snippet.yaml` — канон для `Deployment`, `Job`, `CronJob`, `DaemonSet`.
- `npm/rules/k8s/policy/network_policy/template/statefulset.snippet.yaml` — канон для `StatefulSet` (deployment-канон + intra-replica `podSelector` правила).

Зміна каноніу — лише в snippet'ах. JS-генератор (`buildNetworkPolicyYaml`) і rego (`network_policy.rego`) автоматично підтягують зміну.

### Анотація `nitra.dev/workload-kind`

JS-генератор ставить у `metadata.annotations`:

```yaml
metadata:
  annotations:
    nitra.dev/workload-kind: Deployment  # або StatefulSet, Job, CronJob, DaemonSet
```

Rego використовує анотацію, щоб диспатчити на правильний канон. Відсутність анотації — `deny`.

### Прив'язка до workload

- `metadata.name` NetworkPolicy = `metadata.name` workload.
- `spec.podSelector.matchLabels.app` = `spec.selector.matchLabels.app` workload (`spec.jobTemplate.spec.selector` для CronJob).

Cross-file перевірка — у JS (`validateNetworkPolicyForWorkload`). Структурну перевірку повністю робить rego через conftest.

### Додаткові правила

Дозволено додавати власні `egress` / `ingress` правила понад канон (rego перевіряє subset — наявність кожного канонічного правила, не точну рівність). Підставляй обережно: `egress: [{}]` (allow-all) — safety-net у rego, заборонено.

### Чому в каноні є `169.254.0.0/16` (GKE)

GKE з NodeLocal DNSCache переписує `/etc/resolv.conf` подів на link-local адресу DNS-агента ноди (`169.254.x.x`, RFC 3927), а не на ClusterIP kube-dns. Без egress на `169.254.0.0/16` DNS-резолвінг у poda падає до того, як трафік дійде до kube-system. Це універсально для GKE — лишається в каноні для всіх типів workload.

### Запуск перевірки

```bash
conftest test \
  --data npm/rules/k8s/policy/network_policy/template/deployment.snippet.yaml \
  --data npm/rules/k8s/policy/network_policy/template/statefulset.snippet.yaml \
  -p npm/rules/k8s/policy/network_policy \
  --namespace k8s.network_policy \
  <шлях до networkpolicy.yaml>
```

(Альтернативно — через `bun run check k8s`, який передає snippets автоматично через `templateData`.)
````

- [ ] **Step 3: Перевірити, що в k8s.mdc більше нема старого переліку портів**

```bash
grep -n '5432\|6379\|4317' npm/rules/k8s/k8s.mdc
```

Очікувано: порожній вивід (порти живуть у snippet'ах).

- [ ] **Step 4: Commit**

```bash
git add npm/rules/k8s/k8s.mdc
git commit -m "docs(k8s): скоротити NetworkPolicy блок — посилання на два snippet'и + annotation"
```

---

### Task 13: `npm/CHANGELOG.md` — major bump

**Files:**
- Modify: `npm/CHANGELOG.md`
- Modify: `npm/package.json` (version)

- [ ] **Step 1: Подивитися поточну версію**

```bash
node -e "console.log(require('./npm/package.json').version)"
```

- [ ] **Step 2: Зафіксувати наступну major-версію**

Напр. поточна `1.11.14` → нова `2.0.0`.

```bash
cd npm && npm version major --no-git-tag-version
```

(або вручну змінити в `package.json`)

- [ ] **Step 3: Додати запис у `CHANGELOG.md`**

Зверху додай:

```markdown
## [2.0.0] — 2026-05-25

### BREAKING
- Видалено публічний export `networkPolicyManifestViolations` з `@nitra/cursor/rules/k8s/js/manifests.mjs`. Структурна валідація NetworkPolicy повністю перенесена в rego (`network_policy.rego`); JS-споживачі, які прямо викликали цю функцію, мають перейти на запуск rego через conftest або через `bun run check k8s`.
- Сигнатура `buildNetworkPolicyYaml(deployName, appLabel, kind)` — додано обовʼязковий третій параметр `kind`. Виклики без `kind` тепер throw'ять.

### Added
- `loadSnippetSpec(name)`, `KIND_TO_SNIPPET`, `snippetNameForKind(kind)` — публічні exports для роботи з snippet-каноном.
- `npm/rules/k8s/policy/network_policy/template/statefulset.snippet.yaml` — новий повний канон NetworkPolicy для StatefulSet з intra-replica правилами.
- Анотація `nitra.dev/workload-kind` у згенерованих NetworkPolicy — disаpatch для rego на правильний snippet.
- Drift detection у `regenerateLegacyNetworkPolicyDocsInFile`: перезапис існуючого NP, якщо канон snippet'а не є subset для його `spec`.

### Changed
- Перейменовано `networkpolicy.snippet.yaml` → `deployment.snippet.yaml`.
- `buildNetworkPolicyYaml` читає snippet через `loadSnippetSpec(snippetNameForKind(kind))`; видалено `NETWORK_POLICY_EGRESS_YAML` та `NETWORK_POLICY_IN_CLUSTER_DEFAULT_PORTS`.
- `network_policy.rego` — deep-subset (superset) перевірка проти snippet'у замість granular правил; safety-net deny для allow-all `{}`.
- `k8s.mdc` — скорочено блок NetworkPolicy, прибрано дублі порту/егрес-правил, додано посилання на snippets + annotation contract.

### Notes
- Існуючі `networkpolicy.yaml` у репо потребують перезапису через `npx @nitra/cursor n-fix` — це окремий PR з масовим diff'ом, який має йти **після** мерджу цього релізу (а не разом з ним).
```

- [ ] **Step 4: Перевірити CHANGELOG**

```bash
cd npm && npx @nitra/cursor check changelog 2>&1 | tail -5
```

Очікувано: pass.

- [ ] **Step 5: Commit**

```bash
git add npm/CHANGELOG.md npm/package.json
git commit -m "chore(k8s): major bump 2.0.0 — networkpolicy snippet v2 (multi-canon + annotation)"
```

---

### Task 14: ADR cleanup + фінальний ADR

**Files:**
- Delete: `docs/adr/20260525-20*nodelocal*.md`, `docs/adr/20260525-203700-networkpolicy-snippet-*.md` (8-9 чернеток)
- Create: `docs/adr/2026-05-25-networkpolicy-snippet-canon.md`

- [ ] **Step 1: Знайти чернетки**

```bash
ls docs/adr/20260525-20*nodelocal* docs/adr/20260525-203700-networkpolicy* 2>/dev/null
```

- [ ] **Step 2: Видалити чернетки**

```bash
git rm docs/adr/20260525-20*nodelocal*.md docs/adr/20260525-203700-networkpolicy-snippet-*.md
```

- [ ] **Step 3: Створити фінальний ADR**

Файл: `docs/adr/2026-05-25-networkpolicy-snippet-canon.md`

```markdown
# ADR: NetworkPolicy snippet — джерело правди (multi-canon + annotation dispatch)

**Дата:** 2026-05-25
**Статус:** Прийнято

## Context

Канон `spec` NetworkPolicy дублювався у 5+ місцях (snippet «для очей», `NETWORK_POLICY_EGRESS_YAML` у JS, rego deny-правила, rego тест-фікстури, `.mdc` документація). Зміна одного правила (приклад — додавання `169.254.0.0/16` для GKE NodeLocal DNSCache) потребувала ручної синхронізації у всіх місцях; вилазили розбіжності.

Окремо: усі workload-типи отримували однаковий канон, хоча StatefulSet потребує intra-replica правил (pod ↔ pod у тому ж namespace).

## Decision

Два snippet-файли — **єдині** джерела правди:
- `template/deployment.snippet.yaml` — повний канон для `Deployment`, `Job`, `CronJob`, `DaemonSet`.
- `template/statefulset.snippet.yaml` — повний канон для `StatefulSet` (з intra-replica правилами).

JS-генератор (`buildNetworkPolicyYaml`) обирає snippet за `kind` workload-у через `KIND_TO_SNIPPET`, додає анотацію `nitra.dev/workload-kind` у `metadata.annotations`. Rego через анотацію диспатчить на правильний канон і робить **subset-перевірку** (superset-семантика для input): кожне канонічне правило має бути присутнім, але додаткові правила в `input.spec` дозволені.

`networkPolicyManifestViolations` видалено з JS (breaking, major bump). Цикл cross-file прив'язки залишається в JS (`validateNetworkPolicyForWorkload`).

GKE NodeLocal DNSCache (`169.254.0.0/16:53/UDP+TCP`) — частина канону **обох** snippets.

## Consequences

**Good:**
- Зміна канону = редагування одного snippet'а. JS і rego автоматично узгоджуються.
- StatefulSet тепер має правильний канон з intra-replica.
- Додаткові egress/ingress правила (extra-rules per workload) дозволені — subset не блокує.
- Зменшення коду в `manifests.mjs` на ~120 рядків (видалено рядкові шаблони і granular валідатор).

**Bad:**
- Дублювання `egress` правил між `deployment.snippet.yaml` і `statefulset.snippet.yaml` (~40 рядків). Свідома ціна за runtime-простоту (jodno merge між snippets).
- Anotация `nitra.dev/workload-kind` стає обовʼязковою — існуючі `networkpolicy.yaml`, створені вручну, потребують перезапису через `n-fix`.
- Major version bump публічного `@nitra/cursor` API.

## Alternatives considered

- **Single canon-snippet + ручна синхронізація rego** — простіше, але не підтримує StatefulSet differentiation; vсе одно треба сихронізувати rego-фікстури вручну.
- **Common + delta snippets** — DRY-er (~70 рядків), але вимагає runtime merge в JS і rego; менше явності.
- **Anotация в спеціальному файлі (`workload-kind.yaml`)** — додає файл без додаткової цінності; анотація вже на місці.

## References

- Spec: `docs/superpowers/specs/2026-05-25-networkpolicy-snippet-single-source-of-truth-design.md`
- Plan (v2): `docs/superpowers/plans/2026-05-25-networkpolicy-snippet-v2-delta.md`
- Snippets: `npm/rules/k8s/policy/network_policy/template/{deployment,statefulset}.snippet.yaml`
- Rego: `npm/rules/k8s/policy/network_policy/network_policy.rego`
- JS: `npm/rules/k8s/js/manifests.mjs` (`buildNetworkPolicyYaml`, `loadSnippetSpec`)
- GKE NodeLocal DNSCache: https://cloud.google.com/kubernetes-engine/docs/how-to/nodelocal-dns-cache
- RFC 3927 (link-local): https://datatracker.ietf.org/doc/html/rfc3927
```

- [ ] **Step 4: Commit**

```bash
git add docs/adr/2026-05-25-networkpolicy-snippet-canon.md
git commit -m "docs(adr): фінальний ADR networkpolicy snippet canon + видалити 9 автозбірок-чернеток"
```

---

### Task 15: Фінальна верифікація + smoke на tempdir

**Files:** — (only commands)

- [ ] **Step 1: Прогнати повний bun-набір по k8s rules**

```bash
cd npm && bun test --parallel rules/k8s/ 2>&1 | tail -20
```

Очікувано: усі тести pass, 0 failures.

- [ ] **Step 2: Прогнати opa тести**

```bash
opa test npm/rules/k8s/policy/network_policy/ -v 2>&1 | tail -20
```

Очікувано: 9-10 тестів pass.

- [ ] **Step 3: Smoke на tempdir — згенерувати NP для Deployment**

```bash
node --input-type=module <<'EOF'
import { buildNetworkPolicyYaml } from '/Users/vitaliytv/www/nitra/cursor/npm/rules/k8s/js/manifests.mjs'
console.log(buildNetworkPolicyYaml('api', 'api', 'Deployment'))
EOF
```

Очікувано: повний YAML з `metadata.annotations['nitra.dev/workload-kind']: Deployment`, `169.254.0.0/16`, `0.0.0.0/0`, kube-dns, in-cluster порти.

- [ ] **Step 4: Smoke — згенерувати NP для StatefulSet**

```bash
node --input-type=module <<'EOF'
import { buildNetworkPolicyYaml } from '/Users/vitaliytv/www/nitra/cursor/npm/rules/k8s/js/manifests.mjs'
console.log(buildNetworkPolicyYaml('db', 'db', 'StatefulSet'))
EOF
```

Очікувано: повний YAML + intra-replica `podSelector` в `egress` і `ingress`.

- [ ] **Step 5: Smoke — невідомий kind має throw**

```bash
node --input-type=module <<'EOF'
import { buildNetworkPolicyYaml } from '/Users/vitaliytv/www/nitra/cursor/npm/rules/k8s/js/manifests.mjs'
try {
  buildNetworkPolicyYaml('x', 'x', 'Pod')
  console.log('FAIL: should have thrown')
} catch (e) {
  console.log('OK throw:', e.message)
}
EOF
```

Очікувано: `OK throw: Unknown workload kind for NetworkPolicy canon: Pod`.

- [ ] **Step 6: Перевірити, що в кодовій базі більше нема дублікатів канону**

```bash
grep -rn 'NETWORK_POLICY_EGRESS_YAML\|NETWORK_POLICY_IN_CLUSTER_DEFAULT_PORTS\|networkPolicyManifestViolations' npm/rules/k8s/ 2>&1 | grep -v 'CHANGELOG\|test\|.md'
```

Очікувано: порожній вивід.

- [ ] **Step 7: Якщо все ок — фінальний commit з повідомленням «реалізація завершена»**

```bash
git status --short
git log --oneline -20
```

Очікувано: 14 task-commits + spec/plan, чисте working tree.

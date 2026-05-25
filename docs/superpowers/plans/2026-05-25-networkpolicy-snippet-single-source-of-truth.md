# NetworkPolicy snippet як єдине джерело правди — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Зробити `networkpolicy.snippet.yaml` єдиним джерелом правди для канону `spec` NetworkPolicy — `buildNetworkPolicyYaml` читає snippet, рядкова константа `NETWORK_POLICY_EGRESS_YAML` видаляється.

**Architecture:** Snippet вже оновлений (4 egress-правила: kube-dns, link-local DNS 169.254/16, HTTP/S, in-cluster). JS читає snippet одноразово при завантаженні модуля (`readFileSync` + `parseDocument`), клонує `spec`, підставляє `podSelector.matchLabels` і серіалізує через `yaml.stringify`. Bun-тест асертує структуру результату; rego `valid_np` оновлюється вручну.

**Tech Stack:** Bun (тести), yaml v2 (`parseDocument`, `stringify`), Node.js `readFileSync`, OPA rego.

---

### Task 1: Верифікація поточного стану snippet

**Files:**
- Read: `npm/rules/k8s/policy/network_policy/template/networkpolicy.snippet.yaml`

- [ ] **Step 1: Переконатись, що snippet містить всі 4 egress-правила**

```bash
cat npm/rules/k8s/policy/network_policy/template/networkpolicy.snippet.yaml
```

Expected: файл містить `169.254.0.0/16`, `0.0.0.0/0`, `kube-system`, `namespaceSelector: {}` з портами 80 443 5432 3306 1433 6379 8080 4317 4318.

- [ ] **Step 2: Запустити bun test, щоб зафіксувати поточний стан тестів**

```bash
cd npm && bun test --parallel rules/k8s/js/tests/manifests/tests/check-schema.test.mjs 2>&1 | tail -20
```

Зафіксуй результат. Якщо тести проходять — продовжуй. Якщо ні — зупинись і розберись перед рефакторингом.

---

### Task 2: Оновити `manifests.mjs` — читати snippet замість рядкового шаблону

**Files:**
- Modify: `npm/rules/k8s/js/manifests.mjs` (рядки ~137-145 imports, ~4250-4307 constants + function)

- [ ] **Step 1: Додати `readFileSync` і `stringify` до imports**

Знайди рядок (≈137):
```js
import { existsSync } from 'node:fs'
```
Замінити на:
```js
import { existsSync, readFileSync } from 'node:fs'
```

Знайди рядок (≈141):
```js
import { isSeq, parseAllDocuments, parseDocument } from 'yaml'
```
Замінити на:
```js
import { isSeq, parseAllDocuments, parseDocument, stringify } from 'yaml'
```

- [ ] **Step 2: Видалити `NETWORK_POLICY_IN_CLUSTER_DEFAULT_PORTS` і `NETWORK_POLICY_EGRESS_YAML`**

Видали блок (≈рядки 4245–4281):
```js
/**
 * Канонічний список in-cluster TCP-портів у `to: [{namespaceSelector: {}}]` rule (k8s.mdc).
 * Зовнішній доступ (80/443 → 0.0.0.0/0) і kube-dns (53 UDP/TCP) — окремі rule вище.
 * Catch-all (`namespaceSelector: {}` без `ports:`) — заборонено.
 */
const NETWORK_POLICY_IN_CLUSTER_DEFAULT_PORTS = [80, 443, 5432, 3306, 1433, 6379, 8080, 4317, 4318]

/**
 * Канонічний блок `spec.egress` NetworkPolicy (k8s.mdc): kube-dns; TCP 80/443 на 0.0.0.0/0;
 * in-cluster `namespaceSelector: {}` зі списком `NETWORK_POLICY_IN_CLUSTER_DEFAULT_PORTS`.
 */
const NETWORK_POLICY_EGRESS_YAML = `  egress:
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
    - to:
        - ipBlock:
            cidr: 0.0.0.0/0
      ports:
        - protocol: TCP
          port: 80
        - protocol: TCP
          port: 443
    - to:
        - namespaceSelector: {}
      ports:
${NETWORK_POLICY_IN_CLUSTER_DEFAULT_PORTS.map(p => `        - protocol: TCP\n          port: ${p}`).join('\n')}
`
```

- [ ] **Step 3: Додати `_snippetSpec` у місці видалених констант**

На місці видалених констант (≈рядок 4245, перед `/**` для `buildNetworkPolicyYaml`) вставити:

```js
const _snippetSpec = parseDocument(
  readFileSync(
    new URL('../policy/network_policy/template/networkpolicy.snippet.yaml', import.meta.url),
    'utf8'
  )
).toJS().spec
```

- [ ] **Step 4: Замінити тіло `buildNetworkPolicyYaml`**

Знайди функцію (≈рядки 4289–4307):
```js
export function buildNetworkPolicyYaml(deployName, appLabel) {
  const schemaUrl = `${YANNH_BASE}networkpolicy-networking-v1.json`
  return `# yaml-language-server: $schema=${schemaUrl}
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: ${deployName}
spec:
  podSelector:
    matchLabels:
      app: ${appLabel}
  policyTypes:
    - Ingress
    - Egress
  ingress:
    - from:
        - podSelector: {}
${NETWORK_POLICY_EGRESS_YAML}`
}
```

Замінити на:
```js
export function buildNetworkPolicyYaml(deployName, appLabel) {
  const schemaUrl = `${YANNH_BASE}networkpolicy-networking-v1.json`
  const spec = structuredClone(_snippetSpec)
  spec.podSelector.matchLabels = { app: appLabel }
  return (
    `# yaml-language-server: $schema=${schemaUrl}\n` +
    stringify({
      apiVersion: 'networking.k8s.io/v1',
      kind: 'NetworkPolicy',
      metadata: { name: deployName },
      spec,
    })
  )
}
```

- [ ] **Step 5: Запустити bun test, щоб побачити яких тестів торкнулась зміна**

```bash
cd npm && bun test --parallel rules/k8s/js/tests/manifests/tests/check-schema.test.mjs 2>&1 | tail -40
```

Якщо тести зелені — зупинись на Task 3.  
Якщо є падіння — розберись зараз: типова причина — `yaml.stringify` серіалізує `{}` чи порядок ключів не збігається з рядковим порівнянням у тесті.

---

### Task 3: Оновити bun-тести

**Files:**
- Modify: `npm/rules/k8s/js/tests/manifests/tests/check-schema.test.mjs` (≈рядки 2207–2218 та ≈2275–2330)

- [ ] **Step 1: Додати перевірку link-local до тесту `buildNetworkPolicyYaml`**

Знайди тест (≈рядок 2207):
```js
test('buildNetworkPolicyYaml містить імʼя workload, мітку app і канонічний egress з явними in-cluster портами', () => {
  const yaml = buildNetworkPolicyYaml('api', 'api')
  expect(yaml).toContain('name: api')
  expect(yaml).toContain('app: api')
  expect(yaml).toContain('kind: NetworkPolicy')
  expect(yaml).toContain('cidr: 0.0.0.0/0')
  expect(yaml).toContain('namespaceSelector: {}')
  expect(yaml).not.toContain('egress:\n    - {}')
  for (const port of [80, 443, 5432, 3306, 1433, 6379, 8080, 4317, 4318]) {
    expect(yaml).toContain(`port: ${port}`)
  }
})
```

Замінити на:
```js
test('buildNetworkPolicyYaml містить імʼя workload, мітку app і канонічний egress з явними in-cluster портами', () => {
  const yaml = buildNetworkPolicyYaml('api', 'api')
  expect(yaml).toContain('name: api')
  expect(yaml).toContain('app: api')
  expect(yaml).toContain('kind: NetworkPolicy')
  expect(yaml).toContain('cidr: 0.0.0.0/0')
  expect(yaml).toContain('cidr: 169.254.0.0/16')
  expect(yaml).toContain('namespaceSelector: {}')
  expect(yaml).not.toContain('egress:\n    - {}')
  for (const port of [80, 443, 5432, 3306, 1433, 6379, 8080, 4317, 4318]) {
    expect(yaml).toContain(`port: ${port}`)
  }
})
```

- [ ] **Step 2: Оновити тест `regenerateLegacyNetworkPolicyDocsInFile` — додати link-local до перевірки виводу**

Знайди тест (≈рядок 2275):
```js
test('переписує catch-all egress на канон з 9 портами', async () => {
  ...
  for (const port of [5432, 3306, 1433, 6379, 8080, 4317, 4318]) {
    expect(out).toContain(`port: ${port}`)
  }
  expect(out).toContain('app: api')
  expect(out).toContain('name: api')
```

Після рядка `expect(out).toContain('name: api')` додати:
```js
expect(out).toContain('169.254.0.0/16')
```

- [ ] **Step 3: Запустити тести і переконатись, що всі зелені**

```bash
cd npm && bun test --parallel rules/k8s/js/tests/manifests/tests/check-schema.test.mjs 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add npm/rules/k8s/js/manifests.mjs npm/rules/k8s/js/tests/manifests/tests/check-schema.test.mjs
git commit -m "refactor(k8s): networkpolicy snippet як єдине джерело правди — buildNetworkPolicyYaml reads snippet"
```

---

### Task 4: Оновити rego `valid_np` та json.patch indices

**Files:**
- Modify: `npm/rules/k8s/policy/network_policy/network_policy_test.rego`

- [ ] **Step 1: Додати link-local блок у `valid_np`**

Знайди `valid_np` (≈рядки 7–49). Поточна структура `egress`:
- `egress[0]` — kube-dns (kube-system namespaceSelector + podSelector)
- `egress[1]` — HTTP/S (0.0.0.0/0)
- `egress[2]` — in-cluster (namespaceSelector: {})

Вставити новий блок між `egress[0]` і поточним `egress[1]`:

```rego
valid_np := {
	"apiVersion": "networking.k8s.io/v1",
	"kind": "NetworkPolicy",
	"metadata": {"name": "api"},
	"spec": {
		"podSelector": {"matchLabels": {"app": "api"}},
		"policyTypes": ["Ingress", "Egress"],
		"ingress": [{"from": [{"podSelector": {}}]}],
		"egress": [
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
		],
	},
}
```

- [ ] **Step 2: Оновити json.patch indices у тестах**

Після вставки link-local нові індекси egress:
- `egress[0]` — kube-dns
- `egress[1]` — link-local ← новий
- `egress[2]` — HTTP/S (0.0.0.0/0)
- `egress[3]` — in-cluster (namespaceSelector: {})

Знайди і оновити:

`test_deny_missing_internet_ports` — видаляє HTTP/S:
```rego
# Було:
bad := json.patch(valid_np, [{"op": "remove", "path": "/spec/egress/1"}])
# Стає:
bad := json.patch(valid_np, [{"op": "remove", "path": "/spec/egress/2"}])
```

`test_deny_missing_cluster_egress` — видаляє in-cluster:
```rego
# Було:
bad := json.patch(valid_np, [{"op": "remove", "path": "/spec/egress/2"}])
# Стає:
bad := json.patch(valid_np, [{"op": "remove", "path": "/spec/egress/3"}])
```

`test_deny_cluster_egress_catch_all` — замінює in-cluster на catch-all:
```rego
# Було:
bad := json.patch(valid_np, [{
    "op": "replace",
    "path": "/spec/egress/2",
    "value": {"to": [{"namespaceSelector": {}}]},
}])
# Стає:
bad := json.patch(valid_np, [{
    "op": "replace",
    "path": "/spec/egress/3",
    "value": {"to": [{"namespaceSelector": {}}]},
}])
```

- [ ] **Step 3: Запустити OPA тести**

```bash
opa test npm/rules/k8s/policy/network_policy/ -v
```

Expected: всі тести pass. Якщо `opa` не встановлений — встанови: `brew install opa` або перевір `which opa`.  
Альтернативно: `conftest verify --policy npm/rules/k8s/policy/network_policy/`

- [ ] **Step 4: Commit**

```bash
git add npm/rules/k8s/policy/network_policy/network_policy_test.rego
git commit -m "test(k8s): додати link-local 169.254/16 до valid_np + оновити json.patch indices"
```

---

### Task 5: Bump CHANGELOG

**Files:**
- Modify: `npm/CHANGELOG.md`

- [ ] **Step 1: Перевірити поточну версію**

```bash
npx @nitra/cursor check changelog 2>&1 | head -5
```

- [ ] **Step 2: Додати запис у CHANGELOG та bump version**

У `npm/CHANGELOG.md` в `[Unreleased]` або новий `## [X.Y.Z]` блок додай:

```markdown
### Changed
- `npm/rules/k8s/policy/network_policy/template/networkpolicy.snippet.yaml` стає єдиним джерелом правди для канону `spec` NetworkPolicy. `buildNetworkPolicyYaml` в `manifests.mjs` читає snippet через `readFileSync` + `parseDocument` замість рядкового шаблону `NETWORK_POLICY_EGRESS_YAML`. Видалено `NETWORK_POLICY_IN_CLUSTER_DEFAULT_PORTS` і `NETWORK_POLICY_EGRESS_YAML` як окремі константи.

### Added
- Egress-правило `169.254.0.0/16:53/UDP+TCP` для GKE NodeLocal DNSCache у канонічному NetworkPolicy snippet та `valid_np` rego-фікстурі.
```

- [ ] **Step 3: Commit**

```bash
git add npm/CHANGELOG.md
git commit -m "chore(k8s): changelog — networkpolicy snippet single source of truth + link-local DNS"
```

---

### Task 6: Фінальна верифікація

- [ ] **Step 1: Запустити повний bun test suite для k8s rules**

```bash
cd npm && bun test --parallel rules/k8s/ 2>&1 | tail -30
```

Expected: всі тести pass, 0 failures.

- [ ] **Step 2: Перевірити що новий `buildNetworkPolicyYaml` справді читає snippet**

```bash
node --input-type=module <<'EOF'
import { buildNetworkPolicyYaml } from '/Users/vitaliytv/www/nitra/cursor/npm/rules/k8s/js/manifests.mjs'
const yaml = buildNetworkPolicyYaml('test-svc', 'test-svc')
console.log(yaml)
EOF
```

Expected: виводить повний NetworkPolicy YAML з `169.254.0.0/16`, `0.0.0.0/0`, kube-dns і in-cluster портами.

- [ ] **Step 3: Перевірити що NETWORK_POLICY_EGRESS_YAML більше не існує в кодовій базі**

```bash
grep -r 'NETWORK_POLICY_EGRESS_YAML\|NETWORK_POLICY_IN_CLUSTER_DEFAULT_PORTS' npm/rules/k8s/js/manifests.mjs
```

Expected: порожній вивід (grep нічого не знаходить).

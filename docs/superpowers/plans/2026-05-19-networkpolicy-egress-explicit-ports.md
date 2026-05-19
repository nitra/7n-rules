# NetworkPolicy Egress — Explicit In-Cluster Ports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Замінити catch-all `to: [{namespaceSelector: {}}]` (без `ports:`) на канонічний rule з явним списком 9 in-cluster портів. Це стосується генератора, rego-перевірки, шаблону та документації. Існуючі `networkpolicy.yaml` мігруються одним прогоном `fix k8s`.

**Architecture:** Зміна локалізована у `npm/rules/k8s`:
1. Канонічний шаблон і генератор (`buildNetworkPolicyYaml`) пишуть нову форму.
2. Rego додає `deny` на catch-all (порожній/відсутній `ports:` у in-cluster rule).
3. JS-валідатор `networkPolicyManifestViolations` не змінюється (структурна семантика лишається).
4. Fix-режим (`ensureNetworkPoliciesForK8sWorkloads`) розширюється: для існуючих NP з catch-all egress — повністю перезаписує doc через `buildNetworkPolicyYaml`.

**Tech Stack:** Node 24, Bun ≥ 1.3 (`bun test`), Rego v1 + `conftest verify`. Без нових залежностей.

**Spec:** [docs/superpowers/specs/2026-05-19-networkpolicy-egress-explicit-ports-design.md](../specs/2026-05-19-networkpolicy-egress-explicit-ports-design.md).

---

## File Structure

### Modified files

| Path | Зміна |
|---|---|
| `npm/rules/k8s/policy/network_policy/template/networkpolicy.snippet.yaml` | In-cluster блок з 9 явними портами замість catch-all. |
| `npm/rules/k8s/policy/network_policy/network_policy.rego` | Додано `deny` на in-cluster rule з порожнім/відсутнім `ports:`. |
| `npm/rules/k8s/policy/network_policy/network_policy_test.rego` | Оновлено `valid_np` під новий канон; додано тест для catch-all. |
| `npm/rules/k8s/fix/manifests/check.mjs` | Винесено `NETWORK_POLICY_IN_CLUSTER_DEFAULT_PORTS`; оновлено `NETWORK_POLICY_EGRESS_YAML`; додано `regenerateLegacyNetworkPolicyDocsInFile` та виклик з fix-флоу. |
| `npm/rules/k8s/fix/manifests/check-schema.test.mjs` | Оновлено JS-фікстуру `networkPolicyManifestViolations`; додано тест-кейс для `buildNetworkPolicyYaml` з новими портами; новий тест для legacy-міграції. |
| `npm/rules/k8s/k8s.mdc` | Оновлено прозовий опис canon (явний список портів, заборона catch-all); оновлено YAML-snippet; bump `version` `1.35` → `1.36`. |
| `npm/CHANGELOG.md` | Запис `[1.13.48] - 2026-05-19` під `### Changed`. |
| `npm/package.json` | `version` `1.13.47` → `1.13.48`. |

### Files NOT modified

- `npm/rules/k8s/fix/manifests/check.mjs` — функцію `networkPolicyManifestViolations` не змінюємо (структурний контракт залишається; enforcement портів — у rego).

---

## Constants used across tasks

Список in-cluster портів (одне джерело правди — у `check.mjs`):

```js
const NETWORK_POLICY_IN_CLUSTER_DEFAULT_PORTS = [80, 443, 5432, 3306, 1433, 6379, 8080, 4317, 4318]
```

YAML-fragment, що цей список генерує (під `- to: [{namespaceSelector: {}}]`):

```yaml
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
```

---

## Tasks

### Task 1: Add failing rego test for catch-all in-cluster egress

**Files:**
- Modify: `npm/rules/k8s/policy/network_policy/network_policy_test.rego` (додати тест в кінці файлу).

- [ ] **Step 1: Add failing test that asserts deny on catch-all in-cluster rule**

У `network_policy_test.rego` додати тест перед закриттям файлу:

```rego
test_deny_cluster_egress_catch_all if {
	bad := json.patch(valid_np, [{
		"op": "replace",
		"path": "/spec/egress/2",
		"value": {"to": [{"namespaceSelector": {}}]},
	}])
	some msg in network_policy.deny with input as bad
	contains(msg, "catch-all")
}
```

- [ ] **Step 2: Run rego tests, verify the new test fails**

Run:
```bash
cd /Users/vitaliytv/www/nitra/cursor && \
  conftest verify -p npm/rules/k8s/policy/network_policy --namespace k8s.network_policy
```

Expected: усі попередні тести PASS, `test_deny_cluster_egress_catch_all` FAIL (бо deny rule ще не імплементовано і `valid_np` уже містить catch-all — фікс у Task 2).

**Не комітити** — продовжити з Task 2.

---

### Task 2: Update existing `valid_np` fixture in rego tests under the new canon

**Files:**
- Modify: `npm/rules/k8s/policy/network_policy/network_policy_test.rego` — замінити catch-all rule на rule з явними портами.

- [ ] **Step 1: Replace catch-all entry in `valid_np` with new explicit-ports entry**

У `network_policy_test.rego`, у визначенні `valid_np` (рядки 15-35), замінити:

```rego
			{"to": [{"namespaceSelector": {}}]},
```

на:

```rego
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
```

- [ ] **Step 2: Run rego tests, verify all previous tests still pass; `test_deny_cluster_egress_catch_all` still fails (no deny rule yet)**

Run:
```bash
cd /Users/vitaliytv/www/nitra/cursor && \
  conftest verify -p npm/rules/k8s/policy/network_policy --namespace k8s.network_policy
```

Expected: `test_valid_network_policy`, `test_wrong_kind`, `test_missing_match_labels`, `test_deny_egress_allow_all`, `test_deny_missing_internet_ports`, `test_deny_missing_cluster_egress` — PASS. `test_deny_cluster_egress_catch_all` — FAIL.

**Не комітити** — продовжити з Task 3.

---

### Task 3: Add rego `deny` for in-cluster rule without ports

**Files:**
- Modify: `npm/rules/k8s/policy/network_policy/network_policy.rego` — додати deny rule та helper.

- [ ] **Step 1: Add new deny rule after the existing `egress_has_cluster_namespace_selector` deny (after line 86)**

Після рядка 86 (`}`) додати:

```rego
deny contains "spec.egress: to.namespaceSelector: {} мусить мати непорожні ports — catch-all заборонено (k8s.mdc)" if {
	is_np_doc
	spec := object.get(input, "spec", null)
	is_object(spec)
	cluster_egress_rule_without_ports(spec)
}
```

- [ ] **Step 2: Add helper at the end of the file (after `egress_has_cluster_namespace_selector`)**

Після helper `egress_has_cluster_namespace_selector` (після рядка 158) додати:

```rego
cluster_egress_rule_without_ports(spec) if {
	egress := object.get(spec, "egress", null)
	is_array(egress)
	some rule in egress
	is_object(rule)
	to_list := object.get(rule, "to", null)
	is_array(to_list)
	some peer in to_list
	is_object(peer)
	ns := object.get(peer, "namespaceSelector", null)
	is_object(ns)
	count(ns) == 0
	ports := object.get(rule, "ports", [])
	count(ports) == 0
}
```

- [ ] **Step 3: Run rego tests — все PASS**

Run:
```bash
cd /Users/vitaliytv/www/nitra/cursor && \
  conftest verify -p npm/rules/k8s/policy/network_policy --namespace k8s.network_policy
```

Expected: 7 тестів PASS, 0 FAIL.

- [ ] **Step 4: Commit**

```bash
git add npm/rules/k8s/policy/network_policy/network_policy.rego \
        npm/rules/k8s/policy/network_policy/network_policy_test.rego && \
  git commit -m "feat(k8s/network_policy): deny catch-all in-cluster egress without ports"
```

---

### Task 4: Update canonical template (`networkpolicy.snippet.yaml`)

**Files:**
- Modify: `npm/rules/k8s/policy/network_policy/template/networkpolicy.snippet.yaml`.

- [ ] **Step 1: Replace last egress entry with explicit-ports block**

Поточне значення файлу (рядки 1-33):
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
  egress:
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
```

Замінити **повністю** на:
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
  egress:
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
```

- [ ] **Step 2: Commit**

```bash
git add npm/rules/k8s/policy/network_policy/template/networkpolicy.snippet.yaml && \
  git commit -m "feat(k8s/network_policy): explicit in-cluster ports in canonical snippet"
```

---

### Task 5: Update generator — add `NETWORK_POLICY_IN_CLUSTER_DEFAULT_PORTS` and `NETWORK_POLICY_EGRESS_YAML`

**Files:**
- Modify: `npm/rules/k8s/fix/manifests/check.mjs` — навколо рядків 4255-4282.
- Test: `npm/rules/k8s/fix/manifests/check-schema.test.mjs` — оновити тест `buildNetworkPolicyYaml містить імʼя workload, мітку app і канонічний egress`.

- [ ] **Step 1: Update the failing JS test for `buildNetworkPolicyYaml` (TDD: тест перший)**

У `check-schema.test.mjs` (рядки 2366-2376), замінити тест:

```js
  test('buildNetworkPolicyYaml містить імʼя workload, мітку app і канонічний egress', () => {
    const yaml = buildNetworkPolicyYaml('api', 'api')
    expect(yaml).toContain('name: api')
    expect(yaml).toContain('app: api')
    expect(yaml).toContain('kind: NetworkPolicy')
    expect(yaml).toContain('cidr: 0.0.0.0/0')
    expect(yaml).toContain('port: 80')
    expect(yaml).toContain('port: 443')
    expect(yaml).toContain('namespaceSelector: {}')
    expect(yaml).not.toContain('egress:\n    - {}')
  })
```

на:

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

- [ ] **Step 2: Run the test, verify it fails**

Run:
```bash
cd /Users/vitaliytv/www/nitra/cursor/npm && \
  bun test rules/k8s/fix/manifests/check-schema.test.mjs -t 'buildNetworkPolicyYaml'
```

Expected: FAIL — yaml не містить `port: 5432` тощо.

- [ ] **Step 3: Update `NETWORK_POLICY_EGRESS_YAML` and add `NETWORK_POLICY_IN_CLUSTER_DEFAULT_PORTS` constant**

У `check.mjs`, замінити блок `NETWORK_POLICY_EGRESS_YAML` (рядки 4255-4282) на:

```js
/**
 * Канонічний список in-cluster TCP-портів у `to: [{namespaceSelector: {}}]` rule.
 * Зовнішній доступ (80/443 → 0.0.0.0/0) і kube-dns (53 UDP/TCP) — окремі rule вище.
 */
const NETWORK_POLICY_IN_CLUSTER_DEFAULT_PORTS = [80, 443, 5432, 3306, 1433, 6379, 8080, 4317, 4318]

/**
 * Канонічний блок `spec.egress` NetworkPolicy (k8s.mdc):
 * kube-dns; TCP 80/443 на 0.0.0.0/0; in-cluster — `namespaceSelector: {}` зі списком
 * `NETWORK_POLICY_IN_CLUSTER_DEFAULT_PORTS` (catch-all без ports — заборонено).
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

- [ ] **Step 4: Run the test, verify PASS**

Run:
```bash
cd /Users/vitaliytv/www/nitra/cursor/npm && \
  bun test rules/k8s/fix/manifests/check-schema.test.mjs -t 'buildNetworkPolicyYaml'
```

Expected: PASS.

- [ ] **Step 5: Run the full schema test file**

Run:
```bash
cd /Users/vitaliytv/www/nitra/cursor/npm && \
  bun test rules/k8s/fix/manifests/check-schema.test.mjs
```

Expected: усі тести PASS (фікстура `networkPolicyManifestViolations` має catch-all egress без портів, але JS-валідатор не перевіряє вміст ports — тож тест має пройти; якщо ні — переходимо до Step 6).

- [ ] **Step 6: Якщо в Step 5 будь-який тест FAIL з причини нової форми egress — оновити відповідні фікстури під новий канон**

Локалізація фікстур — пошук:
```bash
cd /Users/vitaliytv/www/nitra/cursor/npm && \
  grep -nE 'namespaceSelector:\s*\{\}\s*$' rules/k8s/fix/manifests/check-schema.test.mjs
```

У знайдених фікстурах в YAML-strings замінити `- to:\n    - namespaceSelector: {}` на той самий блок з нашого нового `NETWORK_POLICY_EGRESS_YAML` (повний 9-портовий список). Якщо фікстура у JS-форматі (об'єкт) — додати `ports` як у Task 2 для rego.

- [ ] **Step 7: Run all schema tests again — PASS**

Run:
```bash
cd /Users/vitaliytv/www/nitra/cursor/npm && \
  bun test rules/k8s/fix/manifests/check-schema.test.mjs
```

Expected: всі PASS.

- [ ] **Step 8: Commit**

```bash
git add npm/rules/k8s/fix/manifests/check.mjs \
        npm/rules/k8s/fix/manifests/check-schema.test.mjs && \
  git commit -m "feat(k8s/network_policy): generator emits explicit in-cluster ports"
```

---

### Task 6: M1 migration — auto-regenerate legacy NP docs in fix mode

**Files:**
- Modify: `npm/rules/k8s/fix/manifests/check.mjs` — додати функцію `regenerateLegacyNetworkPolicyDocsInFile` і викликати її в `ensureNetworkPoliciesForWorkloadsInDir`.
- Test: `npm/rules/k8s/fix/manifests/check-schema.test.mjs` — новий тест.

- [ ] **Step 1: Write failing test для legacy-міграції**

У `check-schema.test.mjs`, у топ-import-блоці додати:

```js
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
```

(`join` вже імпортується — перевір існуючий import з `node:path`.)

У named-imports з `./check.mjs` додати `regenerateLegacyNetworkPolicyDocsInFile` до існуючого списку.

У кінці головного describe-блоку (перед закриваючою дужкою файлу), додати окремий `describe`-блок з двома тестами:

```js
describe('regenerateLegacyNetworkPolicyDocsInFile', () => {
  test('переписує catch-all egress на канон з 9 портами', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'np-migrate-'))
    try {
      const npAbs = join(dir, 'networkpolicy.yaml')
      const legacy = `# yaml-language-server: $schema=https://example/networkpolicy.json
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
`
      await writeFile(npAbs, legacy, 'utf8')
      const changed = await regenerateLegacyNetworkPolicyDocsInFile(npAbs)
      expect(changed).toBe(true)
      const out = await readFile(npAbs, 'utf8')
      for (const port of [5432, 3306, 1433, 6379, 8080, 4317, 4318]) {
        expect(out).toContain(`port: ${port}`)
      }
      expect(out).toContain('app: api')
      expect(out).toContain('name: api')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('повертає false і не змінює файл, коли catch-all відсутній', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'np-migrate-noop-'))
    try {
      const npAbs = join(dir, 'networkpolicy.yaml')
      const canonical = buildNetworkPolicyYaml('api', 'api')
      await writeFile(npAbs, canonical, 'utf8')
      const before = await readFile(npAbs, 'utf8')
      const changed = await regenerateLegacyNetworkPolicyDocsInFile(npAbs)
      expect(changed).toBe(false)
      const after = await readFile(npAbs, 'utf8')
      expect(after).toBe(before)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
```

- [ ] **Step 2: Run test, verify it fails (function not exported / not defined)**

Run:
```bash
cd /Users/vitaliytv/www/nitra/cursor/npm && \
  bun test rules/k8s/fix/manifests/check-schema.test.mjs -t 'regenerateLegacyNetworkPolicyDocsInFile'
```

Expected: FAIL — `regenerateLegacyNetworkPolicyDocsInFile is not a function` або не імпортується.

- [ ] **Step 3: Implement `regenerateLegacyNetworkPolicyDocsInFile` у `check.mjs`**

Додати після `appendNetworkPolicyDocuments` (~рядок 6407):

```js
/**
 * Перевіряє, чи `spec.egress` містить in-cluster rule з порожнім namespaceSelector БЕЗ ports
 * (catch-all, заборонено новим каноном).
 * @param {unknown} doc розпарсений NetworkPolicy-document
 * @returns {boolean} true якщо doc має legacy catch-all rule
 */
function networkPolicyHasLegacyCatchAllEgress(doc) {
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) return false
  const spec = /** @type {Record<string, unknown>} */ (doc).spec
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) return false
  const egress = /** @type {Record<string, unknown>} */ (spec).egress
  if (!Array.isArray(egress)) return false
  for (const rule of egress) {
    if (rule === null || typeof rule !== 'object' || Array.isArray(rule)) continue
    const ruleRec = /** @type {Record<string, unknown>} */ (rule)
    const to = ruleRec.to
    if (!Array.isArray(to)) continue
    const hasEmptyNsPeer = to.some(peer => {
      if (peer === null || typeof peer !== 'object' || Array.isArray(peer)) return false
      const ns = /** @type {Record<string, unknown>} */ (peer).namespaceSelector
      return ns !== null && typeof ns === 'object' && !Array.isArray(ns) && Object.keys(ns).length === 0
    })
    if (!hasEmptyNsPeer) continue
    const ports = ruleRec.ports
    if (!Array.isArray(ports) || ports.length === 0) return true
  }
  return false
}

/**
 * Migrate legacy `networkpolicy.yaml`: якщо хоч один документ має catch-all in-cluster egress —
 * перезаписати **всі** документи у файлі через `buildNetworkPolicyYaml(name, appLabel)`. Деталі — k8s.mdc.
 * @param {string} npAbs абсолютний шлях до networkpolicy.yaml
 * @returns {Promise<boolean>} true якщо файл переписаний
 */
export async function regenerateLegacyNetworkPolicyDocsInFile(npAbs) {
  if (!existsSync(npAbs)) return false
  const docs = await readAllDocsByKindFromFile(npAbs, 'NetworkPolicy')
  if (docs.length === 0) return false
  const needsMigration = docs.some(d => networkPolicyHasLegacyCatchAllEgress(d))
  if (!needsMigration) return false
  /**
  @type {Array<{ name: string, appLabel: string }>}
   */
  const specs = []
  for (const doc of docs) {
    const name = manifestMetadataName(doc)
    const spec = /** @type {Record<string, unknown>} */ (doc).spec
    let appLabel = ''
    if (spec !== null && typeof spec === 'object' && !Array.isArray(spec)) {
      const podSelector = /** @type {Record<string, unknown>} */ (spec).podSelector
      if (podSelector !== null && typeof podSelector === 'object' && !Array.isArray(podSelector)) {
        const matchLabels = /** @type {Record<string, unknown>} */ (podSelector).matchLabels
        if (matchLabels !== null && typeof matchLabels === 'object' && !Array.isArray(matchLabels)) {
          const a = /** @type {Record<string, unknown>} */ (matchLabels).app
          if (typeof a === 'string') appLabel = a
        }
      }
    }
    if (typeof name === 'string' && name !== '' && appLabel !== '') specs.push({ name, appLabel })
  }
  if (specs.length === 0) return false
  const blocks = specs.map(({ name, appLabel }, i) => {
    const block = buildNetworkPolicyYaml(name, appLabel)
    return i === 0 ? block.trimEnd() : stripYamlLanguageServerModeline(block).trimEnd()
  })
  await writeFile(npAbs, `${blocks.join('\n---\n')}\n`, 'utf8')
  return true
}
```

- [ ] **Step 4: Run test, verify both new tests PASS**

Run:
```bash
cd /Users/vitaliytv/www/nitra/cursor/npm && \
  bun test rules/k8s/fix/manifests/check-schema.test.mjs -t 'regenerateLegacyNetworkPolicyDocsInFile'
```

Expected: 2/2 PASS.

- [ ] **Step 5: Wire migration into fix flow**

У `ensureNetworkPoliciesForWorkloadsInDir` (рядок 6418), **перед** `const existing = await existingNetworkPolicyNames(npAbs)` (рядок 6423) додати:

```js
  if (existsSync(npAbs)) {
    const migrated = await regenerateLegacyNetworkPolicyDocsInFile(npAbs)
    if (migrated) {
      passFn(`${npRel}: міграція legacy catch-all egress → канон з явними in-cluster портами (k8s.mdc)`)
    }
  }
```

- [ ] **Step 6: Run full schema test file — все PASS**

Run:
```bash
cd /Users/vitaliytv/www/nitra/cursor/npm && \
  bun test rules/k8s/fix/manifests/check-schema.test.mjs
```

Expected: всі тести PASS.

- [ ] **Step 7: Commit**

```bash
git add npm/rules/k8s/fix/manifests/check.mjs \
        npm/rules/k8s/fix/manifests/check-schema.test.mjs && \
  git commit -m "feat(k8s/network_policy): migrate legacy catch-all egress in fix mode"
```

---

### Task 7: Update `k8s.mdc` documentation

**Files:**
- Modify: `npm/rules/k8s/k8s.mdc` — рядок 391 (прозовий опис), рядки 510-511 (YAML-snippet), `version` у front-matter (рядок 3).

- [ ] **Step 1: Update prose description on line 391**

Знайти у `k8s.mdc` рядок 391 (починається з `- **\`networkpolicy.yaml\`** —`), замінити фрагмент:

> «**Egress (усі workload-и):** kube-dns (UDP/TCP 53); **TCP 80 і 443** на `0.0.0.0/0` (HTTP/HTTPS назовні, включно з metadata `169.254.169.254:80`); **інші порти** — лише in-cluster через `to.namespaceSelector: {}` (трафік на `*.svc` / Pod-и в кластері; Postgres лише `*.svc`, без Cloud SQL). Заборонено `egress: [{}]`.»

на:

> «**Egress (усі workload-и):** kube-dns (UDP/TCP 53); **TCP 80 і 443** на `0.0.0.0/0` (HTTP/HTTPS назовні, включно з metadata `169.254.169.254:80`); **in-cluster** — `to.namespaceSelector: {}` з **явним списком TCP-портів** (`80, 443, 5432, 3306, 1433, 6379, 8080, 4317, 4318`; `*.svc` / Pod-и в кластері). Заборонено: `egress: [{}]`; `to.namespaceSelector: {}` без `ports:` (catch-all). Додаткові in-cluster порти можна додати вручну у `ports:` цього rule.»

- [ ] **Step 2: Update YAML snippet on lines 510-511**

У YAML-snippet знайти останній блок (рядки 510-511):
```yaml
    - to:
        - namespaceSelector: {}
```

Замінити на:
```yaml
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
```

- [ ] **Step 3: Bump rule version**

У front-matter (рядок 3): замінити `version: '1.35'` на `version: '1.36'`.

- [ ] **Step 4: Commit**

```bash
git add npm/rules/k8s/k8s.mdc && \
  git commit -m "docs(k8s.mdc): canonical egress canon — explicit in-cluster ports (1.35 → 1.36)"
```

---

### Task 8: Version bump and CHANGELOG entry

**Files:**
- Modify: `npm/package.json` — bump `version`.
- Modify: `npm/CHANGELOG.md` — додати запис.

- [ ] **Step 1: Bump npm version**

У `npm/package.json` (рядок 3), замінити:
```json
  "version": "1.13.47",
```
на:
```json
  "version": "1.13.48",
```

- [ ] **Step 2: Add CHANGELOG entry**

У `npm/CHANGELOG.md`, **зразу після** рядка `# Changelog` та форматного header-блоку (тобто перед першим існуючим `## [1.13.47] - 2026-05-19`), вставити новий запис:

```markdown
## [1.13.48] - 2026-05-19

### Changed

- `k8s.network_policy`: канонічний egress NetworkPolicy більше **не дозволяє** `to.namespaceSelector: {}` без `ports:` (catch-all). У шаблоні `networkpolicy.snippet.yaml`, генераторі `buildNetworkPolicyYaml` і rego-policy `network_policy.rego` тепер in-cluster rule має явний список TCP-портів: `80, 443, 5432, 3306, 1433, 6379, 8080, 4317, 4318`. Додатково: `fix k8s` під час прогону знаходить існуючі `networkpolicy.yaml` з legacy catch-all egress і **перезаписує** їх через `buildNetworkPolicyYaml` (повний rebuild за `metadata.name` + `app`-міткою). JS-валідатор `networkPolicyManifestViolations` не змінюється (порти enforce-ить rego). Bump `k8s.mdc` `1.35` → `1.36`. Спец: [docs/superpowers/specs/2026-05-19-networkpolicy-egress-explicit-ports-design.md](../../docs/superpowers/specs/2026-05-19-networkpolicy-egress-explicit-ports-design.md).
```

- [ ] **Step 3: Verify changelog format**

Run:
```bash
cd /Users/vitaliytv/www/nitra/cursor && \
  head -25 npm/CHANGELOG.md
```

Expected: новий запис `[1.13.48]` знаходиться відразу після опису формату та перед `[1.13.47]`.

- [ ] **Step 4: Commit**

```bash
git add npm/package.json npm/CHANGELOG.md && \
  git commit -m "chore(npm): release 1.13.48 — explicit NP in-cluster ports"
```

---

### Task 9: End-to-end verification

**Files:** жодні зміни — лише запуск перевірок.

- [ ] **Step 1: Запустити всі тести npm-пакета**

Run:
```bash
cd /Users/vitaliytv/www/nitra/cursor/npm && bun test
```

Expected: усі тести PASS.

- [ ] **Step 2: Запустити rego-тести**

Run:
```bash
cd /Users/vitaliytv/www/nitra/cursor && \
  conftest verify -p npm/rules/k8s/policy/network_policy --namespace k8s.network_policy
```

Expected: усі тести PASS (включно з новим `test_deny_cluster_egress_catch_all`).

- [ ] **Step 3: Прогнати fix k8s на реальному репо (smoke-test міграції)**

Run:
```bash
cd /Users/vitaliytv/www/nitra && \
  npx --yes /Users/vitaliytv/www/nitra/cursor/npm fix k8s
```

Expected:
- Існуючі `networkpolicy.yaml` з catch-all egress отримують повідомлення «міграція legacy catch-all egress → канон з явними in-cluster портами».
- Після прогону повторний `check k8s` має проходити без `deny`-помилок про catch-all.

- [ ] **Step 4: Перевірити, що ніщо не зламалось у lint**

Run:
```bash
cd /Users/vitaliytv/www/nitra/cursor && bun run lint
```

Expected: чистий вихід.

---

## Acceptance Criteria

- `conftest verify -p npm/rules/k8s/policy/network_policy --namespace k8s.network_policy` — усі тести PASS, включно з новим `test_deny_cluster_egress_catch_all`.
- `bun test` у `npm/` — усі тести PASS.
- `bun run lint` — чистий вихід.
- `buildNetworkPolicyYaml('api', 'api')` повертає YAML, що містить усі 9 in-cluster портів.
- `fix k8s` на реальному репо `nitra/` мігрує legacy `networkpolicy.yaml` без втрат `metadata.name` / `app`-мітки.
- `npm/CHANGELOG.md` має запис `[1.13.48]` з посиланням на spec.
- `k8s.mdc` версія `1.36`; прозовий опис і YAML-snippet оновлені.

---

## Notes for the implementer

- **Порядок виконання:** Task 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9. Окремі коміти на кожному кроці (Task 3 коммітить rego разом, бо тести й policy ходять парою).
- **TDD:** перед кожним implementation-кроком має бути failing test. Не пропускайте Step «verify it fails» — без нього не зрозуміло, що тест взагалі щось перевіряє.
- **Не комітимо** Task 1+2 окремо — це проміжний стан, де rego policy ще не вміє ловити catch-all. Один комміт у Task 3 покриває policy + tests.
- **Якщо у Task 5 Step 5 щось ламається** через інші JS-фікстури з catch-all egress — оновити їх (структура: додати `ports:` після `- to: [{namespaceSelector: {}}]`). Це може стосуватись `check-schema.test.mjs` рядків 1871, 2086, 2155, 2256 та інших із подібним рядком.
- **Аутлаєри `8000`/`3488`/`13133`:** після прогону міграції їхній in-cluster трафік на ці порти **зламається**. Окрема задача (за рамками цього плану): або перевести на стандартний `8080`, або додати extra `ports:` руками у відповідні `networkpolicy.yaml`.

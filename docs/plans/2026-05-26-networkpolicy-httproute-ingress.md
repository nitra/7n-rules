# NetworkPolicy HTTPRoute Ingress — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Автоматично додавати ingress-правило з GCP HC + Envoy data-plane CIDR-ами в `networkpolicy.yaml` для workload-ів, прив'язаних до `HTTPRoute` через `-hl` Service.

**Architecture:** Нова функція `collectHttpRouteIngressForWorkload(dir, appLabel, fail)` сканує каталог, мапить `HTTPRoute.backendRefs → Service.spec.selector.matchLabels.app → appLabel`, повертає `{ ports: [...] }` або `null`. Існуюча `buildNetworkPolicyYaml(deployName, appLabel, kind)` отримує опційний 4-й параметр `gclbPorts: number[]`. Два callsites (`appendNetworkPolicyDocuments`, `regenerateLegacyNetworkPolicyDocsInFile`) перед збіркою YAML викликають `collectHttpRouteIngressForWorkload` і пробрасують `ports`.

**Tech Stack:** Node.js/Bun, ES modules, `yaml` lib (`parseAllDocuments`, `parseDocument`, `stringify`), `bun:test`.

**Spec:** `docs/superpowers/specs/2026-05-26-networkpolicy-httproute-ingress-design.md`

---

## File Structure

| File                                                           | Role                                                              | Change                                                                                                                                                                         |
| -------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm/rules/k8s/js/manifests.mjs`                               | NP/HTTPRoute logic, generation, integration                       | **Modify**: нова `collectHttpRouteIngressForWorkload`, розширена `buildNetworkPolicyYaml`, оновлені `appendNetworkPolicyDocuments` і `regenerateLegacyNetworkPolicyDocsInFile` |
| `npm/rules/k8s/js/tests/manifests/tests/check-schema.test.mjs` | Існуючий тестовий файл для `buildNetworkPolicyYaml` і пов'язаного | **Modify**: додати describe-блок `collectHttpRouteIngressForWorkload` + integration-тести `buildNetworkPolicyYaml(..., gclbPorts)` + E2E fixture-тести                         |
| `npm/rules/k8s/k8s.mdc`                                        | Документація k8s правил                                           | **Modify**: новий блок під «NetworkPolicy у base/»; оновлений приклад `base/networkpolicy.yaml`                                                                                |
| `npm/CHANGELOG.md`                                             | Changelog npm workspace                                           | **Modify**: новий запис `## [X.Y.Z] - 2026-05-26`                                                                                                                              |
| `npm/package.json`                                             | Версія npm workspace                                              | **Modify**: bump `version` (patch або minor — узгодити з характером зміни)                                                                                                     |

**Decomposition note:** `manifests.mjs` уже великий (~6700 рядків), але існуючий патерн репо — тримати всю k8s-логіку в одному файлі. Не реструктуруємо. Нова функція додається поряд з існуючими NP-генераторами (рядки ~4250-4330).

---

## Task 1: `collectHttpRouteIngressForWorkload` — порожній каталог → `null`

**Files:**

- Modify: `npm/rules/k8s/js/manifests.mjs` (додати функцію поряд з `buildNetworkPolicyYaml`, ~рядок 4330)
- Test: `npm/rules/k8s/js/tests/manifests/tests/check-schema.test.mjs` (додати describe-блок)

- [ ] **Step 1.1: Write failing test — empty dir → null**

Додати в `check-schema.test.mjs` (після існуючих describe-блоків з `buildNetworkPolicyYaml`):

```javascript
describe('collectHttpRouteIngressForWorkload', () => {
  test('каталог без YAML → null', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'np-httproute-empty-'))
    try {
      const fail = mock(() => {})
      const result = await collectHttpRouteIngressForWorkload(dir, 'foo', fail)
      expect(result).toBeNull()
      expect(fail).not.toHaveBeenCalled()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
```

Додати імпорти у верхній блок файлу:

- `collectHttpRouteIngressForWorkload` у named imports з `manifests.mjs`
- `mock` з `bun:test` (поряд із `describe, expect, test`)

- [ ] **Step 1.2: Run test to verify it fails**

```bash
cd /Users/vitaliytv/www/nitra/cursor && bun test npm/rules/k8s/js/tests/manifests/tests/check-schema.test.mjs --test-name-pattern "collectHttpRouteIngressForWorkload" 2>&1 | head -30
```

Expected: FAIL — `collectHttpRouteIngressForWorkload is not exported / undefined`.

- [ ] **Step 1.3: Implement minimal function**

Знайти в `manifests.mjs` функцію `buildNetworkPolicyYaml` (~рядок 4312). Після неї додати:

```javascript
/**
 * Збирає унікальні TCP-порти з `HTTPRoute.backendRefs`, які адресують workload з міткою `appLabel`.
 *
 * Mapping: `backendRef.name` → `Service.metadata.name` у тому ж каталозі → `service.spec.selector.matchLabels.app === appLabel`.
 * Використовується для побудови HTTPRoute-aware ingress-правила в NetworkPolicy (GCLB + Envoy data-plane CIDR-и).
 * @param {string} dir абсолютний каталог
 * @param {string} appLabel `spec.selector.matchLabels.app` цільового workload
 * @param {(msg: string) => void} fail callback при read/parse-помилці YAML у каталозі
 * @returns {Promise<{ ports: number[] } | null>} відсортовані унікальні TCP-порти або null, якщо паринг відсутній
 */
export async function collectHttpRouteIngressForWorkload(dir, appLabel, fail) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return null
  }
  const yamlFiles = entries
    .filter(e => e.isFile() && (e.name.endsWith('.yaml') || e.name.endsWith('.yml')))
    .map(e => join(dir, e.name))
  if (yamlFiles.length === 0) return null
  return null
}
```

Перевірити, що `readdir` уже імпортовано з `node:fs/promises` у верхній частині `manifests.mjs`. Якщо ні — додати в import.

- [ ] **Step 1.4: Run test to verify it passes**

```bash
cd /Users/vitaliytv/www/nitra/cursor && bun test npm/rules/k8s/js/tests/manifests/tests/check-schema.test.mjs --test-name-pattern "collectHttpRouteIngressForWorkload" 2>&1 | head -30
```

Expected: PASS.

- [ ] **Step 1.5: Commit**

```bash
cd /Users/vitaliytv/www/nitra/cursor && git add npm/rules/k8s/js/manifests.mjs npm/rules/k8s/js/tests/manifests/tests/check-schema.test.mjs && git commit -m "feat(k8s/np): scaffold collectHttpRouteIngressForWorkload (empty dir → null)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Single HTTPRoute → single port

**Files:**

- Modify: `npm/rules/k8s/js/manifests.mjs:collectHttpRouteIngressForWorkload`
- Test: `npm/rules/k8s/js/tests/manifests/tests/check-schema.test.mjs`

- [ ] **Step 2.1: Add failing test**

Додати тест у тому ж `describe('collectHttpRouteIngressForWorkload', ...)`:

```javascript
test('HTTPRoute з backendRef foo-hl:8080 + Service foo-hl з selector.app=foo → ports=[8080]', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'np-httproute-single-'))
  try {
    await writeFile(
      join(dir, 'hr.yaml'),
      `apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: foo
  namespace: dev
spec:
  parentRefs:
    - name: gw
  rules:
    - matches:
        - path:
            type: PathPrefix
            value: /
      backendRefs:
        - name: foo-hl
          port: 8080
`,
      'utf8'
    )
    await writeFile(
      join(dir, 'svc-hl.yaml'),
      `apiVersion: v1
kind: Service
metadata:
  name: foo-hl
  namespace: dev
spec:
  clusterIP: None
  selector:
    app: foo
  ports:
    - port: 8080
`,
      'utf8'
    )
    const fail = mock(() => {})
    const result = await collectHttpRouteIngressForWorkload(dir, 'foo', fail)
    expect(result).toEqual({ ports: [8080] })
    expect(fail).not.toHaveBeenCalled()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2.2: Run test to verify it fails**

```bash
cd /Users/vitaliytv/www/nitra/cursor && bun test npm/rules/k8s/js/tests/manifests/tests/check-schema.test.mjs --test-name-pattern "foo-hl:8080" 2>&1 | head -30
```

Expected: FAIL — `expected {ports: [8080]}, got null`.

- [ ] **Step 2.3: Implement indexing logic**

Замінити тіло `collectHttpRouteIngressForWorkload` після `if (yamlFiles.length === 0) return null`:

```javascript
  /** @type {Array<{ name: string, port: number }>} */
  const allBackendRefs = []
  /** @type {Map<string, string>} */
  const servicesByName = new Map()

  for (const abs of yamlFiles) {
    let raw
    try {
      raw = await readFile(abs, 'utf8')
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      fail(`${abs}: не вдалося прочитати для GCLB ingress (HTTPRoute → NetworkPolicy mapping; k8s.mdc): ${msg}`)
      continue
    }
    const lines = toLines(raw)
    const body = lines.length > 0 && MODELINE_RE.test(lines[0]) ? yamlBodyAfterModeline(lines) : lines.join('\n')
    /** @type {import('yaml').Document[]} */
    let docs
    try {
      docs = parseAllDocuments(body)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      fail(`${abs}: не вдалося розпарсити YAML для GCLB ingress (HTTPRoute → NetworkPolicy mapping; k8s.mdc): ${msg}`)
      continue
    }
    for (const doc of docs) {
      if (doc.errors.length > 0) continue
      const rec = asPlainRecord(doc.toJSON())
      if (rec === null) continue
      const av = rec.apiVersion
      if (rec.kind === 'HTTPRoute' && typeof av === 'string' && av.startsWith(GATEWAY_API_GROUP_PREFIX)) {
        collectHttpRouteBackendRefsInto(rec.spec, allBackendRefs)
      } else if (rec.kind === 'Service') {
        const name = manifestMetadataName(rec)
        if (name !== null) {
          const spec = rec.spec
          if (spec !== null && typeof spec === 'object' && !Array.isArray(spec)) {
            const app = appLabelFromSpecSelector(/** @type {Record<string, unknown>} */ (spec))
            if (app !== null) servicesByName.set(name, app)
          }
        }
      }
    }
  }

  /** @type {Set<number>} */
  const ports = new Set()
  for (const { name, port } of allBackendRefs) {
    const targetApp = servicesByName.get(name)
    if (targetApp === appLabel) ports.add(port)
  }
  if (ports.size === 0) return null
  return { ports: [...ports].sort((a, b) => a - b) }
}

/**
 * Обходить `spec` HTTPRoute (`spec.rules[*].backendRefs[*]`) і додає `(name, port)` у акумулятор.
 * Дублює walk-логіку `collectGatewayApiRouteBackendServiceNames`, але зберігає `port` поруч з `name`.
 * @param {unknown} spec значення `spec` маршруту
 * @param {Array<{ name: string, port: number }>} out акумулятор
 * @returns {void} результат
 */
function collectHttpRouteBackendRefsInto(spec, out) {
  /**
   * @param {unknown} node вузол для обходу
   * @returns {void} результат
   */
  function walk(node) {
    if (node === null || node === undefined) return
    if (Array.isArray(node)) {
      for (const x of node) walk(x)
      return
    }
    if (typeof node !== 'object') return
    if (isGatewayApiBackendRefToService(node)) {
      const o = /** @type {Record<string, unknown>} */ (node)
      out.push({ name: String(o.name), port: /** @type {number} */ (o.port) })
    }
    for (const v of Object.values(node)) walk(v)
  }
  walk(spec)
```

- [ ] **Step 2.4: Run test to verify it passes**

```bash
cd /Users/vitaliytv/www/nitra/cursor && bun test npm/rules/k8s/js/tests/manifests/tests/check-schema.test.mjs --test-name-pattern "foo-hl:8080" 2>&1 | head -30
```

Expected: PASS.

- [ ] **Step 2.5: Re-run task 1 test (no regression)**

```bash
cd /Users/vitaliytv/www/nitra/cursor && bun test npm/rules/k8s/js/tests/manifests/tests/check-schema.test.mjs --test-name-pattern "collectHttpRouteIngressForWorkload" 2>&1 | head -30
```

Expected: BOTH tests PASS.

- [ ] **Step 2.6: Commit**

```bash
cd /Users/vitaliytv/www/nitra/cursor && git add npm/rules/k8s/js/manifests.mjs npm/rules/k8s/js/tests/manifests/tests/check-schema.test.mjs && git commit -m "feat(k8s/np): collectHttpRouteIngressForWorkload resolves backendRef→Service→app

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Multiple ports + dedup + non-matching backendRef

**Files:**

- Test: `npm/rules/k8s/js/tests/manifests/tests/check-schema.test.mjs`

- [ ] **Step 3.1: Add 4 tests (multiple distinct ports, dedup, non-match → null, multi-Service in dir)**

Додати в той самий describe:

```javascript
test('HTTPRoute з двома різними портами 8080/9090 → ports=[8080, 9090]', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'np-httproute-multi-'))
  try {
    await writeFile(
      join(dir, 'hr.yaml'),
      `apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: foo
  namespace: dev
spec:
  rules:
    - backendRefs:
        - name: foo-hl
          port: 8080
    - backendRefs:
        - name: foo-hl
          port: 9090
`,
      'utf8'
    )
    await writeFile(
      join(dir, 'svc-hl.yaml'),
      `apiVersion: v1
kind: Service
metadata:
  name: foo-hl
spec:
  selector:
    app: foo
  ports:
    - port: 8080
    - port: 9090
`,
      'utf8'
    )
    const fail = mock(() => {})
    const result = await collectHttpRouteIngressForWorkload(dir, 'foo', fail)
    expect(result).toEqual({ ports: [8080, 9090] })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Hasura-канон з 4 правилами того самого backendRef:8080 → дедуп до [8080]', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'np-httproute-dedup-'))
  try {
    await writeFile(
      join(dir, 'hr.yaml'),
      `apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: db-h
  namespace: dev
spec:
  rules:
    - matches:
        - path: { type: Exact, value: /ql }
      filters:
        - type: RequestRedirect
          requestRedirect:
            path: { type: ReplaceFullPath, replaceFullPath: /ql/console }
            statusCode: 302
    - matches:
        - path: { type: PathPrefix, value: /ql }
      backendRefs:
        - name: db-h-hl
          port: 8080
    - matches:
        - path: { type: PathPrefix, value: /ql }
          headers:
            - type: Exact
              name: Upgrade
              value: websocket
      backendRefs:
        - name: db-h-hl
          port: 8080
`,
      'utf8'
    )
    await writeFile(
      join(dir, 'svc-hl.yaml'),
      `apiVersion: v1
kind: Service
metadata:
  name: db-h-hl
spec:
  selector:
    app: db-h
  ports:
    - port: 8080
`,
      'utf8'
    )
    const fail = mock(() => {})
    const result = await collectHttpRouteIngressForWorkload(dir, 'db-h', fail)
    expect(result).toEqual({ ports: [8080] })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('HTTPRoute з backendRef, що не матчить appLabel → null', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'np-httproute-nomatch-'))
  try {
    await writeFile(
      join(dir, 'hr.yaml'),
      `apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: bar
spec:
  rules:
    - backendRefs:
        - name: bar-hl
          port: 8080
`,
      'utf8'
    )
    await writeFile(
      join(dir, 'svc-hl.yaml'),
      `apiVersion: v1
kind: Service
metadata:
  name: bar-hl
spec:
  selector:
    app: bar
  ports:
    - port: 8080
`,
      'utf8'
    )
    const fail = mock(() => {})
    const result = await collectHttpRouteIngressForWorkload(dir, 'foo', fail)
    expect(result).toBeNull()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Service без selector.matchLabels.app → правило не додається (null)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'np-httproute-no-app-'))
  try {
    await writeFile(
      join(dir, 'hr.yaml'),
      `apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: foo
spec:
  rules:
    - backendRefs:
        - name: foo-hl
          port: 8080
`,
      'utf8'
    )
    await writeFile(
      join(dir, 'svc-hl.yaml'),
      `apiVersion: v1
kind: Service
metadata:
  name: foo-hl
spec:
  selector:
    component: foo
  ports:
    - port: 8080
`,
      'utf8'
    )
    const fail = mock(() => {})
    const result = await collectHttpRouteIngressForWorkload(dir, 'foo', fail)
    expect(result).toBeNull()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 3.2: Run all 4 tests — verify they pass without code change**

```bash
cd /Users/vitaliytv/www/nitra/cursor && bun test npm/rules/k8s/js/tests/manifests/tests/check-schema.test.mjs --test-name-pattern "collectHttpRouteIngressForWorkload" 2>&1 | head -50
```

Expected: ALL 5 tests PASS (логіка з Task 2 уже покриває ці кейси).

- [ ] **Step 3.3: Commit**

```bash
cd /Users/vitaliytv/www/nitra/cursor && git add npm/rules/k8s/js/tests/manifests/tests/check-schema.test.mjs && git commit -m "test(k8s/np): cover dedup, multi-port, non-matching backendRef cases

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Broken YAML → `fail` callback викликається

**Files:**

- Test: `npm/rules/k8s/js/tests/manifests/tests/check-schema.test.mjs`

- [ ] **Step 4.1: Add failing test**

```javascript
test('зламаний hr.yaml → fail callback з конкретним повідомленням; функція повертає null', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'np-httproute-broken-'))
  try {
    await writeFile(
      join(dir, 'hr.yaml'),
      'apiVersion: gateway.networking.k8s.io/v1\nkind: HTTPRoute\n  bad: : : indent\n',
      'utf8'
    )
    const fail = mock(() => {})
    const result = await collectHttpRouteIngressForWorkload(dir, 'foo', fail)
    expect(result).toBeNull()
    expect(fail).toHaveBeenCalledTimes(1)
    const msg = fail.mock.calls[0][0]
    expect(msg).toMatch(/hr\.yaml/)
    expect(msg).toMatch(/HTTPRoute → NetworkPolicy mapping/)
    expect(msg).toMatch(/k8s\.mdc/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 4.2: Run test — verify it passes**

```bash
cd /Users/vitaliytv/www/nitra/cursor && bun test npm/rules/k8s/js/tests/manifests/tests/check-schema.test.mjs --test-name-pattern "зламаний hr.yaml" 2>&1 | head -30
```

Expected: PASS (логіка з Task 2 уже викликає `fail`).

Якщо тест падає — перевірити, що:

- `parseAllDocuments` дійсно кидає на цьому YAML (інакше нам потрібно перевіряти `doc.errors.length > 0` і теж викликати `fail`).
- Якщо `parseAllDocuments` повертає docs з errors замість throw — додати в код:

  ```javascript
  for (const doc of docs) {
    if (doc.errors.length > 0) {
      fail(
        `${abs}: YAML містить помилки для GCLB ingress (HTTPRoute → NetworkPolicy mapping; k8s.mdc): ${doc.errors[0].message}`
      )
      continue
    }
    // ... existing rec handling
  }
  ```

- [ ] **Step 4.3: Commit**

```bash
cd /Users/vitaliytv/www/nitra/cursor && git add npm/rules/k8s/js/manifests.mjs npm/rules/k8s/js/tests/manifests/tests/check-schema.test.mjs && git commit -m "test(k8s/np): broken HTTPRoute YAML → fail callback fires

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `buildNetworkPolicyYaml` — extend with optional `gclbPorts`

**Files:**

- Modify: `npm/rules/k8s/js/manifests.mjs:buildNetworkPolicyYaml` (~рядок 4312)
- Test: `npm/rules/k8s/js/tests/manifests/tests/check-schema.test.mjs`

- [ ] **Step 5.1: Failing test — undefined gclbPorts → identical output**

Додати у існуючий describe-блок з `buildNetworkPolicyYaml`:

```javascript
test('buildNetworkPolicyYaml: gclbPorts undefined → output ідентичний baseline canon', () => {
  const baseline = buildNetworkPolicyYaml('api', 'api', 'Deployment')
  const withUndef = buildNetworkPolicyYaml('api', 'api', 'Deployment', undefined)
  expect(withUndef).toBe(baseline)
})

test('buildNetworkPolicyYaml: gclbPorts=[] → output ідентичний baseline canon', () => {
  const baseline = buildNetworkPolicyYaml('api', 'api', 'Deployment')
  const withEmpty = buildNetworkPolicyYaml('api', 'api', 'Deployment', [])
  expect(withEmpty).toBe(baseline)
})

test('buildNetworkPolicyYaml: gclbPorts=[8080] (Deployment) → ingress містить GCLB-правило з TCP/8080', () => {
  const yaml = buildNetworkPolicyYaml('api', 'api', 'Deployment', [8080])
  const result = parseYaml(yaml)
  const ingress = result.spec.ingress
  expect(ingress).toHaveLength(2)
  expect(ingress[0]).toEqual({ from: [{ podSelector: {} }] })
  expect(ingress[1]).toEqual({
    from: [
      { ipBlock: { cidr: '35.191.0.0/16' } },
      { ipBlock: { cidr: '130.211.0.0/22' } },
      { ipBlock: { cidr: '10.0.0.0/8' } }
    ],
    ports: [{ protocol: 'TCP', port: 8080 }]
  })
})

test('buildNetworkPolicyYaml: gclbPorts=[8080, 9090] → одне правило з обома портами (сортовано)', () => {
  const yaml = buildNetworkPolicyYaml('api', 'api', 'Deployment', [9090, 8080])
  const result = parseYaml(yaml)
  const gclbRule = result.spec.ingress[1]
  expect(gclbRule.ports).toEqual([
    { protocol: 'TCP', port: 8080 },
    { protocol: 'TCP', port: 9090 }
  ])
})

test('buildNetworkPolicyYaml: gclbPorts=[8080] для StatefulSet → правило додається; intra-replica залишається', () => {
  const yaml = buildNetworkPolicyYaml('pg', 'pg', 'StatefulSet', [8080])
  const result = parseYaml(yaml)
  const ingress = result.spec.ingress
  // baseline statefulset: [{from:[{podSelector:{}}]}, {from:[{podSelector:{matchLabels:{}}}]}]
  // після додавання GCLB → 3 правила
  expect(ingress).toHaveLength(3)
  expect(ingress[0]).toEqual({ from: [{ podSelector: {} }] })
  expect(ingress[1]).toEqual({ from: [{ podSelector: { matchLabels: {} } }] })
  expect(ingress[2].ports).toEqual([{ protocol: 'TCP', port: 8080 }])
  expect(ingress[2].from).toEqual([
    { ipBlock: { cidr: '35.191.0.0/16' } },
    { ipBlock: { cidr: '130.211.0.0/22' } },
    { ipBlock: { cidr: '10.0.0.0/8' } }
  ])
})
```

- [ ] **Step 5.2: Run tests — verify gclbPorts tests fail, baseline-identity tests pass**

```bash
cd /Users/vitaliytv/www/nitra/cursor && bun test npm/rules/k8s/js/tests/manifests/tests/check-schema.test.mjs --test-name-pattern "buildNetworkPolicyYaml" 2>&1 | head -60
```

Expected:

- 2 baseline-identity tests: PASS (4-й параметр поки ігнорується JS-ом).
- 3 gclb-rule tests: FAIL (правило не додається).

- [ ] **Step 5.3: Implement gclbPorts support**

У `manifests.mjs` знайти `buildNetworkPolicyYaml` (рядок ~4312). Замінити сигнатуру і тіло:

```javascript
/**
 * Канонічний YAML **NetworkPolicy** для workload з іменем `deployName`, міткою `app` і типом `kind`.
 * Snippet обирається за `kind` через `KIND_TO_SNIPPET` (без merge — кожен snippet самодостатній).
 * Анотація `nitra.dev/workload-kind` додається, щоб rego обрав на правильний канон.
 *
 * Якщо `gclbPorts` непорожній — після canon ingress-правил додається одне ingress-правило
 * з фіксованими CIDR-ами (GCP HC global + Envoy data-plane) і відсортованими унікальними TCP-портами
 * (для HTTPRoute-paired workload-ів; див. `collectHttpRouteIngressForWorkload` і k8s.mdc).
 * @param {string} deployName `metadata.name` workload
 * @param {string} appLabel `spec.selector.matchLabels.app`
 * @param {string} kind `kind` workload (обовʼязковий: Deployment | StatefulSet | Job | CronJob | DaemonSet)
 * @param {readonly number[]} [gclbPorts] TCP-порти з backendRefs HTTPRoute (опційно)
 * @returns {string} вміст `networkpolicy.yaml`
 */
export function buildNetworkPolicyYaml(deployName, appLabel, kind, gclbPorts) {
  const schemaUrl = `${YANNH_BASE}networkpolicy-networking-v1.json`
  const snippetName = snippetNameForKind(kind)
  const spec = structuredClone(loadSnippetSpec(snippetName))
  spec.podSelector.matchLabels = { app: appLabel }
  if (Array.isArray(gclbPorts) && gclbPorts.length > 0) {
    const uniqueSorted = [...new Set(gclbPorts)].sort((a, b) => a - b)
    const gclbRule = {
      from: NETWORK_POLICY_GCLB_INGRESS_FROM,
      ports: uniqueSorted.map(port => ({ protocol: 'TCP', port }))
    }
    spec.ingress = [...(spec.ingress ?? []), gclbRule]
  }
  const specYaml = stringify(spec, { indent: 2 })
    .replaceAll(/^(?!$)/gm, '  ')
    .trimEnd()
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

/**
 * `from`-peers для HTTPRoute-aware ingress-правила (GCP HC global + Envoy data-plane / proxy-only subnet).
 * Порядок зафіксовано детерміністичним (HC-global → 10.0.0.0/8).
 * Див. розділ «HTTPRoute → NetworkPolicy ingress» у k8s.mdc.
 * @type {ReadonlyArray<{ ipBlock: { cidr: string } }>}
 */
const NETWORK_POLICY_GCLB_INGRESS_FROM = Object.freeze([
  { ipBlock: { cidr: '35.191.0.0/16' } },
  { ipBlock: { cidr: '130.211.0.0/22' } },
  { ipBlock: { cidr: '10.0.0.0/8' } }
])
```

- [ ] **Step 5.4: Run all buildNetworkPolicyYaml tests**

```bash
cd /Users/vitaliytv/www/nitra/cursor && bun test npm/rules/k8s/js/tests/manifests/tests/check-schema.test.mjs --test-name-pattern "buildNetworkPolicyYaml" 2>&1 | head -60
```

Expected: ALL PASS, including попередні (no regression на 3 існуючих тести з рядків 2249-2271).

- [ ] **Step 5.5: Commit**

```bash
cd /Users/vitaliytv/www/nitra/cursor && git add npm/rules/k8s/js/manifests.mjs npm/rules/k8s/js/tests/manifests/tests/check-schema.test.mjs && git commit -m "feat(k8s/np): buildNetworkPolicyYaml accepts optional gclbPorts for HTTPRoute ingress

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Integrate into `appendNetworkPolicyDocuments`

**Files:**

- Modify: `npm/rules/k8s/js/manifests.mjs:appendNetworkPolicyDocuments` (~рядок 6298) і виклик у `ensureNetworkPoliciesForWorkloadsInDir` (~рядок 6413)

- [ ] **Step 6.1: Failing E2E test — append flow**

Додати у `check-schema.test.mjs` у новий describe `ensureNetworkPoliciesForWorkloadsInDir + HTTPRoute`:

```javascript
describe('NP generation з HTTPRoute pairing', () => {
  test('ensureNetworkPoliciesForWorkloadsInDir додає GCLB-правило, якщо HTTPRoute прив'язаний до workload', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'np-e2e-pair-'))
    try {
      // deploy.yaml + svc.yaml + svc-hl.yaml + hr.yaml; networkpolicy.yaml ще немає → буде створений
      await writeFile(
        join(dir, 'deploy.yaml'),
        `apiVersion: apps/v1
kind: Deployment
metadata:
  name: foo
  namespace: dev
spec:
  selector:
    matchLabels:
      app: foo
  template:
    metadata:
      labels:
        app: foo
    spec:
      containers:
        - name: foo
          image: example/foo:dev
`,
        'utf8'
      )
      await writeFile(
        join(dir, 'svc-hl.yaml'),
        `apiVersion: v1
kind: Service
metadata:
  name: foo-hl
spec:
  clusterIP: None
  selector:
    app: foo
  ports:
    - port: 8080
`,
        'utf8'
      )
      await writeFile(
        join(dir, 'hr.yaml'),
        `apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: foo
spec:
  rules:
    - backendRefs:
        - name: foo-hl
          port: 8080
`,
        'utf8'
      )
      const npAbs = join(dir, 'networkpolicy.yaml')
      // прямий виклик appendNetworkPolicyDocuments недоступний (private),
      // тому використовуємо публічний шлях — buildNetworkPolicyYaml з gclbPorts отриманими від collectHttpRouteIngressForWorkload.
      const fail = mock(() => {})
      const ports = await collectHttpRouteIngressForWorkload(dir, 'foo', fail)
      expect(ports).toEqual({ ports: [8080] })
      const yamlContent = buildNetworkPolicyYaml('foo', 'foo', 'Deployment', ports.ports)
      await writeFile(npAbs, yamlContent, 'utf8')
      const written = await readFile(npAbs, 'utf8')
      const parsed = parseYaml(written)
      const gclbRule = parsed.spec.ingress.find(r => r.from?.[0]?.ipBlock?.cidr === '35.191.0.0/16')
      expect(gclbRule).toBeDefined()
      expect(gclbRule.ports).toEqual([{ protocol: 'TCP', port: 8080 }])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
```

(Цей тест уже має проходити завдяки роботі Task 1-5 — він підтверджує end-to-end mapping.)

- [ ] **Step 6.2: Run E2E test — verify it passes**

```bash
cd /Users/vitaliytv/www/nitra/cursor && bun test npm/rules/k8s/js/tests/manifests/tests/check-schema.test.mjs --test-name-pattern "NP generation з HTTPRoute pairing" 2>&1 | head -30
```

Expected: PASS.

- [ ] **Step 6.3: Now wire `appendNetworkPolicyDocuments` to actually call collectHttpRouteIngressForWorkload**

У `manifests.mjs` модифікувати `appendNetworkPolicyDocuments` (~рядок 6298). Поточна сигнатура:

```
async function appendNetworkPolicyDocuments(npAbs, toAdd, npRel, passFn)
```

Нова сигнатура додає `fail`:

```
async function appendNetworkPolicyDocuments(npAbs, toAdd, npRel, fail, passFn)
```

Замінити тіло (особливо блок `blocks.map(...)`):

```javascript
async function appendNetworkPolicyDocuments(npAbs, toAdd, npRel, fail, passFn) {
  if (toAdd.length === 0) return
  let content = ''
  if (existsSync(npAbs)) {
    const raw = await readFile(npAbs, 'utf8')
    content = raw.trimEnd()
  }
  const dir = dirname(npAbs)
  const blocks = []
  for (const [i, { name, appLabel, kind }] of toAdd.entries()) {
    const gclb = await collectHttpRouteIngressForWorkload(dir, appLabel, fail)
    const gclbPorts = gclb === null ? undefined : gclb.ports
    const block = buildNetworkPolicyYaml(name, appLabel, kind, gclbPorts)
    blocks.push(i === 0 && content === '' ? block.trimEnd() : stripYamlLanguageServerModeline(block).trimEnd())
  }
  const joined = blocks.join('\n---\n')
  content = content === '' ? `${joined}\n` : `${content}\n---\n${joined}\n`
  await writeFile(npAbs, content, 'utf8')
  for (const { name, kind } of toAdd) {
    passFn(`${npRel}: додано NetworkPolicy для ${kind} '${name}' (k8s.mdc)`)
  }
}
```

Оновити **єдиний** callsite у `ensureNetworkPoliciesForWorkloadsInDir` (~рядок 6437):

```javascript
await appendNetworkPolicyDocuments(npAbs, toAdd, npRel, fail, passFn)
```

- [ ] **Step 6.4: Re-run full bun test for k8s tests**

```bash
cd /Users/vitaliytv/www/nitra/cursor && bun test npm/rules/k8s/js/tests/manifests/tests/check-schema.test.mjs 2>&1 | tail -30
```

Expected: ALL PASS (no regression).

- [ ] **Step 6.5: Commit**

```bash
cd /Users/vitaliytv/www/nitra/cursor && git add npm/rules/k8s/js/manifests.mjs npm/rules/k8s/js/tests/manifests/tests/check-schema.test.mjs && git commit -m "feat(k8s/np): appendNetworkPolicyDocuments injects HTTPRoute-derived GCLB ingress

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Integrate into `regenerateLegacyNetworkPolicyDocsInFile`

**Files:**

- Modify: `npm/rules/k8s/js/manifests.mjs:regenerateLegacyNetworkPolicyDocsInFile` (~рядок 6367) і callsite у `ensureNetworkPoliciesForWorkloadsInDir` (~рядок 6418)

- [ ] **Step 7.1: Failing test — regenerate path також додає GCLB-правило**

Додати у describe `NP generation з HTTPRoute pairing`:

```javascript
test('regenerateLegacyNetworkPolicyDocsInFile інжектить GCLB-правило, якщо HTTPRoute paired', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'np-e2e-regen-pair-'))
  try {
    await writeFile(
      join(dir, 'svc-hl.yaml'),
      `apiVersion: v1
kind: Service
metadata:
  name: bar-hl
spec:
  clusterIP: None
  selector:
    app: bar
  ports:
    - port: 9090
`,
      'utf8'
    )
    await writeFile(
      join(dir, 'hr.yaml'),
      `apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: bar
spec:
  rules:
    - backendRefs:
        - name: bar-hl
          port: 9090
`,
      'utf8'
    )
    const npAbs = join(dir, 'networkpolicy.yaml')
    // легасі NP з catch-all egress namespaceSelector:{} без ports
    await writeFile(
      npAbs,
      `apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: bar
  annotations:
    nitra.dev/workload-kind: Deployment
spec:
  podSelector:
    matchLabels:
      app: bar
  policyTypes:
    - Ingress
    - Egress
  ingress:
    - from:
        - podSelector: {}
  egress:
    - to:
        - namespaceSelector: {}
`,
      'utf8'
    )
    const fail = mock(() => {})
    const changed = await regenerateLegacyNetworkPolicyDocsInFile(npAbs, fail)
    expect(changed).toBe(true)
    const written = await readFile(npAbs, 'utf8')
    const parsed = parseYaml(written)
    const gclbRule = parsed.spec.ingress.find(r => r.from?.[0]?.ipBlock?.cidr === '35.191.0.0/16')
    expect(gclbRule).toBeDefined()
    expect(gclbRule.ports).toEqual([{ protocol: 'TCP', port: 9090 }])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 7.2: Run test — verify it fails**

```bash
cd /Users/vitaliytv/www/nitra/cursor && bun test npm/rules/k8s/js/tests/manifests/tests/check-schema.test.mjs --test-name-pattern "regenerateLegacyNetworkPolicyDocsInFile інжектить GCLB" 2>&1 | head -30
```

Expected: FAIL — written NP не містить GCLB-правила (бо `regenerateLegacyNetworkPolicyDocsInFile` ще не пропускає `gclbPorts` у `buildNetworkPolicyYaml`).

- [ ] **Step 7.3: Modify regenerateLegacyNetworkPolicyDocsInFile**

Знайти `regenerateLegacyNetworkPolicyDocsInFile` (~рядок 6367). Замінити сигнатуру і тіло:

```javascript
/**
 * Migrate legacy `networkpolicy.yaml`: якщо хоч один документ має catch-all in-cluster egress —
 * перезаписати **всі** документи у файлі через `buildNetworkPolicyYaml(name, appLabel, kind, gclbPorts)`.
 * `gclbPorts` витягуються з HTTPRoute paired у тому ж каталозі (див. `collectHttpRouteIngressForWorkload`).
 * Деталі — k8s.mdc.
 * @param {string} npAbs абсолютний шлях до networkpolicy.yaml
 * @param {(msg: string) => void} [fail] callback при read/parse-помилці HTTPRoute/Service (опційно — для backward compat)
 * @returns {Promise<boolean>} true якщо файл переписаний
 */
export async function regenerateLegacyNetworkPolicyDocsInFile(npAbs, fail) {
  if (!existsSync(npAbs)) return false
  const docs = await readAllDocsByKindFromFile(npAbs, 'NetworkPolicy')
  if (docs.length === 0) return false
  const needsMigration = docs.some(d => networkPolicyHasLegacyCatchAllEgress(d))
  if (!needsMigration) return false
  /** @type {Array<{ name: string, appLabel: string, kind: string }>} */
  const specs = []
  for (const doc of docs) {
    const name = manifestMetadataName(doc)
    const docRec = /** @type {Record<string, unknown>} */ (doc)
    const spec = docRec.spec
    const appLabel = networkPolicyPodSelectorAppLabel(spec)
    const meta = docRec.metadata
    const annotations =
      meta !== null && typeof meta === 'object' && !Array.isArray(meta)
        ? /** @type {Record<string, unknown>} */ (meta).annotations
        : null
    const rawKind =
      annotations !== null && typeof annotations === 'object' && !Array.isArray(annotations)
        ? /** @type {Record<string, unknown>} */ (annotations)['nitra.dev/workload-kind']
        : null
    const kind = typeof rawKind === 'string' && rawKind !== '' ? rawKind : 'Deployment'
    if (typeof name === 'string' && name !== '' && appLabel !== '') specs.push({ name, appLabel, kind })
  }
  if (specs.length === 0) return false
  const dir = dirname(npAbs)
  const failCb = typeof fail === 'function' ? fail : () => {}
  const blocks = []
  for (const [i, { name, appLabel, kind }] of specs.entries()) {
    const gclb = await collectHttpRouteIngressForWorkload(dir, appLabel, failCb)
    const gclbPorts = gclb === null ? undefined : gclb.ports
    const block = buildNetworkPolicyYaml(name, appLabel, kind, gclbPorts)
    blocks.push(i === 0 ? block.trimEnd() : stripYamlLanguageServerModeline(block).trimEnd())
  }
  await writeFile(npAbs, `${blocks.join('\n---\n')}\n`, 'utf8')
  return true
}
```

Оновити callsite у `ensureNetworkPoliciesForWorkloadsInDir` (~рядок 6418):

```javascript
const migrated = await regenerateLegacyNetworkPolicyDocsInFile(npAbs, fail)
```

- [ ] **Step 7.4: Run all NP tests**

```bash
cd /Users/vitaliytv/www/nitra/cursor && bun test npm/rules/k8s/js/tests/manifests/tests/check-schema.test.mjs 2>&1 | tail -30
```

Expected: ALL PASS (включно з новим regenerate-pair тестом).

- [ ] **Step 7.5: Commit**

```bash
cd /Users/vitaliytv/www/nitra/cursor && git add npm/rules/k8s/js/manifests.mjs npm/rules/k8s/js/tests/manifests/tests/check-schema.test.mjs && git commit -m "feat(k8s/np): regenerateLegacyNetworkPolicyDocsInFile injects HTTPRoute GCLB ingress

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Negative case — workload без HTTPRoute → NP без GCLB-правила (no regression)

**Files:**

- Test: `npm/rules/k8s/js/tests/manifests/tests/check-schema.test.mjs`

- [ ] **Step 8.1: Add test**

```javascript
test('workload без HTTPRoute → NP без GCLB-правила (baseline canon)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'np-e2e-no-pair-'))
  try {
    await writeFile(
      join(dir, 'deploy.yaml'),
      `apiVersion: apps/v1
kind: Deployment
metadata:
  name: lonely
  namespace: dev
spec:
  selector:
    matchLabels:
      app: lonely
  template:
    metadata:
      labels:
        app: lonely
    spec:
      containers:
        - name: lonely
          image: example/lonely:dev
`,
      'utf8'
    )
    const fail = mock(() => {})
    const ports = await collectHttpRouteIngressForWorkload(dir, 'lonely', fail)
    expect(ports).toBeNull()
    const yamlContent = buildNetworkPolicyYaml('lonely', 'lonely', 'Deployment', ports?.ports)
    const parsed = parseYaml(yamlContent)
    const gclbRule = parsed.spec.ingress.find(r => r.from?.[0]?.ipBlock !== undefined)
    expect(gclbRule).toBeUndefined()
    // ingress містить тільки baseline canon
    expect(parsed.spec.ingress).toEqual([{ from: [{ podSelector: {} }] }])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 8.2: Run — verify it passes**

```bash
cd /Users/vitaliytv/www/nitra/cursor && bun test npm/rules/k8s/js/tests/manifests/tests/check-schema.test.mjs --test-name-pattern "workload без HTTPRoute" 2>&1 | head -30
```

Expected: PASS.

- [ ] **Step 8.3: Commit**

```bash
cd /Users/vitaliytv/www/nitra/cursor && git add npm/rules/k8s/js/tests/manifests/tests/check-schema.test.mjs && git commit -m "test(k8s/np): workload without HTTPRoute keeps baseline canon (no GCLB rule)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Update `k8s.mdc` documentation

**Files:**

- Modify: `npm/rules/k8s/k8s.mdc`

- [ ] **Step 9.1: Bump version у frontmatter**

Знайти у `k8s.mdc` (рядки 1-5):

```yaml
---
description: K8s YAML — $schema (yaml-language-server); lint-k8s (kubeconform, kubescape); check-k8s
version: '1.41'
globs: '**/k8s/**/*.yaml'
alwaysApply: false
---
```

Bump `version` до `'1.42'`.

- [ ] **Step 9.2: Додати новий розділ під «Deployment: topologySpreadConstraints, HPA / PDB через components/, NetworkPolicy у base/»**

Після рядка ~408 (`- topologySpreadConstraints — запис з maxSkew: 1, ...`) і блоку «Перевірка структури components/» (рядок 411), знайти кінець підрозділу і **перед** «### Env-залежні межі (за сегментом після /k8s/)» додати:

````markdown
### HTTPRoute → NetworkPolicy ingress (GCLB + Envoy)

Якщо в каталозі workload є **`HTTPRoute`** (Gateway API; `apiVersion: gateway.networking.k8s.io/*`) з **`backendRef`** на **`<workload>-hl`** Service (mapping через `service.spec.selector.matchLabels.app`), **`check k8s`** автоматично додає в NetworkPolicy цього workload **ingress-правило** з фіксованим набором CIDR-ів і **TCP-портами з `backendRefs[].port`** (дедуп, відсортовано за зростанням).

Без цього правила трафік від **GKE Gateway** (Envoy data-plane з proxy-only subnet регіону, наприклад `us-central1-proxy-only` = `10.10.0.0/23`) і **Google health checks** (`35.191.0.0/16`, `130.211.0.0/22`) блокується базовим NetworkPolicy (бо canon ingress допускає тільки `podSelector: {}` — intra-namespace pod ↔ pod).

CIDR-набір зафіксовано (без конфігурації):

- `35.191.0.0/16` — GCP HC global
- `130.211.0.0/22` — GCP HC global (legacy)
- `10.0.0.0/8` — purpose-built широкий range, покриває proxy-only subnets усіх регіонів GKE

Приклад згенерованого ingress-правила (поверх baseline canon):

```yaml
ingress:
  - from:
      - podSelector: {}
  - from: # auto-added for HTTPRoute-paired workloads
      - ipBlock: { cidr: 35.191.0.0/16 }
      - ipBlock: { cidr: 130.211.0.0/22 }
      - ipBlock: { cidr: 10.0.0.0/8 }
    ports:
      - { protocol: TCP, port: 8080 }
```

Якщо workload не прив'язаний до жодного HTTPRoute — правило **не** додається; NP лишається baseline (intra-namespace + canon egress). **Не-HTTP routes** (`GRPCRoute`, `TCPRoute`, `TLSRoute`, `UDPRoute`) поки не покриті — додамо в окремому правилі за потреби.

Алгоритм: функція `collectHttpRouteIngressForWorkload` у **`rules/k8s/js/manifests.mjs`** — індексує `HTTPRoute.backendRefs` і `Service` у каталозі, визначає через `selector.matchLabels.app`, дедуп TCP-портів. Виклики — з `appendNetworkPolicyDocuments` і `regenerateLegacyNetworkPolicyDocsInFile`.
````

- [ ] **Step 9.3: Update example `base/networkpolicy.yaml`**

У k8s.mdc знайти приклад `base/networkpolicy.yaml` (рядки ~487-554). Залишити цей приклад БЕЗ GCLB-правила (це baseline canon без HTTPRoute), але додати під ним новий приклад `base/networkpolicy.yaml` із GCLB-правилом для workload з HTTPRoute. Додати після поточного прикладу (після рядка 554):

````markdown
```yaml title="k8s/base/networkpolicy.yaml — workload з HTTPRoute (з GCLB ingress)"
# yaml-language-server: $schema=https://raw.githubusercontent.com/yannh/kubernetes-json-schema/master/v1.33.9-standalone-strict/networkpolicy-networking-v1.json
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: backend-api
  annotations:
    nitra.dev/workload-kind: Deployment
spec:
  podSelector:
    matchLabels:
      app: backend-api
  policyTypes:
    - Ingress
    - Egress
  ingress:
    - from:
        - podSelector: {}
    - from: # auto-added by check k8s for HTTPRoute-paired workloads
        - ipBlock: { cidr: 35.191.0.0/16 }
        - ipBlock: { cidr: 130.211.0.0/22 }
        - ipBlock: { cidr: 10.0.0.0/8 }
      ports:
        - { protocol: TCP, port: 8080 }
  egress:
    # ... (ідентично до базового прикладу вище)
```
````

- [ ] **Step 9.4: Verify k8s.mdc через mdc-check (якщо існує)**

```bash
cd /Users/vitaliytv/www/nitra/cursor && npx @nitra/cursor check mdc 2>&1 | tail -20
```

Якщо `check mdc` не покриває цей файл — пропустити. Якщо є помилки — виправити (типово форматинг).

- [ ] **Step 9.5: Commit**

```bash
cd /Users/vitaliytv/www/nitra/cursor && git add npm/rules/k8s/k8s.mdc && git commit -m "docs(k8s.mdc): document HTTPRoute → NetworkPolicy GCLB ingress (v1.42)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: CHANGELOG + version bump у `npm/`

**Files:**

- Modify: `npm/CHANGELOG.md`
- Modify: `npm/package.json`

- [ ] **Step 10.1: Check current version**

```bash
cd /Users/vitaliytv/www/nitra/cursor && cat npm/package.json | grep '"version"'
```

Поточна версія — `1.25.3`. Це нова feature → bump до `1.26.0` (minor).

- [ ] **Step 10.2: Update `npm/package.json`**

Знайти у `npm/package.json` рядок 3 (`"version": "1.25.3",`) і замінити на `"version": "1.26.0",`.

- [ ] **Step 10.3: Update `npm/CHANGELOG.md`**

У `npm/CHANGELOG.md` після рядка `## [1.25.3] - 2026-05-26` додати **перед** ним новий запис:

```markdown
## [1.26.0] - 2026-05-26

### Added

- **`k8s/js/manifests.mjs`**: нова `collectHttpRouteIngressForWorkload(dir, appLabel, fail)` — визначає HTTPRoute → `-hl` Service → `selector.app` mapping і повертає унікальні TCP-порти з `backendRefs[].port` для workload з міткою `appLabel`. Викликається з `appendNetworkPolicyDocuments` і `regenerateLegacyNetworkPolicyDocsInFile` під час `check k8s`.
- **`k8s/js/manifests.mjs:buildNetworkPolicyYaml`**: опційний 4-й параметр `gclbPorts: number[]` — якщо непорожній, додає ingress-правило з `ipBlock` 35.191.0.0/16, 130.211.0.0/22, 10.0.0.0/8 і TCP-портами (відсортовано). Без параметра output байтово ідентичний baseline canon.
- **`k8s.mdc` v1.42**: новий розділ «HTTPRoute → NetworkPolicy ingress (GCLB + Envoy)» з описом mapping і прикладом NetworkPolicy для HTTPRoute-paired workload.

### Fixed

- **Service blocking via NetworkPolicy** для workload-ів, прив'язаних до `HTTPRoute` через GKE Gateway: попередній canon допускав тільки `podSelector: {}` ingress, що блокувало трафік від Envoy data-plane (`10.10.0.0/23` для `us-central1-proxy-only`) і Google health checks (`35.191.0.0/16`, `130.211.0.0/22`). Тепер правило автоматично додається.
```

- [ ] **Step 10.4: Verify через `check changelog`**

```bash
cd /Users/vitaliytv/www/nitra/cursor && npx @nitra/cursor check changelog 2>&1 | tail -10
```

Expected: PASS (немає помилок про відсутній bump чи розбіжність версій).

- [ ] **Step 10.5: Commit**

```bash
cd /Users/vitaliytv/www/nitra/cursor && git add npm/CHANGELOG.md npm/package.json && git commit -m "chore(release): bump 1.25.3 → 1.26.0, add CHANGELOG entry

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Full validation — lint + tests + check k8s on real workload

**Files:** (validation only, no source changes expected)

- [ ] **Step 11.1: Run full lint (sequential, no parallel)**

```bash
cd /Users/vitaliytv/www/nitra/cursor && bun run lint 2>&1 | tail -30
```

Expected: PASS (нульовий вихід без warnings).

Якщо є lint-помилки — виправити мінімально (за `n-fix` skill), commit окремим commit-ом.

- [ ] **Step 11.2: Run full test suite for npm workspace**

```bash
cd /Users/vitaliytv/www/nitra/cursor && bun test 2>&1 | tail -20
```

Expected: ALL PASS (zero failures, всі попередні тести + нові).

- [ ] **Step 11.3: Smoke-test через `npx @nitra/cursor check k8s` на тестовій фікстурі**

Створити мінімальний k8s-каталог поза репо:

```bash
TMP=$(mktemp -d)
mkdir -p "$TMP/k8s/base"
cat > "$TMP/k8s/base/kustomization.yaml" <<'EOF'
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: dev
resources:
  - deploy.yaml
  - hr.yaml
  - svc.yaml
  - svc-hl.yaml
EOF
cat > "$TMP/k8s/base/deploy.yaml" <<'EOF'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
  namespace: dev
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
          image: example/api:dev
          resources:
            requests:
              cpu: '0.02'
              memory: 128Mi
      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: kubernetes.io/hostname
          whenUnsatisfiable: ScheduleAnyway
          labelSelector:
            matchLabels:
              app: api
EOF
cat > "$TMP/k8s/base/svc.yaml" <<'EOF'
apiVersion: v1
kind: Service
metadata:
  name: api
  namespace: dev
spec:
  type: ClusterIP
  selector:
    app: api
  ports:
    - port: 8080
EOF
cat > "$TMP/k8s/base/svc-hl.yaml" <<'EOF'
apiVersion: v1
kind: Service
metadata:
  name: api-hl
  namespace: dev
spec:
  clusterIP: None
  selector:
    app: api
  ports:
    - port: 8080
EOF
cat > "$TMP/k8s/base/hr.yaml" <<'EOF'
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: api
  namespace: dev
spec:
  rules:
    - backendRefs:
        - name: api-hl
          port: 8080
EOF
cd "$TMP" && node /Users/vitaliytv/www/nitra/cursor/npm/bin/n-cursor.js check k8s 2>&1 | tail -30
echo "---"
cat "$TMP/k8s/base/networkpolicy.yaml"
```

Expected:

- `check k8s` створює `networkpolicy.yaml`.
- Згенерований NP містить ingress-блок з 3 ipBlock CIDR-ами і port 8080.

- [ ] **Step 11.4: Cleanup та commit (якщо були останні фікси)**

```bash
rm -rf "$TMP"
cd /Users/vitaliytv/www/nitra/cursor && git status
```

Якщо є untracked / modified — закоммітити окремим commit-ом з префіксом `fix(k8s):` або `test(k8s):`.

- [ ] **Step 11.5: Final summary**

Перевірити git log:

```bash
cd /Users/vitaliytv/www/nitra/cursor && git log --oneline -15
```

Має бути ~11 commit-ів від цього плану (один на task). Усі тести + lint зелені.

---

## Self-review checklist

- [x] Spec coverage:
  - `collectHttpRouteIngressForWorkload` → Tasks 1-4
  - `buildNetworkPolicyYaml` extension → Task 5
  - Integration з `appendNetworkPolicyDocuments` → Task 6
  - Integration з `regenerateLegacyNetworkPolicyDocsInFile` → Task 7
  - Negative-case test → Task 8
  - `k8s.mdc` docs → Task 9
  - CHANGELOG + version → Task 10
  - Full lint + tests + smoke → Task 11
- [x] No "TODO/TBD" placeholders у плані — scaffold у Step 1.3 повертає `null`, тіло замінюється повністю у Step 2.3.
- [x] Усі step-и мають конкретні команди та очікувані результати.
- [x] Type consistency: `gclbPorts: readonly number[]`, `ports: number[]`, `NETWORK_POLICY_GCLB_INGRESS_FROM: ReadonlyArray<{ ipBlock: { cidr: string } }>` — узгоджено між тасками.
- [x] Test naming consistent: `--test-name-pattern` фрагменти збігаються з рядками у `test('...')`.

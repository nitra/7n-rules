/**
 * Parity-гейт native-портів `k8s/hasura_configmap` і `k8s/hasura_httproute`
 * (`crates/rules-core/src/concerns/k8s_hasura_configmap.rs`,
 * `k8s_hasura_httproute.rs`) — прогін через **реальний** шлях диспатчу
 * (`runConcernDetector` → native-registry) на тих самих фікстурах, що покривали
 * видалений JS-канон (`tests/main.test.mjs` обох концернів до цього PR), плюс сценарій полагодженого дефекту гейта ConfigMap.
 *
 * Це end-to-end: реальні rego-полісі пакета (`hasura_configmap.rego`,
 * `hasura_httproute.rego`) і реальний `conftest`. Rust-тести концернів такого не покривають — вони
 * навмисно зупиняються на межі гейта (щоб не залежати від встановлених тулів),
 * тож саме тут доводиться, що зв'язка «native-гейт → native-conftest → rego»
 * дає ті самі violations, що давав JS.
 *
 * Без `conftest` у PATH прогін пропускається — та сама умова, що була в
 * JS-тестах.
 *
 * `N_RULES_PACKAGE_ROOT` виставляється явно: cwd фікстур — tmp-каталог поза
 * репо, тож каскад `rules_package::package_root` (node_modules/@7n/rules → npm/
 * вгору від cwd) там нічого не знайде. Це і є призначення override-змінної.
 */
import { beforeAll, describe, expect, test } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { env } from 'node:process'

import { runConcernDetector } from '../../../scripts/lib/lint-surface/detect.mjs'
import { resolveCmd } from '../../../scripts/utils/resolve-cmd.mjs'
import { withTmpDir } from '../../../scripts/utils/test-helpers.mjs'

const hasConftest = Boolean(resolveCmd('conftest'))

/** Цей файл: npm/rules/k8s/tests/… → корінь пакета `npm/` (4 dirname угору). */
const PACKAGE_ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))

const HASURA_DEPLOYMENT = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: db-h
  namespace: dev
spec:
  selector:
    matchLabels:
      app: db-h
  template:
    metadata:
      labels:
        app: db-h
    spec:
      containers:
        - name: h
          image: hasura/graphql-engine:v2.49.0
`

/** Звичайний (не-Hasura) Deployment — лексикографічно перший у своєму каталозі. */
const PLAIN_DEPLOYMENT = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: worker
  namespace: dev
spec:
  selector:
    matchLabels:
      app: worker
  template:
    metadata:
      labels:
        app: worker
    spec:
      containers:
        - name: worker
          image: myrepo/worker:1.0.0
`

const VALID_HASURA_CONFIGMAP = `apiVersion: v1
kind: ConfigMap
metadata:
  name: db-h
  namespace: dev
data:
  HASURA_GRAPHQL_ENABLE_REMOTE_SCHEMA_PERMISSIONS: "true"
  HASURA_GRAPHQL_ENABLE_RELAY: "false"
  HASURA_GRAPHQL_ENABLE_TELEMETRY: "false"
  HASURA_GRAPHQL_ENABLED_LOG_TYPES: "startup,http-log"
  HASURA_GRAPHQL_ENABLED_APIS: "metadata,graphql,pgdump"
  HASURA_GRAPHQL_DISABLE_EVENTING: "true"
`

/** Той самий ConfigMap без `HASURA_GRAPHQL_ENABLE_RELAY`. */
const BROKEN_HASURA_CONFIGMAP = VALID_HASURA_CONFIGMAP.replace('  HASURA_GRAPHQL_ENABLE_RELAY: "false"\n', '')

const CRONJOB_CONFIGMAP = `apiVersion: v1
kind: ConfigMap
metadata:
  name: assign-request
  namespace: dev
data:
  SOME_ENV: "1"
`

const PLAIN_CRONJOB = `apiVersion: batch/v1
kind: CronJob
metadata:
  name: assign-request
  namespace: dev
spec:
  schedule: "*/5 * * * *"
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: worker
              image: myrepo/assign-request:1.0.0
          restartPolicy: OnFailure
`

/** Канонічний Hasura HTTPRoute (4 правила, backend `db-h-hl`). */
const CANONICAL_HTTPROUTE = `apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: db-h
  namespace: dev
spec:
  rules:
    - matches:
        - path:
            type: Exact
            value: /ql
      filters:
        - type: RequestRedirect
          requestRedirect:
            path:
              type: ReplaceFullPath
              replaceFullPath: /ql/console
            statusCode: 302
    - matches:
        - path:
            type: Exact
            value: /ql/
      filters:
        - type: RequestRedirect
          requestRedirect:
            path:
              type: ReplaceFullPath
              replaceFullPath: /ql/console
            statusCode: 302
    - matches:
        - path:
            type: PathPrefix
            value: /ql
      filters:
        - type: URLRewrite
          urlRewrite:
            path:
              type: ReplacePrefixMatch
              replacePrefixMatch: /
      backendRefs:
        - name: db-h-hl
          port: 8080
    - matches:
        - path:
            type: PathPrefix
            value: /ql
          headers:
            - type: Exact
              name: Upgrade
              value: websocket
      filters:
        - type: URLRewrite
          urlRewrite:
            path:
              type: ReplacePrefixMatch
              replacePrefixMatch: /
        - type: RequestHeaderModifier
          requestHeaderModifier:
            remove: [Authorization]
      backendRefs:
        - name: db-h-hl
          port: 8080
`

/** Той самий канон без правила 2 (`/ql/` redirect) — має провалити rule2_missing. */
const BROKEN_HTTPROUTE = CANONICAL_HTTPROUTE.replace(
  `    - matches:
        - path:
            type: Exact
            value: /ql/
      filters:
        - type: RequestRedirect
          requestRedirect:
            path:
              type: ReplaceFullPath
              replaceFullPath: /ql/console
            statusCode: 302
`,
  ''
)

/** HTTPRoute звичайного сервісу — без пари з Hasura Deployment. */
const PLAIN_HTTPROUTE = `apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: web
  namespace: dev
spec:
  rules:
    - matches:
        - path:
            type: PathPrefix
            value: /
      backendRefs:
        - name: web
          port: 8080
`

/**
 * Пише набір файлів у каталог `dir` під коренем `root`.
 * @param {string} root корінь tmp-репо
 * @param {string[]} dirParts сегменти каталогу
 * @param {Record<string, string>} files мапа «ім'я файлу → вміст»
 * @returns {Promise<void>} результат
 */
async function seedDir(root, dirParts, files) {
  const dir = join(root, ...dirParts)
  await mkdir(dir, { recursive: true })
  for (const [name, body] of Object.entries(files)) {
    await writeFile(join(dir, name), body, 'utf8')
  }
}

/**
 * Прогін одного концерну кластера через реальний диспатч detector-а.
 * @param {string} concernId ім'я концерну (`hasura_configmap` / `hasura_httproute`)
 * @param {string} cwd корінь tmp-репо
 * @returns {Promise<import('../../../scripts/lib/lint-surface/types.mjs').LintResult>} результат
 */
function runConcern(concernId, cwd) {
  const dir = join(PACKAGE_ROOT, 'rules', 'k8s', concernId)
  return runConcernDetector({ name: concernId, dir }, { cwd, ruleId: 'k8s', concernId })
}

describe.skipIf(!hasConftest)('k8s/hasura_* — native-паритет із видаленим JS-каноном', () => {
  beforeAll(() => {
    env.N_RULES_PACKAGE_ROOT = PACKAGE_ROOT
  })

  test('hasura_configmap: CronJob ConfigMap без Hasura Deployment — 0 порушень', async () => {
    await withTmpDir(async root => {
      await seedDir(root, ['jobs', 'assign-request', 'k8s', 'base'], {
        'configmap.yaml': CRONJOB_CONFIGMAP,
        'cronjob.yaml': PLAIN_CRONJOB
      })
      const result = await runConcern('hasura_configmap', root)
      expect(result.violations).toEqual([])
    })
  })

  test('hasura_configmap: повний набір env поруч із Hasura Deployment — 0 порушень', async () => {
    await withTmpDir(async root => {
      await seedDir(root, ['k8s', 'base'], {
        'configmap.yaml': VALID_HASURA_CONFIGMAP,
        'deployment.yaml': HASURA_DEPLOYMENT
      })
      const result = await runConcern('hasura_configmap', root)
      expect(result.violations).toEqual([])
    })
  })

  test('hasura_configmap: бракує обов’язкового env — порушення з reason hasura-configmap-env', async () => {
    await withTmpDir(async root => {
      await seedDir(root, ['k8s', 'base'], {
        'configmap.yaml': BROKEN_HASURA_CONFIGMAP,
        'deployment.yaml': HASURA_DEPLOYMENT
      })
      const result = await runConcern('hasura_configmap', root)
      expect(result.violations.length).toBeGreaterThan(0)
      expect(result.violations[0].reason).toBe('hasura-configmap-env')
      expect(result.violations[0].file).toBe('k8s/base/configmap.yaml')
    })
  })

  /**
   * Полагоджений дефект канону (доккомент `concerns/k8s_hasura.rs`): у каталозі
   * два Deployment, і лексикографічно перший — НЕ Hasura. JS-гейт брав саме
   * перший (`findDeploymentDocInDir`) і мовчки пропускав перевірку; native-гейт
   * питає «чи є в каталозі хоч один Hasura-Deployment» і порушення бачить.
   */
  test('hasura_configmap: Hasura Deployment за іншим Deployment — порушення видно (fixed)', async () => {
    await withTmpDir(async root => {
      await seedDir(root, ['k8s', 'base'], {
        'configmap.yaml': BROKEN_HASURA_CONFIGMAP,
        'a-worker.yaml': PLAIN_DEPLOYMENT,
        'z-hasura.yaml': HASURA_DEPLOYMENT
      })
      const result = await runConcern('hasura_configmap', root)
      expect(result.violations.length).toBeGreaterThan(0)
      expect(result.violations[0].reason).toBe('hasura-configmap-env')
    })
  })

  test('hasura_httproute: HTTPRoute без Hasura Deployment — 0 порушень', async () => {
    await withTmpDir(async root => {
      await seedDir(root, ['k8s', 'base'], { 'hr.yaml': PLAIN_HTTPROUTE })
      const result = await runConcern('hasura_httproute', root)
      expect(result.violations).toEqual([])
    })
  })

  test('hasura_httproute: канонічний HTTPRoute поруч із Hasura Deployment — 0 порушень', async () => {
    await withTmpDir(async root => {
      await seedDir(root, ['k8s', 'base'], {
        'hr.yaml': CANONICAL_HTTPROUTE,
        'deployment.yaml': HASURA_DEPLOYMENT
      })
      const result = await runConcern('hasura_httproute', root)
      expect(result.violations).toEqual([])
    })
  })

  test('hasura_httproute: зламаний канон (без правила 2) — порушення', async () => {
    await withTmpDir(async root => {
      await seedDir(root, ['k8s', 'base'], {
        'hr.yaml': BROKEN_HTTPROUTE,
        'deployment.yaml': HASURA_DEPLOYMENT
      })
      const result = await runConcern('hasura_httproute', root)
      expect(result.violations.length).toBeGreaterThan(0)
      expect(result.violations[0].message).toContain('k8s/base/hr.yaml')
    })
  })

  /**
   * Прив'язка HTTPRoute↔Deployment — за `metadata.name`: той самий Hasura
   * Deployment, але HTTPRoute із чужим іменем не валідується взагалі, навіть
   * якщо його канон зламаний.
   */
  test('hasura_httproute: інший metadata.name — гейт закритий попри зламаний канон', async () => {
    await withTmpDir(async root => {
      await seedDir(root, ['k8s', 'base'], {
        'hr.yaml': BROKEN_HTTPROUTE.replace('name: db-h', 'name: other'),
        'deployment.yaml': HASURA_DEPLOYMENT
      })
      const result = await runConcern('hasura_httproute', root)
      expect(result.violations).toEqual([])
    })
  })
})

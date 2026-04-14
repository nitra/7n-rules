/**
 * Перевіряє Kubernetes YAML у шляхах з сегментом `k8s` (див. k8s.mdc).
 *
 * Перший рядок `# yaml-language-server: $schema=…`, без дублікатів, розширення `.yaml`
 * (окрім `kustomization.yaml`); URL схеми за першим документом — kustomization / yannh / datree
 * (**виняток:** `apiVersion: alb.yc.io/v1alpha1`, `kind: HttpBackendGroup` — рядка `# yaml-language-server:` у файлі бути не має).
 * (datree за замовчуванням: GitHub Pages `https://datreeio.github.io/CRDs-catalog/…`).
 *
 * Додатково: у кожному YAML-документі з **`kind: Deployment`** у кожного контейнера
 * **`spec.template.spec.containers[]`** має бути ключ **`resources`** (значення — об’єкт, допускається
 * порожній **`{}`**). Поле **`imagePullPolicy`** не перевіряється — діють типові правила Kubernetes
 * (`:latest` або коли тег не вказано → **Always**, інші теги → **IfNotPresent**). Якщо серед **`containers`** /
 * **`initContainers`** є образ **`hasura/graphql-engine`**, дозволено лише пін **`HASURA_GRAPHQL_ENGINE_IMAGE`**
 * (див. k8s.mdc).
 *
 * **Namespace і Kustomize:** YAML у **`…/k8s/base/`** (окрім імені **`kustomization.yaml`**)
 * завжди має **непорожній** **`metadata.namespace`** у відповідних документах (узгоджено з dev у репозиторії),
 * навіть якщо **`namespace:`** заданий у **`base/kustomization.yaml`**.
 * Поза **`k8s/base`**: для файлів, досяжних з kustomization через **`resources`**, **`bases`**, **`components`**,
 * **`crds`**, **`patches[].path`**, **`patchesStrategicMerge`**, **`metadata.namespace`** у маніфесті **не** додають;
 * файли **поза** цим графом — **непорожній** **`metadata.namespace`** (крім **кластерних** kind; див. k8s.mdc).
 *
 * **`kind: Ingress`** заборонено (потрібен перехід на Gateway API).
 *
 * Файли під **`k8s`**, де всі YAML-документи — лише **`kind: BackendConfig`**, **видаляються** автоматично.
 * Якщо **BackendConfig** змішано з іншими ресурсами в одному файлі — перевірка завершується помилкою (розділи маніфести).
 *
 * У **`kind: Service`** у **`metadata.annotations`** не повинно бути ключів **`cloud.google.com/neg`**
 * та **`cloud.google.com/backend-config`** (див. k8s.mdc).
 *
 * Файли **`svc.yaml`** / **`svc-hl.yaml`** у **одному каталозі** (див. k8s.mdc): для кожного **`svc.yaml`**
 * поруч обов’язковий **`svc-hl.yaml`** (headless-копія: той самий селектор/порти, **`metadata.name`** з суфіксом **`-hl`**,
 * **`spec.clusterIP: None`**). У **`svc.yaml`** кожен **Service** має **`spec.type: ClusterIP`**. У **`svc-hl.yaml`**
 * кожен **Service** — **`spec.clusterIP: None`** та ім’я на **`-hl`**. У маршрутах **Gateway API**
 * (**`HTTPRoute`**, **`GRPCRoute`**, **`TCPRoute`**, **`TLSRoute`**, **`UDPRoute`**, група **`gateway.networking.k8s.io`**)
 * посилання **`backendRefs` / `backendRef`** на **Service** мають вказувати лише сервіси з суфіксом **`-hl`** у **`name`**.
 * **HealthCheckPolicy** (**`networking.gke.io/v1`**, GKE): **`spec.targetRef`** на **Service** — **`name`** з суфіксом **`-hl`** (див. k8s.mdc).
 * Якщо **`kustomization.yaml`** посилається на **`svc.yaml`** (**`resources`**, **`bases`**, **`components`**, **`crds`**,
 * **`patches[].path`**, **`patchesStrategicMerge`**), у **тому ж** файлі має бути посилання на відповідний **`svc-hl.yaml`**
 * в **тому ж каталозі**, що й **`svc.yaml`** (логіка збігається з **`pathsFromKustomizationObject`**).
 *
 * Структура **Kustomize** (див. k8s.mdc): заборона шляхів **`…/k8s/dev/…`**; у **`k8s/base/kustomization.yaml`**
 * завжди має бути непорожнє поле **`namespace:`** (перевірка, якщо файл існує).
 *
 * **Inline JSON6902** у **`patches`** (і зовнішні файли з **`patches[].path`** під **`k8s`**, якщо вміст — масив JSON Patch): не допускається пара **`remove`** і **`add`**
 * на один і той самий **`path`** у межах одного фрагмента — потрібен **`op: replace`** (k8s.mdc). **check-k8s** це перевіряє.
 *
 * Явні винятки до загальної логіки yannh/datree — таблиця **`EXPLICIT_K8S_SCHEMAS`** (`Map`): ключ
 * **`apiVersion`, `kind`, `type`** (для CRD без поля `type` у маніфесті — зірочка **`*`** як третій
 * компонент). Спочатку шукається збіг за фактичним `type`, потім за **`*`**.
 * Dockerfile — правило docker.mdc, скрипт check-docker.mjs.
 *
 * Структура **`HTTPRoute`** для **Deployment** з образом **`hasura/graphql-engine`** (редиректи **`/ql`**, **WebSocket**, **`URLRewrite`**) — лише в **k8s.mdc**, автоматично не звіряється.
 */
import { existsSync } from 'node:fs'
import { readFile, stat, unlink } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'

import { parseAllDocuments } from 'yaml'

import { createCheckReporter } from './utils/check-reporter.mjs'
import { walkDir } from './utils/walkDir.mjs'

/** Версія набору схем yannh — узгоджено з k8s.mdc */
const YANNH_PIN = 'v1.33.9-standalone-strict'

/**
 * Дозволений образ **hasura/graphql-engine** у Deployment (узгоджено з k8s.mdc).
 * Еквівалент **`docker.io/…`** також приймається.
 */
export const HASURA_GRAPHQL_ENGINE_IMAGE = 'hasura/graphql-engine:v2.48.15.ubi.amd64'

/** Набір прийнятних рядків `image` без digest (`@sha256:…`). */
const HASURA_GRAPHQL_ENGINE_ALLOWED_IMAGES = new Set([
  HASURA_GRAPHQL_ENGINE_IMAGE,
  `docker.io/${HASURA_GRAPHQL_ENGINE_IMAGE}`
])

/**
 * Ключі анотацій GKE (NEG / BackendConfig) у **Service** — заборонені (узгоджено з k8s.mdc).
 * @type {readonly string[]}
 */
export const SERVICE_FORBIDDEN_GCP_ANNOTATION_KEYS = Object.freeze([
  'cloud.google.com/neg',
  'cloud.google.com/backend-config'
])

/** Гілка репозиторію yannh/kubernetes-json-schema для raw.githubusercontent.com (каталог набору в URL одразу після ref). */
const YANNH_REF = 'master'

const KUSTOMIZATION_SCHEMA = 'https://json.schemastore.org/kustomization.json'

const YANNH_BASE = `https://raw.githubusercontent.com/yannh/kubernetes-json-schema/${YANNH_REF}/${YANNH_PIN}/`

/** Публікація [CRDs-catalog](https://github.com/datreeio/CRDs-catalog) на GitHub Pages (те саме дерево, що й raw на `main`). */
const DATREE_CRD_BASE = 'https://datreeio.github.io/CRDs-catalog/'

/** Raw URL для окремих CRD, де в редакторі канон — `raw.githubusercontent.com` (див. k8s.mdc). */
const DATREE_CRD_RAW_REF = 'main'

const DATREE_CRD_RAW_BASE = `https://raw.githubusercontent.com/datreeio/CRDs-catalog/${DATREE_CRD_RAW_REF}/`

/** У ключі `Map` означає «будь-який / відсутній `type`» (наприклад CRD без кореневого `type:`). */
const K8S_EXPLICIT_SCHEMA_TYPE_ANY = '*'

/**
 * Ключ запису в **`EXPLICIT_K8S_SCHEMAS`**: `apiVersion`, **`kind` як у YAML** (регістр як у маніфесті),
 * `typeKey` — значення поля **`type:`** або **`K8S_EXPLICIT_SCHEMA_TYPE_ANY`**.
 * @param {string} apiVersion повне значення `apiVersion` з маніфесту
 * @param {string} kind значення `kind` з маніфесту (як у YAML)
 * @param {string} typeKey значення кореневого `type:` або `K8S_EXPLICIT_SCHEMA_TYPE_ANY`
 * @returns {string} внутрішній ключ для `Map`
 */
function k8sExplicitSchemaMapKey(apiVersion, kind, typeKey) {
  return `${apiVersion}\0${kind}\0${typeKey}`
}

/**
 * Таблиця явних `$schema` для поєднань **`apiVersion` + `kind` + `type`** (див. k8s.mdc).
 * Щоб додати рядок: визнач **`apiVersion`**, **`kind`**, при потребі **`type`**, вкажи **URL** і **reason**.
 * @type {Map<string, { schema: string, reason: string }>}
 */
const EXPLICIT_K8S_SCHEMAS = new Map([
  [
    k8sExplicitSchemaMapKey('secrets.infisical.com/v1alpha1', 'InfisicalSecret', K8S_EXPLICIT_SCHEMA_TYPE_ANY),
    {
      schema: `${DATREE_CRD_RAW_BASE}secrets.infisical.com/infisicalsecret_v1alpha1.json`,
      reason: 'InfisicalSecret v1alpha1 (явна таблиця схем, datree CRDs-catalog raw)'
    }
  ],
  [
    k8sExplicitSchemaMapKey('v1', 'Secret', 'kubernetes.io/basic-auth'),
    {
      schema: `${YANNH_BASE}secret-v1.json`,
      reason: 'Secret type kubernetes.io/basic-auth (явна таблиця схем, yannh secret-v1.json)'
    }
  ]
])

/**
 * Витягує кореневе поле **`type:`** з документа (без повного YAML-парсера).
 * @param {string} doc фрагмент YAML одного документа
 * @returns {string | undefined} значення без лапок або undefined, якщо поля немає
 */
function extractTopLevelManifestType(doc) {
  const m = doc.match(/^\s*type:\s*(\S+)\s*$/mu)
  const raw = m?.[1]?.replaceAll(/^["']|["']$/gu, '')
  return raw === undefined || raw === '' ? undefined : raw
}

/**
 * Шукає схему в **`EXPLICIT_K8S_SCHEMAS`**: спочатку за точним **`type`**, потім за **`*`**.
 * @param {string} apiVersion повне значення `apiVersion` з маніфесту
 * @param {string} kind значення `kind` з маніфесту (як у YAML)
 * @param {string | undefined} manifestType кореневе поле `type` або undefined, якщо відсутнє
 * @returns {{ schema: string, reason: string } | null} запис таблиці або null, якщо збігу немає
 */
function lookupExplicitK8sSchema(apiVersion, kind, manifestType) {
  if (manifestType !== undefined) {
    const exact = EXPLICIT_K8S_SCHEMAS.get(k8sExplicitSchemaMapKey(apiVersion, kind, manifestType))
    if (exact) return exact
  }
  return EXPLICIT_K8S_SCHEMAS.get(k8sExplicitSchemaMapKey(apiVersion, kind, K8S_EXPLICIT_SCHEMA_TYPE_ANY)) ?? null
}

/**
 * Групи API Kubernetes, для яких у перевірці очікується схема yannh (не datree CRD catalog).
 * `gateway.networking.k8s.io` та інші розширення поза цим списком — datree.
 */
const YANNH_GROUPS = new Set([
  'admissionregistration.k8s.io',
  'apiextensions.k8s.io',
  'apiregistration.k8s.io',
  'apps',
  'authentication.k8s.io',
  'authorization.k8s.io',
  'autoscaling',
  'batch',
  'certificates.k8s.io',
  'coordination.k8s.io',
  'discovery.k8s.io',
  'events.k8s.io',
  'flowcontrol.apiserver.k8s.io',
  'internal.apiserver.k8s.io',
  'networking.k8s.io',
  'node.k8s.io',
  'policy',
  'rbac.authorization.k8s.io',
  'resource.k8s.io',
  'scheduling.k8s.io',
  'storage.k8s.io',
  'storagemigration.k8s.io'
])

const MODELINE_RE = /^#\s*yaml-language-server:\s*\$schema=(\S+)\s*$/

/**
 * Чи містить шлях сегмент директорії `k8s` (рівно ця назва компонента).
 * @param {string} filePath шлях до файлу
 * @returns {boolean} true, якщо серед компонентів шляху є каталог `k8s`
 */
export function pathHasK8sSegment(filePath) {
  const parts = filePath.split(/[/\\]/u)
  return parts.includes('k8s')
}

/**
 * Чи заборонений шлях з окремою директорією **`dev`** під **`k8s`** (джерело правди — **`base`**).
 * @param {string} rel шлях від кореня репозиторію
 * @returns {boolean} true для `…/k8s/dev/…`
 */
export function isForbiddenK8sDevPath(rel) {
  const n = rel.replaceAll('\\', '/')
  return n.includes('/k8s/dev/')
}

/**
 * Відносний шлях від кореня репозиторію у вигляді з `/` (для множини kustomize).
 * @param {string} root корінь cwd
 * @param {string} abs абсолютний шлях
 * @returns {string | null} posix-відносний шлях або null, якщо поза root
 */
function posixRelFromAbs(root, abs) {
  const r = (relative(root, abs) || abs).replaceAll('\\', '/')
  if (r.startsWith('..')) return null
  return r
}

/**
 * Вбудовані та поширені **кластерні** `kind`, для яких **`metadata.namespace`** не застосовується.
 * CRD з невідомим kind лишаються з вимогою namespace, якщо файл не в kustomization — за потреби додай path у `resources`.
 * @type {Set<string>}
 */
const CLUSTER_SCOPED_KINDS = new Set([
  'APIService',
  'CertificateSigningRequest',
  'ClusterCIDR',
  'ClusterRole',
  'ClusterRoleBinding',
  'ComponentStatus',
  'CSIDriver',
  'CSINode',
  'CustomResourceDefinition',
  'FlowSchema',
  'IPAddress',
  'IngressClass',
  'MutatingWebhookConfiguration',
  'Namespace',
  'Node',
  'PersistentVolume',
  'PriorityClass',
  'PriorityLevelConfiguration',
  'RuntimeClass',
  'ServiceCIDR',
  'StorageClass',
  'StorageVersionMigration',
  'ValidatingAdmissionPolicy',
  'ValidatingAdmissionPolicyBinding',
  'ValidatingWebhookConfiguration',
  'VolumeAttachment'
])

/**
 * Чи `kind` за замовчуванням **кластерний** (без namespace у маніфесті).
 * @param {string} kind значення `kind`
 * @returns {boolean} true для кластерних built-in / поширених API
 */
export function isClusterScopedKubernetesKind(kind) {
  return typeof kind === 'string' && kind !== '' && CLUSTER_SCOPED_KINDS.has(kind)
}

/**
 * Додає рядки шляхів з поля-масиву kustomization.
 * @param {unknown} arr значення з YAML
 * @param {string[]} acc накопичувач
 */
function pushStringPaths(arr, acc) {
  if (!Array.isArray(arr)) return
  for (const item of arr) {
    if (typeof item === 'string' && item.trim() !== '') acc.push(item.trim())
  }
}

/**
 * Шляхи з полів Kustomization для resolve відносно каталогу **`kustomization.yaml`**.
 * @param {unknown} obj корінь першого документа Kustomization
 * @returns {string[]} відносні або абсолютні посилання з маніфесту
 */
function pathsFromKustomizationObject(obj) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return []
  const rec = /** @type {Record<string, unknown>} */ (obj)
  /** @type {string[]} */
  const out = []
  pushStringPaths(rec.resources, out)
  pushStringPaths(rec.bases, out)
  pushStringPaths(rec.components, out)
  pushStringPaths(rec.crds, out)
  pushStringPaths(rec.patchesStrategicMerge, out)
  const patches = rec.patches
  if (Array.isArray(patches)) {
    for (const p of patches) {
      if (
        p !== null &&
        typeof p === 'object' &&
        !Array.isArray(p) &&
        typeof p.path === 'string' &&
        p.path.trim() !== ''
      ) {
        out.push(p.path.trim())
      }
    }
  }
  return out
}

/**
 * Чи для кожного посилання kustomization на файл **`svc.yaml`** у списку є посилання на sibling **`svc-hl.yaml`**
 * (той самий каталог після **`resolve`** відносно каталогу **`kustomization.yaml`**).
 * @param {string} kustomizationDir абсолютний шлях до каталогу з **`kustomization.yaml`**
 * @param {string[]} pathRefs рядки з **`pathsFromKustomizationObject`**
 * @returns {string | null} текст порушення або null, якщо ок
 */
export function kustomizationSvcYamlMissingSvcHlViolation(kustomizationDir, pathRefs) {
  /** @type {Set<string>} */
  const resolved = new Set()
  for (const ref of pathRefs) {
    if (typeof ref === 'string' && !ref.includes('://')) {
      resolved.add(resolve(kustomizationDir, ref))
    }
  }
  for (const ref of pathRefs) {
    if (typeof ref === 'string' && !ref.includes('://')) {
      const abs = resolve(kustomizationDir, ref)
      if (basename(abs).toLowerCase() === 'svc.yaml') {
        const hlAbs = resolve(dirname(abs), 'svc-hl.yaml')
        if (!resolved.has(hlAbs)) {
          return `kustomization посилається на «${ref}» — додай у тому ж kustomization.yaml посилання на відповідний svc-hl.yaml (очікуваний шлях поруч, наприклад той самий префікс каталогу + svc-hl.yaml; див. k8s.mdc)`
        }
      }
    }
  }
  return null
}

/**
 * Перевіряє всі **`kustomization.yaml`** під **`k8s`**: разом із **`svc.yaml`** має бути **`svc-hl.yaml`** у полях шляхів.
 * @param {string} root корінь репозиторію
 * @param {string[]} yamlFiles абсолютні шляхи до yaml під k8s
 * @param {(msg: string) => void} fail callback помилки
 * @returns {Promise<void>}
 */
async function validateKustomizationIncludesSvcHlWithSvc(root, yamlFiles, fail) {
  for (const kustAbs of yamlFiles) {
    if (basename(kustAbs).toLowerCase() === 'kustomization.yaml') {
      const rel = (relative(root, kustAbs) || kustAbs).replaceAll('\\', '/')
      let raw
      try {
        raw = await readFile(kustAbs, 'utf8')
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        fail(`${rel}: не вдалося прочитати для перевірки svc.yaml/svc-hl.yaml у kustomization (${msg})`)
      }
      if (raw !== undefined) {
        const lines = toLines(raw)
        const body = yamlBodyAfterModeline(lines)
        /** @type {import('yaml').Document[] | undefined} */
        let docs
        try {
          docs = parseAllDocuments(body)
        } catch {
          fail(`${rel}: не вдалося розпарсити YAML для перевірки svc.yaml/svc-hl.yaml у kustomization (див. k8s.mdc)`)
        }
        if (docs !== undefined) {
          const first = docs[0]?.toJSON()
          if (first !== null && first !== undefined && typeof first === 'object' && !Array.isArray(first)) {
            const pathRefs = pathsFromKustomizationObject(first)
            const kustDir = dirname(kustAbs)
            const v = kustomizationSvcYamlMissingSvcHlViolation(kustDir, pathRefs)
            if (v !== null) {
              fail(`${rel}: ${v}`)
            }
          }
        }
      }
    }
  }
}

/**
 * Збирає відносні шляхи (posix) до YAML, підключених до Kustomize з будь-якого **`kustomization.yaml`** під `k8s`.
 * Обходить **`resources`**, **`bases`**, **`components`**, **`crds`**, **`patches[].path`**, **`patchesStrategicMerge`**;
 * для каталогу з **`kustomization.yaml`** виконує рекурсивний обхід.
 * @param {string} root корінь репозиторію
 * @param {string[]} yamlFilesAbs відсортовані абсолютні шляхи до `*.yaml` / `*.yml` під k8s (для `.yml` check-k8s вимагає перейменувати на `.yaml`)
 * @returns {Promise<Set<string>>} множина відносних шляхів до керованих файлів
 */
export async function collectKustomizeManagedRelPaths(root, yamlFilesAbs) {
  /** @type {Set<string>} */
  const managed = new Set()
  const kustomizationAbsList = yamlFilesAbs.filter(abs => {
    const b = basename(abs).toLowerCase()
    return b === 'kustomization.yaml'
  })

  /** @type {Set<string>} */
  const visitedKustomization = new Set()

  /**
   * @param {string} kustAbs абсолютний шлях до kustomization.yaml
   * @returns {Promise<void>}
   */
  async function walkKustomization(kustAbs) {
    const normKust = resolve(kustAbs)
    if (visitedKustomization.has(normKust)) return
    visitedKustomization.add(normKust)

    let raw
    try {
      raw = await readFile(normKust, 'utf8')
    } catch {
      return
    }
    const lines = toLines(raw)
    const body = yamlBodyAfterModeline(lines)

    /** @type {import('yaml').Document[] | undefined} */
    let docs
    try {
      docs = parseAllDocuments(body)
    } catch {
      return
    }
    const first = docs[0]?.toJSON()
    if (first === null || first === undefined || typeof first !== 'object' || Array.isArray(first)) return

    const kustDir = dirname(normKust)
    const pathRefs = pathsFromKustomizationObject(first)

    for (const ref of pathRefs) {
      if (!ref.includes('://')) {
        const resolved = resolve(kustDir, ref)
        let st
        try {
          st = await stat(resolved)
        } catch {
          st = undefined
        }
        if (st) {
          if (st.isFile()) {
            if (/\.ya?ml$/iu.test(resolved)) {
              const pr = posixRelFromAbs(root, resolved)
              if (pr !== null) managed.add(pr)
            }
          } else if (st.isDirectory()) {
            const childK = existsSync(join(resolved, 'kustomization.yaml'))
              ? join(resolved, 'kustomization.yaml')
              : null
            if (childK !== null) {
              await walkKustomization(childK)
            }
          }
        }
      }
    }
  }

  for (const k of kustomizationAbsList) {
    await walkKustomization(k)
  }

  return managed
}

/**
 * Чи це **`k8s/base/kustomization.yaml`** (перевірка обов’язкового непорожнього **`namespace:`**).
 * @param {string} rel шлях від кореня репозиторію
 * @returns {boolean} true для шляху виду `…/k8s/base/kustomization.yaml`
 */
export function isBaseKustomizationPath(rel) {
  const n = rel.replaceAll('\\', '/')
  return /(^|\/)k8s\/base\/kustomization\.yaml$/u.test(n)
}

/**
 * Чи є в Kustomization для **`base`** завжди обов’язкове непорожнє поле **`namespace:`** (k8s.mdc).
 * @param {unknown} obj перший документ YAML
 * @returns {string | null} текст порушення або null, якщо ок
 */
export function baseKustomizationNamespaceViolation(obj) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    return 'у base/kustomization.yaml завжди має бути непорожній namespace: (див. k8s.mdc)'
  }
  const rec = /** @type {Record<string, unknown>} */ (obj)
  const ns = rec.namespace
  if (typeof ns === 'string' && ns.trim() !== '') {
    return null
  }
  return 'у base/kustomization.yaml завжди додай непорожній namespace: (наприклад namespace: dev; див. k8s.mdc)'
}

/**
 * Збирає всі `*.yaml` та `*.yml` під деревом від кореня cwd, якщо шлях містить сегмент `k8s` (для `.yml` далі — помилка перейменування).
 * @param {string} root корінь репозиторію (cwd)
 * @returns {Promise<string[]>} відсортовані абсолютні шляхи до файлів
 */
async function findK8sYamlFiles(root) {
  /** @type {string[]} */
  const out = []
  await walkDir(root, p => {
    if (!pathHasK8sSegment(p)) return
    if (!/\.ya?ml$/iu.test(p)) return
    out.push(p)
  })
   
  return out.toSorted((a, b) => a.localeCompare(b))
}

/**
 * Тіло YAML для політик (Ingress, BackendConfig тощо): якщо перший рядок — modeline `$schema`, береться вміст після нього.
 * @param {string[]} lines рядки файлу
 * @returns {string} фрагмент для `parseAllDocuments`
 */
function k8sYamlBodyForDocumentParse(lines) {
  if (lines.length > 0 && MODELINE_RE.test(lines[0])) {
    return yamlBodyAfterModeline(lines)
  }
  return lines.join('\n')
}

/**
 * Чи всі нетривіальні документи у тілі — **`kind: BackendConfig`**, чи є змішування з іншими kind.
 * @param {string} body YAML без обов’язкового modeline (див. `k8sYamlBodyForDocumentParse`)
 * @returns {'none' | 'only' | 'mixed' | 'unparsed'} unparsed — не вдалося розпарсити YAML
 */
export function classifyBackendConfigManifestPresence(body) {
  /** @type {import('yaml').Document[]} */
  let docs
  try {
    docs = parseAllDocuments(body)
  } catch {
    return 'unparsed'
  }

  let hasBc = false
  let hasOther = false
  for (const doc of docs) {
    if (doc.errors.length === 0) {
      const obj = doc.toJSON()
      if (obj !== null && typeof obj === 'object' && !Array.isArray(obj)) {
        const kind = obj.kind
        if (kind === 'BackendConfig') {
          hasBc = true
        } else if (kind !== undefined && kind !== null && String(kind).trim() !== '') {
          hasOther = true
        }
      }
    }
  }

  if (!hasBc) return 'none'
  if (hasOther) return 'mixed'
  return 'only'
}

/**
 * Видаляє під **`k8s`** YAML-файли, що містять **лише** ресурси **BackendConfig**; змішані файли — `fail`.
 * @param {string} root корінь репозиторію
 * @param {(msg: string) => void} fail реєстрація порушення
 * @param {(msg: string) => void} pass реєстрація успіху
 * @returns {Promise<void>}
 */
async function removeBackendConfigOnlyK8sYamlFiles(root, fail, pass) {
  const yamlFiles = await findK8sYamlFiles(root)
  for (const abs of yamlFiles) {
    const rel = (relative(root, abs) || abs).replaceAll('\\', '/')
    try {
      const raw = await readFile(abs, 'utf8')
      const lines = toLines(raw)
      const body = k8sYamlBodyForDocumentParse(lines)
      const bcPresence = classifyBackendConfigManifestPresence(body)

      if (bcPresence === 'mixed') {
        fail(
          `${rel}: у файлі разом BackendConfig та інші kind — винеси BackendConfig окремо або прибери вручну; автоматичне видалення не застосовується (див. k8s.mdc)`
        )
      } else if (bcPresence === 'only') {
        try {
          await unlink(abs)
          pass(`${rel}: видалено (лише kind: BackendConfig; див. k8s.mdc)`)
        } catch (error) {
          fail(`${rel}: не вдалося видалити BackendConfig-файл (${error.message})`)
        }
      }
    } catch (error) {
      fail(`${rel}: не вдалося прочитати для перевірки BackendConfig (${error.message})`)
    }
  }
}

/**
 * Прибирає BOM і ділить на рядки.
 * @param {string} content вміст файлу
 * @returns {string[]} рядки без BOM на початку
 */
function toLines(content) {
  const body = content.startsWith('\uFEFF') ? content.slice(1) : content
  return body.split(/\r?\n/u)
}

/**
 * Вміст після першого рядка (modeline), без провідних порожніх рядків.
 * @param {string[]} lines рядки файлу
 * @returns {string} тіло для парсингу першого YAML-документа
 */
function yamlBodyAfterModeline(lines) {
  let i = 1
  while (i < lines.length && lines[i].trim() === '') i++
  return lines.slice(i).join('\n')
}

/**
 * Читає k8s YAML і повертає фрагмент після modeline `$schema`, якщо перший рядок — modeline.
 * Потрібно для парної перевірки **`svc.yaml`** / **`svc-hl.yaml`**.
 * @param {string} abs абсолютний шлях до файлу
 * @returns {Promise<string>} тіло для `parseAllDocuments`
 */
async function readK8sYamlBodyAfterModelineForSvcPair(abs) {
  const raw = await readFile(abs, 'utf8')
  const lines = toLines(raw)
  if (lines.length > 0 && MODELINE_RE.test(lines[0])) {
    return yamlBodyAfterModeline(lines)
  }
  return lines.join('\n')
}

/**
 * Розбирає YAML на корені документів (ігнорує зламані документи).
 * @param {string} body фрагмент YAML
 * @returns {unknown[]} масив успішно розібраних коренів YAML-документів
 */
function parseK8sYamlDocumentObjectRoots(body) {
  try {
    return parseAllDocuments(body)
      .filter(d => d.errors.length === 0)
      .map(d => d.toJSON())
      .filter(x => x !== null && x !== undefined && typeof x === 'object' && !Array.isArray(x))
  } catch {
    return []
  }
}

/**
 * Перший YAML-документ (до наступного `---` на окремому рядку).
 * @param {string} body фрагмент YAML
 * @returns {string} перший документ без зайвих пробілів по краях
 */
function firstYamlDocument(body) {
  const parts = body.split(/^---\s*$/mu)
  return (parts[0] ?? body).trim()
}

/**
 * Витягує `apiVersion` та `kind` з тексту документа (без повного YAML-парсера).
 * @param {string} doc фрагмент YAML одного документа
 * @returns {{ apiVersion?: string, kind?: string }} знайдені поля або властивості відсутні
 */
function extractApiVersionAndKind(doc) {
  const av = doc.match(/^\s*apiVersion:\s*(\S+)\s*$/mu)
  const k = doc.match(/^\s*kind:\s*(\S+)\s*$/mu)
  return {
    apiVersion: av?.[1]?.replaceAll(/^["']|["']$/gu, ''),
    kind: k?.[1]?.replaceAll(/^["']|["']$/gu, '')
  }
}

/**
 * Чи перший YAML-документ (до `---`) — **HttpBackendGroup** з API **alb.yc.io/v1alpha1** (Yandex ALB).
 * Для таких файлів **check-k8s** не вимагає modeline `# yaml-language-server: $schema=…` і забороняє його.
 * @param {string} yamlBody вміст файлу або фрагмент після modeline
 * @returns {boolean} true, якщо `apiVersion`/`kind` першого документа збігаються з винятком
 */
export function k8sYamlFirstDocIsAlbYcHttpBackendGroup(yamlBody) {
  const first = firstYamlDocument(yamlBody)
  const { apiVersion, kind } = extractApiVersionAndKind(first)
  return apiVersion === 'alb.yc.io/v1alpha1' && kind === 'HttpBackendGroup'
}

/**
 * Чи вміст overlay **`ru/kustomization.yaml`** містить Kustomize patch видалення **HealthCheckPolicy**.
 * @param {string} raw повний текст файлу
 * @returns {boolean} true, якщо є `$patch: delete` і блоки kind/metadata для HealthCheckPolicy
 */
export function ruKustomizationHasHealthCheckDeletePatch(raw) {
  if (!/\$patch:\s*delete/u.test(raw)) return false
  if (!/kind:\s*HealthCheckPolicy/u.test(raw)) return false
  if (!/metadata:/u.test(raw)) return false
  if (!/name:\s*\S+/u.test(raw)) return false
  return true
}

/**
 * Чи абсолютний шлях лежить усередині кореня репозиторію (без виходу через `..`).
 * @param {string} rootAbs абсолютний корінь
 * @param {string} fileAbs абсолютний шлях до файлу
 * @returns {boolean} true, якщо `fileAbs` усередині `rootAbs`
 */
function resolvedFilePathIsUnderRoot(rootAbs, fileAbs) {
  const r = resolve(rootAbs)
  const f = resolve(fileAbs)
  const rel = relative(r, f).replaceAll('\\', '/')
  if (rel === '') {
    return true
  }
  return !rel.startsWith('../') && rel !== '..'
}

/**
 * Нормалізує **`path`** з операції JSON Patch (RFC 6902).
 * @param {string} p значення поля **path**
 * @returns {string} обрізаний рядок
 */
function normalizeJsonPatchPath(p) {
  return typeof p === 'string' ? p.trim() : ''
}

/**
 * Витягує пари **op** / **path** з масиву операцій JSON6902.
 * @param {unknown[]} arr корінь-масив з YAML/JSON
 * @returns {Array<{ op: string, path: string }>} **op** у нижньому регістрі
 */
function extractJson6902OpsFromArray(arr) {
  /** @type {Array<{ op: string, path: string }>} */
  const out = []
  for (const item of arr) {
    if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
      const rec = /** @type {Record<string, unknown>} */ (item)
      const op = rec.op
      const path = rec.path
      if (typeof op === 'string' && typeof path === 'string') {
        const p = normalizeJsonPatchPath(path)
        if (p !== '') {
          out.push({ op: op.trim().toLowerCase(), path: p })
        }
      }
    }
  }
  return out
}

/**
 * Витягує операції JSON6902 з тексту inline **patch** або окремого файлу patch (YAML-масив або JSON-масив).
 * Інший вміст (strategic merge, `$patch: delete` тощо) дає порожній масив.
 * @param {string} patchText вміст поля **patch** або файлу
 * @returns {Array<{ op: string, path: string }>} нормалізовані **op** / **path** або порожній масив, якщо не JSON6902-масив
 */
export function collectJson6902OperationsFromPatchText(patchText) {
  const t = typeof patchText === 'string' ? patchText.trim() : ''
  if (t === '') {
    return []
  }
  try {
    const docs = parseAllDocuments(t)
    for (const d of docs) {
      if (d.errors.length === 0) {
        const j = d.toJSON()
        if (Array.isArray(j)) {
          return extractJson6902OpsFromArray(j)
        }
      }
    }
  } catch {
    /* пробуємо JSON */
  }
  if (t.startsWith('[')) {
    try {
      const j = JSON.parse(t)
      if (Array.isArray(j)) {
        return extractJson6902OpsFromArray(j)
      }
    } catch {
      /* ignore */
    }
  }
  return []
}

/**
 * Шляхи JSON Patch, де в одному наборі операцій є і **remove**, і **add** (k8s.mdc: краще **replace**).
 * @param {Array<{ op: string, path: string }>} ops нормалізовані **op**
 * @returns {string[]} унікальні **path** з порушенням (відсортовано)
 */
export function json6902PathsWithRemoveAndAddOnSamePath(ops) {
  /** @type {Map<string, Set<string>>} */
  const byPath = new Map()
  for (const { op, path } of ops) {
    if (path) {
      if (!byPath.has(path)) {
        byPath.set(path, new Set())
      }
      byPath.get(path).add(op)
    }
  }
  /** @type {string[]} */
  const out = []
  for (const [path, set] of byPath) {
    if (set.has('remove') && set.has('add')) {
      out.push(path)
    }
  }
  return out.toSorted((a, b) => a.localeCompare(b))
}

/**
 * Перевіряє всі **`kustomization.yaml`** під **`k8s`**: у inline **`patch`** і у зовнішніх patch-файлах не має бути **remove** і **add** на той самий **path**.
 * @param {string} root корінь репозиторію
 * @param {string[]} yamlFilesAbs абсолютні шляхи до yaml під k8s
 * @param {(msg: string) => void} fail реєстрація порушення
 * @returns {Promise<void>}
 */
async function validateKustomizationJson6902NoRemoveAddSamePath(root, yamlFilesAbs, fail) {
  const rootNorm = resolve(root)
  for (const kustAbs of yamlFilesAbs) {
    if (basename(kustAbs).toLowerCase() === 'kustomization.yaml') {
      const rel = (relative(root, kustAbs) || kustAbs).replaceAll('\\', '/')
      /** @type {string | undefined} */
      let raw
      let readOk = false
      try {
        raw = await readFile(kustAbs, 'utf8')
        readOk = true
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        fail(`${rel}: не вдалося прочитати для перевірки JSON6902 (${msg})`)
      }
      if (readOk && raw !== undefined) {
        const lines = toLines(raw)
        const body = lines.length > 0 && MODELINE_RE.test(lines[0]) ? yamlBodyAfterModeline(lines) : lines.join('\n')
        /** @type {import('yaml').Document[] | null} */
        let docs = null
        try {
          docs = parseAllDocuments(body)
        } catch {
          docs = null
        }
        if (docs !== null) {
          for (const doc of docs) {
            if (doc.errors.length === 0) {
              const rootObj = doc.toJSON()
              if (rootObj !== null && typeof rootObj === 'object' && !Array.isArray(rootObj)) {
                const rec = /** @type {Record<string, unknown>} */ (rootObj)
                if (rec.kind === 'Kustomization') {
                  const patches = rec.patches
                  if (Array.isArray(patches)) {
                    let patchIdx = 0
                    for (const p of patches) {
                      patchIdx++
                      if (p !== null && typeof p === 'object' && !Array.isArray(p)) {
                        const pr = /** @type {Record<string, unknown>} */ (p)
                        if (typeof pr.patch === 'string' && pr.patch.trim() !== '') {
                          const ops = collectJson6902OperationsFromPatchText(pr.patch)
                          const bad = json6902PathsWithRemoveAndAddOnSamePath(ops)
                          if (bad.length > 0) {
                            fail(
                              `${rel}: patches[${patchIdx}] inline JSON6902: один path має і remove, і add — оформи як op: replace (k8s.mdc): ${bad.join(', ')}`
                            )
                          }
                        }
                        if (typeof pr.path === 'string' && pr.path.trim() !== '') {
                          const patchRef = pr.path.trim()
                          const resolved = resolve(dirname(kustAbs), patchRef)
                          if (resolvedFilePathIsUnderRoot(rootNorm, resolved) && existsSync(resolved)) {
                            /** @type {import('node:fs').Stats | null} */
                            let st = null
                            try {
                              st = await stat(resolved)
                            } catch {
                              st = null
                            }
                            if (st !== null && st.isFile()) {
                              /** @type {string | undefined} */
                              let pRaw
                              try {
                                pRaw = await readFile(resolved, 'utf8')
                              } catch {
                                pRaw = undefined
                              }
                              if (pRaw !== undefined) {
                                const ops = collectJson6902OperationsFromPatchText(pRaw)
                                if (ops.length > 0) {
                                  const bad = json6902PathsWithRemoveAndAddOnSamePath(ops)
                                  if (bad.length > 0) {
                                    const relPatch = (relative(root, resolved) || patchRef).replaceAll('\\', '/')
                                    fail(
                                      `${rel}: patch-файл «${relPatch}»: один path має і remove, і add — оформи як op: replace (k8s.mdc): ${bad.join(', ')}`
                                    )
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}

/**
 * Шукає **Ingress** у розібраних документах; реєструє порушення.
 * @param {string} rel відносний шлях до файлу
 * @param {string} body YAML після modeline
 * @param {(msg: string) => void} fail callback для помилки (Ingress)
 * @returns {void}
 */
function scanIngressInYamlDocuments(rel, body, fail) {
  /** @type {import('yaml').Document[]} */
  let docs
  try {
    docs = parseAllDocuments(body)
  } catch {
    return
  }

  for (const [di, doc] of docs.entries()) {
    if (doc.errors.length === 0) {
      const obj = doc.toJSON()
      if (obj !== null && typeof obj === 'object' && !Array.isArray(obj)) {
        const rec = /** @type {Record<string, unknown>} */ (obj)
        if (rec.kind === 'Ingress') {
          fail(
            `${rel}: знайдено kind: Ingress (документ ${di + 1}) — заміни на Gateway API: HTTPRoute (hr.yaml), HealthCheckPolicy (hc.yaml) (див. k8s.mdc)`
          )
        }
      }
    }
  }
}

/**
 * Чи порушує маніфест вимогу **`Deployment.spec.template.spec.containers[].resources`** (див. k8s.mdc).
 * @param {unknown} manifest корінь YAML-документа як запис JavaScript
 * @returns {string | null} текст порушення для `fail` або null, якщо перевірка не застосовується / ок
 */
export function deploymentResourcesViolation(manifest) {
  if (manifest === null || manifest === undefined || typeof manifest !== 'object' || Array.isArray(manifest))
    return null
  const rec = /** @type {Record<string, unknown>} */ (manifest)
  if (rec.kind !== 'Deployment') return null
  const spec = rec.spec
  if (spec === null || spec === undefined || typeof spec !== 'object' || Array.isArray(spec)) return null
  const template = /** @type {Record<string, unknown>} */ (spec).template
  if (template === null || template === undefined || typeof template !== 'object' || Array.isArray(template))
    return null
  const podSpec = /** @type {Record<string, unknown>} */ (template).spec
  if (podSpec === null || podSpec === undefined || typeof podSpec !== 'object' || Array.isArray(podSpec)) return null
  const containers = /** @type {Record<string, unknown>} */ (podSpec).containers
  if (!Array.isArray(containers)) return null

  for (const [i, c] of containers.entries()) {
    const label =
      typeof c === 'object' && c !== null && !Array.isArray(c) && typeof c.name === 'string' && c.name !== ''
        ? c.name
        : `#${i + 1}`
    if (c !== null && c !== undefined && typeof c === 'object' && !Array.isArray(c)) {
      const cont = /** @type {Record<string, unknown>} */ (c)
      if (!('resources' in cont)) {
        return `контейнер "${label}": відсутнє поле resources — додай resources: {} (див. k8s.mdc)`
      }
      const r = cont.resources
      if (r === null || typeof r !== 'object' || Array.isArray(r)) {
        return `контейнер "${label}": resources має бути записом у YAML (наприклад порожній: resources: {})`
      }
    }
  }

  return null
}

/**
 * Прибирає digest з посилання на образ (`@sha256:…`) для порівняння тегу образу.
 * @param {string} image значення поля `image`
 * @returns {string} той самий рядок без суфікса `@…` (digest), з `.trim()`
 */
function stripImageDigest(image) {
  const at = image.indexOf('@')
  return (at === -1 ? image : image.slice(0, at)).trim()
}

/**
 * Чи рядок `image` вказує на репозиторій **hasura/graphql-engine** (будь-який тег / без вказаного тегу).
 * @param {string} image значення поля `image`
 * @returns {boolean} true, якщо шлях образу закінчується на `hasura/graphql-engine` з тегом або без
 */
function isHasuraGraphqlEngineImageRef(image) {
  const s = stripImageDigest(image)
  return /(^|\/)hasura\/graphql-engine(?:[:]|$)/u.test(s)
}

/**
 * Перевіряє пін образу Hasura у одному списку контейнерів Pod spec.
 * @param {string} list ім’я поля для повідомлення (`containers` / `initContainers`)
 * @param {unknown} containers значення з маніфесту
 * @returns {string | null} текст порушення або null
 */
function hasuraGraphqlEngineViolationInContainerList(list, containers) {
  if (!Array.isArray(containers)) return null
  for (const [i, c] of containers.entries()) {
    const label =
      typeof c === 'object' && c !== null && !Array.isArray(c) && typeof c.name === 'string' && c.name !== ''
        ? c.name
        : `#${i + 1}`
    if (c !== null && c !== undefined && typeof c === 'object' && !Array.isArray(c)) {
      const cont = /** @type {Record<string, unknown>} */ (c)
      const image = cont.image
      if (typeof image === 'string' && image.trim() !== '' && isHasuraGraphqlEngineImageRef(image)) {
        const normalized = stripImageDigest(image)
        if (!HASURA_GRAPHQL_ENGINE_ALLOWED_IMAGES.has(normalized)) {
          return `${list} "${label}": образ hasura/graphql-engine має бути ${HASURA_GRAPHQL_ENGINE_IMAGE} (зараз: ${image}) (див. k8s.mdc)`
        }
      }
    }
  }
  return null
}

/**
 * Чи порушує **Deployment** вимогу щодо зафіксованого образу **hasura/graphql-engine** (k8s.mdc).
 * @param {unknown} manifest корінь YAML-документа
 * @returns {string | null} текст порушення або null, якщо не Deployment / образу немає / ок
 */
export function deploymentHasuraGraphqlEngineImageViolation(manifest) {
  if (manifest === null || manifest === undefined || typeof manifest !== 'object' || Array.isArray(manifest))
    return null
  const rec = /** @type {Record<string, unknown>} */ (manifest)
  if (rec.kind !== 'Deployment') return null
  const spec = rec.spec
  if (spec === null || spec === undefined || typeof spec !== 'object' || Array.isArray(spec)) return null
  const template = /** @type {Record<string, unknown>} */ (spec).template
  if (template === null || template === undefined || typeof template !== 'object' || Array.isArray(template))
    return null
  const podSpecRaw = /** @type {Record<string, unknown>} */ (template).spec
  if (podSpecRaw === null || podSpecRaw === undefined || typeof podSpecRaw !== 'object' || Array.isArray(podSpecRaw))
    return null
  const podSpec = /** @type {Record<string, unknown>} */ (podSpecRaw)

  const main = hasuraGraphqlEngineViolationInContainerList('containers', podSpec.containers)
  if (main !== null) return main
  return hasuraGraphqlEngineViolationInContainerList('initContainers', podSpec.initContainers)
}

/**
 * Чи **Service** містить заборонені анотації GKE у **`metadata.annotations`** (k8s.mdc).
 * @param {unknown} manifest корінь YAML-документа
 * @returns {string | null} текст порушення або null, якщо не Service / анотацій немає / ок
 */
export function serviceForbiddenGcpAnnotationsViolation(manifest) {
  if (manifest === null || manifest === undefined || typeof manifest !== 'object' || Array.isArray(manifest))
    return null
  const rec = /** @type {Record<string, unknown>} */ (manifest)
  if (rec.kind !== 'Service') return null
  const meta = rec.metadata
  if (meta === null || meta === undefined || typeof meta !== 'object' || Array.isArray(meta)) return null
  const m = /** @type {Record<string, unknown>} */ (meta)
  const ann = m.annotations
  if (ann === null || ann === undefined || typeof ann !== 'object' || Array.isArray(ann)) return null
  const a = /** @type {Record<string, unknown>} */ (ann)
  /** @type {string[]} */
  const found = []
  for (const key of SERVICE_FORBIDDEN_GCP_ANNOTATION_KEYS) {
    if (Object.hasOwn(a, key)) {
      found.push(key)
    }
  }
  if (found.length === 0) return null
  return `metadata.annotations: прибери заборонені ключі GKE: ${found.join(', ')} (див. k8s.mdc)`
}

/** Суфікс **`metadata.name`** headless-сервісу поруч із **`svc.yaml`** (див. k8s.mdc). */
const SVC_HL_NAME_SUFFIX = '-hl'

/**
 * Kind маршрутів Gateway API, у **`spec`** яких шукаємо **`backendRefs`** / **`backendRef`** до **Service**.
 * @type {Set<string>}
 */
const GATEWAY_API_ROUTE_KINDS = new Set(['HTTPRoute', 'GRPCRoute', 'TCPRoute', 'TLSRoute', 'UDPRoute'])

/** Префікс **`apiVersion`** стандартних ресурсів Gateway API. */
const GATEWAY_API_GROUP_PREFIX = 'gateway.networking.k8s.io/'

/**
 * Чи **Service** у **`svc.yaml`** має **`spec.type: ClusterIP`** (k8s.mdc).
 * @param {unknown} manifest корінь YAML-документа
 * @returns {string | null} текст порушення або null
 */
export function serviceSvcYamlClusterIpTypeViolation(manifest) {
  if (manifest === null || manifest === undefined || typeof manifest !== 'object' || Array.isArray(manifest))
    return null
  const rec = /** @type {Record<string, unknown>} */ (manifest)
  if (rec.kind !== 'Service') return null
  const spec = rec.spec
  if (spec === null || spec === undefined || typeof spec !== 'object' || Array.isArray(spec)) {
    return 'Service: додай spec.type: ClusterIP (svc.yaml, див. k8s.mdc)'
  }
  const s = /** @type {Record<string, unknown>} */ (spec)
  if (s.type !== 'ClusterIP') {
    const cur = s.type === undefined ? 'відсутнє' : String(s.type)
    return `Service spec.type має бути ClusterIP (svc.yaml; зараз: ${cur}; див. k8s.mdc)`
  }
  return null
}

/**
 * Чи **Service** у **`svc-hl.yaml`** headless (**`spec.clusterIP: None`**) з суфіксом **`-hl`** у **`metadata.name`**.
 * @param {unknown} manifest корінь YAML-документа
 * @returns {string | null} текст порушення або null
 */
export function serviceSvcHlYamlHeadlessViolation(manifest) {
  if (manifest === null || manifest === undefined || typeof manifest !== 'object' || Array.isArray(manifest))
    return null
  const rec = /** @type {Record<string, unknown>} */ (manifest)
  if (rec.kind !== 'Service') return null
  const meta = rec.metadata
  if (meta === null || meta === undefined || typeof meta !== 'object' || Array.isArray(meta)) {
    return 'Service: потрібні metadata.name з суфіксом -hl (svc-hl.yaml, див. k8s.mdc)'
  }
  const m = /** @type {Record<string, unknown>} */ (meta)
  const n = m.name
  if (typeof n !== 'string' || !n.endsWith(SVC_HL_NAME_SUFFIX)) {
    return `Service metadata.name має закінчуватися на «${SVC_HL_NAME_SUFFIX}» (svc-hl.yaml; див. k8s.mdc)`
  }
  const spec = rec.spec
  if (spec === null || spec === undefined || typeof spec !== 'object' || Array.isArray(spec)) {
    return 'Service: додай spec.clusterIP: None (svc-hl.yaml, див. k8s.mdc)'
  }
  const s = /** @type {Record<string, unknown>} */ (spec)
  if (s.clusterIP !== 'None') {
    const cur = s.clusterIP === undefined ? 'відсутнє' : String(s.clusterIP)
    return `Service spec.clusterIP має бути None (headless, svc-hl.yaml; зараз: ${cur}; див. k8s.mdc)`
  }
  return null
}

/**
 * Чи **HealthCheckPolicy** (GKE) у **`spec.targetRef`** посилається на headless **Service** (суфікс **`-hl`**).
 *
 * Застосовується лише для **`apiVersion: networking.gke.io/v1`** і **`targetRef.kind: Service`** (або без **`kind`**).
 * Інші **`targetRef.kind`** скрипт не оцінює.
 * @param {unknown} manifest корінь YAML-документа
 * @returns {string | null} текст порушення або null
 */
export function healthCheckPolicyTargetRefHeadlessServiceViolation(manifest) {
  if (manifest === null || manifest === undefined || typeof manifest !== 'object' || Array.isArray(manifest))
    return null
  const rec = /** @type {Record<string, unknown>} */ (manifest)
  if (rec.kind !== 'HealthCheckPolicy') return null
  if (rec.apiVersion !== 'networking.gke.io/v1') return null
  const spec = rec.spec
  if (spec === null || spec === undefined || typeof spec !== 'object' || Array.isArray(spec)) return null
  const targetRef = /** @type {Record<string, unknown>} */ (spec).targetRef
  if (targetRef === null || targetRef === undefined || typeof targetRef !== 'object' || Array.isArray(targetRef)) {
    return 'HealthCheckPolicy: потрібний spec.targetRef (див. k8s.mdc)'
  }
  const tr = /** @type {Record<string, unknown>} */ (targetRef)
  const k = tr.kind
  if (typeof k === 'string' && k !== '' && k !== 'Service') return null
  const n = tr.name
  if (typeof n !== 'string' || !n.endsWith(SVC_HL_NAME_SUFFIX)) {
    return `HealthCheckPolicy: spec.targetRef.name має бути headless Service (суфікс «${SVC_HL_NAME_SUFFIX}»; див. k8s.mdc)`
  }
  return null
}

/**
 * Чи об’єкт схожий на **backendRef** до **Kubernetes Service** у Gateway API.
 *
 * Вимагає числовий **`port`**, щоб не плутати з **`HTTPHeaderMatch`** тощо (там теж є **`name`**, але без **`port`**).
 * @param {unknown} obj вузол у дереві **`spec`**
 * @returns {boolean} true, якщо враховуємо поле **`name`** як посилання на Service
 */
function isGatewayApiBackendRefToService(obj) {
  if (obj === null || obj === undefined || typeof obj !== 'object' || Array.isArray(obj)) return false
  const o = /** @type {Record<string, unknown>} */ (obj)
  if (typeof o.name !== 'string') return false
  if (typeof o.port !== 'number') return false
  const kind = o.kind
  if (kind !== undefined && kind !== 'Service') return false
  const group = o.group
  if (typeof group === 'string' && group !== '' && group !== 'core') return false
  return true
}

/**
 * Збирає імена **Service** з **`backendRefs`** / **`backendRef`** у піддереві **`spec`** маршруту Gateway API.
 * @param {unknown} spec значення **`spec`** маршруту
 * @returns {string[]} імена backend-сервісів (можливі дублікати)
 */
export function collectGatewayApiRouteBackendServiceNames(spec) {
  /** @type {string[]} */
  const out = []

  /**
   * @param {unknown} node вузол для обходу
   * @returns {void}
   */
  function walk(node) {
    if (node === null || node === undefined) return
    if (Array.isArray(node)) {
      for (const x of node) {
        walk(x)
      }
      return
    }
    if (typeof node !== 'object') return
    if (isGatewayApiBackendRefToService(node)) {
      out.push(String(/** @type {Record<string, unknown>} */ (node).name))
    }
    for (const v of Object.values(node)) {
      walk(v)
    }
  }

  walk(spec)
  return out
}

/**
 * Реєструє порушення: маршрути Gateway API мають посилатися на **Service** з суфіксом **`-hl`**.
 * @param {string} rel відносний шлях до файлу
 * @param {string} body YAML після modeline
 * @param {(msg: string) => void} fail callback помилки
 * @returns {void}
 */
function scanGatewayApiRouteBackendRefsInYamlBody(rel, body, fail) {
  /** @type {import('yaml').Document[]} */
  let docs
  try {
    docs = parseAllDocuments(body)
  } catch {
    return
  }

  for (const [di, doc] of docs.entries()) {
    if (doc.errors.length === 0) {
      const obj = doc.toJSON()
      if (obj !== null && typeof obj === 'object' && !Array.isArray(obj)) {
        const rec = /** @type {Record<string, unknown>} */ (obj)
        const av = rec.apiVersion
        const kind = rec.kind
        if (
          typeof av === 'string' &&
          av.startsWith(GATEWAY_API_GROUP_PREFIX) &&
          typeof kind === 'string' &&
          GATEWAY_API_ROUTE_KINDS.has(kind)
        ) {
          const names = collectGatewayApiRouteBackendServiceNames(rec.spec)
          for (const svcName of names) {
            if (!svcName.endsWith(SVC_HL_NAME_SUFFIX)) {
              fail(
                `${rel}: Gateway API ${kind} (документ ${di + 1}): backendRef до Service має вказувати headless-сервіс з суфіксом «${SVC_HL_NAME_SUFFIX}» у name (зараз: «${svcName}»; див. k8s.mdc)`
              )
            }
          }
        }
      }
    }
  }
}

/**
 * Перевіряє пари **`svc.yaml`** / **`svc-hl.yaml`** у каталозі (наявність, узгоджені імена **Service**).
 * @param {string} root корінь репозиторію
 * @param {string[]} yamlFiles абсолютні шляхи до `*.yaml` під `k8s`
 * @param {(msg: string) => void} fail callback помилки
 * @returns {Promise<void>}
 */
async function validateSvcYamlAndSvcHlPairs(root, yamlFiles, fail) {
  const absSet = new Set(yamlFiles)

  for (const abs of yamlFiles) {
    if (basename(abs).toLowerCase() === 'svc-hl.yaml') {
      const svcAbs = join(dirname(abs), 'svc.yaml')
      if (!absSet.has(svcAbs)) {
        const rel = (relative(root, abs) || abs).replaceAll('\\', '/')
        fail(`${rel}: svc-hl.yaml потребує svc.yaml у тому самому каталозі (див. k8s.mdc)`)
      }
    }
  }

  for (const svcAbs of yamlFiles) {
    if (basename(svcAbs).toLowerCase() === 'svc.yaml') {
      const rel = (relative(root, svcAbs) || svcAbs).replaceAll('\\', '/')
      const hlAbs = join(dirname(svcAbs), 'svc-hl.yaml')
      if (absSet.has(hlAbs)) {
        /** @type {string | undefined} */
        let svcBody
        /** @type {string | undefined} */
        let hlBody
        try {
          svcBody = await readK8sYamlBodyAfterModelineForSvcPair(svcAbs)
          hlBody = await readK8sYamlBodyAfterModelineForSvcPair(hlAbs)
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error)
          fail(`${rel}: не вдалося прочитати svc.yaml / svc-hl.yaml (${msg})`)
        }
        if (svcBody !== undefined && hlBody !== undefined) {
          const svcRoots = parseK8sYamlDocumentObjectRoots(svcBody)
          const hlRoots = parseK8sYamlDocumentObjectRoots(hlBody)

          /** @type {string[]} */
          const svcNames = []
          for (const [i, rootObj] of svcRoots.entries()) {
            const r = /** @type {Record<string, unknown>} */ (rootObj)
            if (r.kind === 'Service') {
              const meta = r.metadata
              if (meta !== null && typeof meta === 'object' && !Array.isArray(meta)) {
                const nm = /** @type {Record<string, unknown>} */ (meta).name
                if (typeof nm === 'string') {
                  svcNames.push(nm)
                } else {
                  fail(`${rel}: svc.yaml (документ ${i + 1}): Service без metadata.name (див. k8s.mdc)`)
                }
              } else {
                fail(`${rel}: svc.yaml (документ ${i + 1}): Service без metadata (див. k8s.mdc)`)
              }
            }
          }

          if (svcNames.length === 0) {
            fail(`${rel}: svc.yaml має містити принаймні один kind: Service (див. k8s.mdc)`)
          } else {
            /** @type {string[]} */
            const hlNames = []
            for (const [i, rootObj] of hlRoots.entries()) {
              const r = /** @type {Record<string, unknown>} */ (rootObj)
              if (r.kind === 'Service') {
                const meta = r.metadata
                if (meta !== null && typeof meta === 'object' && !Array.isArray(meta)) {
                  const nm = /** @type {Record<string, unknown>} */ (meta).name
                  if (typeof nm === 'string') {
                    hlNames.push(nm)
                  } else {
                    const hlRel = (relative(root, hlAbs) || hlAbs).replaceAll('\\', '/')
                    fail(`${hlRel}: svc-hl.yaml (документ ${i + 1}): Service без metadata.name (див. k8s.mdc)`)
                  }
                } else {
                  const hlRel = (relative(root, hlAbs) || hlAbs).replaceAll('\\', '/')
                  fail(`${hlRel}: svc-hl.yaml (документ ${i + 1}): Service без metadata (див. k8s.mdc)`)
                }
              }
            }

            if (hlNames.length === 0) {
              const hlRel = (relative(root, hlAbs) || hlAbs).replaceAll('\\', '/')
              fail(`${hlRel}: svc-hl.yaml має містити принаймні один kind: Service (див. k8s.mdc)`)
            } else {
              const hlSet = new Set(hlNames)
              for (const n of svcNames) {
                const expectHl = `${n}${SVC_HL_NAME_SUFFIX}`
                if (!hlSet.has(expectHl)) {
                  fail(
                    `${rel}: для Service «${n}» у svc.yaml у svc-hl.yaml має бути Service з metadata.name «${expectHl}» (див. k8s.mdc)`
                  )
                }
              }

              for (const h of hlNames) {
                if (h.endsWith(SVC_HL_NAME_SUFFIX)) {
                  const base = h.slice(0, -SVC_HL_NAME_SUFFIX.length)
                  if (!svcNames.includes(base)) {
                    const hlRel = (relative(root, hlAbs) || hlAbs).replaceAll('\\', '/')
                    fail(
                      `${hlRel}: Service «${h}» у svc-hl.yaml не відповідає жодному Service у svc.yaml (очікується базове ім’я «${base}»; див. k8s.mdc)`
                    )
                  }
                } else {
                  const hlRel = (relative(root, hlAbs) || hlAbs).replaceAll('\\', '/')
                  fail(
                    `${hlRel}: Service «${h}» у svc-hl.yaml: metadata.name має закінчуватися на «${SVC_HL_NAME_SUFFIX}» (див. k8s.mdc)`
                  )
                }
              }
            }
          }
        }
      } else {
        fail(`${rel}: поруч обов’язковий svc-hl.yaml (headless-копія з суфіксом -hl у metadata.name; див. k8s.mdc)`)
      }
    }
  }
}

/**
 * Для маніфестів, **підключених** до Kustomize (шлях у `resources` / `patches` / …), **metadata.namespace** не додають.
 * @param {unknown} manifest корінь YAML-документа
 * @returns {string | null} текст порушення або null, якщо поля немає
 */
export function metadataNamespaceForbiddenViolation(manifest) {
  if (manifest === null || manifest === undefined || typeof manifest !== 'object' || Array.isArray(manifest))
    return null
  const rec = /** @type {Record<string, unknown>} */ (manifest)
  const meta = rec.metadata
  if (meta !== null && typeof meta === 'object' && !Array.isArray(meta) && 'namespace' in meta) {
    return 'metadata.namespace заборонено — namespace задає kustomization.yaml (поле namespace); файл підключено через resources / patches / … (див. k8s.mdc)'
  }
  return null
}

/**
 * Вимагає непорожній **metadata.namespace** для namespaced-документів (крім кластерних kind).
 * @param {unknown} manifest корінь YAML-документа
 * @param {boolean} [inBaseDir] true — файл у **`k8s/base/`** (текст повідомлення для base)
 * @returns {string | null} текст порушення або null, якщо перевірка не застосовується / ок
 */
export function metadataNamespaceRequiredViolation(manifest, inBaseDir = false) {
  if (manifest === null || manifest === undefined || typeof manifest !== 'object' || Array.isArray(manifest))
    return null
  const rec = /** @type {Record<string, unknown>} */ (manifest)
  if (rec.kind === 'List' || rec.kind === 'Kustomization') return null
  if (typeof rec.kind !== 'string' || rec.kind === '') return null
  if (typeof rec.apiVersion !== 'string' || rec.apiVersion === '') return null
  if (isClusterScopedKubernetesKind(rec.kind)) return null
  const meta = rec.metadata
  if (meta === null || meta === undefined || typeof meta !== 'object' || Array.isArray(meta)) {
    return inBaseDir
      ? 'додай metadata з непорожнім metadata.namespace — у k8s/base у кожному ресурсному YAML має бути явний namespace (див. k8s.mdc)'
      : 'додай metadata з непорожнім metadata.namespace — файл не підключено до жодного kustomization.yaml (resources, patches, …) під k8s (див. k8s.mdc)'
  }
  const m = /** @type {Record<string, unknown>} */ (meta)
  const ns = m.namespace
  if (typeof ns !== 'string' || ns.trim() === '') {
    return inBaseDir
      ? 'metadata.namespace обов’язковий у k8s/base — додай явний namespace у маніфесті (див. k8s.mdc)'
      : 'metadata.namespace обов’язковий — файл не перелічений у kustomization.yaml під k8s; додай path у kustomization або явний namespace (див. k8s.mdc)'
  }
  return null
}

/**
 * Чи ім’я файлу — kustomization (дозволяє не застосовувати перевірку metadata.namespace до вмісту).
 * @param {string} baseLower basename у нижньому регістрі
 * @returns {boolean} true для `kustomization.yaml`
 */
function isKustomizationFileName(baseLower) {
  return baseLower === 'kustomization.yaml'
}

/**
 * Чи це **ресурсний** YAML у каталозі **`k8s/base`** (не `kustomization.yaml`).
 * @param {string} rel відносний шлях від кореня репозиторію
 * @param {string} baseLower basename у нижньому регістрі
 * @returns {boolean} true для `…/k8s/base/*.yaml` окрім kustomization
 */
export function isK8sBaseManifestYamlPath(rel, baseLower) {
  if (isKustomizationFileName(baseLower)) return false
  const n = rel.replaceAll('\\', '/')
  return /(^|\/)k8s\/base\//u.test(n)
}

/**
 * Парсить усі YAML-документи: **metadata.namespace**, **Deployment.resources**, **Hasura image pin**,
 * **Service — заборонені GKE-анотації**, **`svc.yaml`** (**`spec.type: ClusterIP`**), **`svc-hl.yaml`**
 * (**headless**, суфікс **`-hl`** у **`metadata.name`**), **HealthCheckPolicy** (**`targetRef.name`** з **`-hl`**).
 * @param {string} rel відносний шлях
 * @param {string} baseLower basename файлу (нижній регістр)
 * @param {string} body вміст після modeline
 * @param {(msg: string) => void} fail реєстрація помилки
 * @param {boolean} kustomizeManaged чи файл досяжний з kustomization.yaml (resources / patches / …)
 */
function validateK8sYamlPolicyDocuments(rel, baseLower, body, fail, kustomizeManaged) {
  /** @type {import('yaml').Document[]} */
  let docs
  try {
    docs = parseAllDocuments(body)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    fail(`${rel}: не вдалося розібрати YAML для перевірок маніфестів (${msg})`)
    return
  }

  const skipMetaNs = isKustomizationFileName(baseLower)
  const inBaseManifest = isK8sBaseManifestYamlPath(rel, baseLower)

  for (const [di, doc] of docs.entries()) {
    if (doc.errors.length > 0) {
      fail(`${rel}: YAML (документ ${di + 1}): ${doc.errors.map(e => e.message).join('; ')}`)
    } else {
      const obj = doc.toJSON()
      if (!skipMetaNs) {
        if (inBaseManifest) {
          const req = metadataNamespaceRequiredViolation(obj, true)
          if (req !== null) {
            fail(`${rel}: документ ${di + 1}: ${req}`)
          }
        } else if (kustomizeManaged) {
          const ns = metadataNamespaceForbiddenViolation(obj)
          if (ns !== null) {
            fail(`${rel}: документ ${di + 1}: ${ns}`)
          }
        } else {
          const req = metadataNamespaceRequiredViolation(obj, false)
          if (req !== null) {
            fail(`${rel}: документ ${di + 1}: ${req}`)
          }
        }
      }
      const resV = deploymentResourcesViolation(obj)
      if (resV !== null) {
        fail(`${rel}: Deployment (документ ${di + 1}): ${resV}`)
      }
      const hasuraV = deploymentHasuraGraphqlEngineImageViolation(obj)
      if (hasuraV !== null) {
        fail(`${rel}: Deployment (документ ${di + 1}): ${hasuraV}`)
      }
      const svcGcpV = serviceForbiddenGcpAnnotationsViolation(obj)
      if (svcGcpV !== null) {
        fail(`${rel}: Service (документ ${di + 1}): ${svcGcpV}`)
      }
      if (baseLower === 'svc.yaml') {
        const svcT = serviceSvcYamlClusterIpTypeViolation(obj)
        if (svcT !== null) {
          fail(`${rel}: Service (документ ${di + 1}): ${svcT}`)
        }
      }
      if (baseLower === 'svc-hl.yaml') {
        const svcH = serviceSvcHlYamlHeadlessViolation(obj)
        if (svcH !== null) {
          fail(`${rel}: Service (документ ${di + 1}): ${svcH}`)
        }
      }
      const hcpHl = healthCheckPolicyTargetRefHeadlessServiceViolation(obj)
      if (hcpHl !== null) {
        fail(`${rel}: документ ${di + 1}: ${hcpHl}`)
      }
    }
  }
}

/**
 * Kind для імен файлів yannh/datree: лише літери та цифри, нижній регістр (Service → service, HTTPRoute → httproute).
 * @param {string} kind значення поля kind
 * @returns {string} рядок для шаблону імені файлу схеми
 */
function kindToSchemaFilePart(kind) {
  return kind.replaceAll(/[^a-zA-Z0-9]/gu, '').toLowerCase()
}

/**
 * Очікуваний $schema для маніфесту згідно з k8s.mdc.
 * @param {string} filePath шлях до файлу (для імені kustomization)
 * @param {string} doc перший YAML-документ після modeline
 * @returns {{ expected: string | null, reason: string }} reason — для повідомлень про помилку
 */
export function expectedSchemaUrl(filePath, doc) {
  const base = basename(filePath)
  const baseLower = base.toLowerCase()

  if (baseLower === 'kustomization.yaml') {
    return { expected: KUSTOMIZATION_SCHEMA, reason: 'kustomization (ім’я файлу)' }
  }

  const { apiVersion, kind } = extractApiVersionAndKind(doc)
  if (!apiVersion || !kind) {
    return {
      expected: null,
      reason: 'не знайдено apiVersion/kind у першому документі (потрібні для перевірки $schema)'
    }
  }

  const manifestType = extractTopLevelManifestType(doc)
  const explicit = lookupExplicitK8sSchema(apiVersion, kind, manifestType)
  if (explicit) {
    return { expected: explicit.schema, reason: explicit.reason }
  }

  if (apiVersion === 'v1') {
    const k = kindToSchemaFilePart(kind)
    return { expected: `${YANNH_BASE}${k}-v1.json`, reason: 'core v1 (yannh)' }
  }

  if (!apiVersion.includes('/')) {
    return {
      expected: null,
      reason: `нестандартний apiVersion "${apiVersion}" — очікується v1 або group/version`
    }
  }

  const slash = apiVersion.indexOf('/')
  const group = apiVersion.slice(0, Math.max(0, slash))
  const version = apiVersion.slice(slash + 1)
  const kindPart = kindToSchemaFilePart(kind)
  const groupDash = group.replaceAll('.', '-')

  if (YANNH_GROUPS.has(group)) {
    const url = `${YANNH_BASE}${kindPart}-${groupDash}-${version}.json`
    return { expected: url, reason: 'вбудований API Kubernetes (yannh)' }
  }

  const datreeKind = kindToSchemaFilePart(kind)

  const url = `${DATREE_CRD_BASE}${group}/${datreeKind}_${version}.json`
  return { expected: url, reason: 'CRD / група поза yannh (datree CRDs-catalog)' }
}

/**
 * Підраховує рядки з modeline $schema у файлі.
 * @param {string[]} lines рядки файлу
 * @returns {number} скільки рядків містять modeline `$schema`
 */
function countSchemaModelines(lines) {
  return lines.filter(l => /^\s*#\s*yaml-language-server:\s*\$schema=\S+/u.test(l.trim())).length
}

/**
 * Перевіряє один YAML у дереві k8s (modeline, схема).
 * @param {string} abs абсолютний шлях до файлу
 * @param {string} root корінь репозиторію
 * @param {(msg: string) => void} fail реєстрація помилки
 * @param {(msg: string) => void} pass реєстрація успіху
 * @param {Set<string>} kustomizeManagedRel відносні posix-шляхи з collectKustomizeManagedRelPaths
 * @returns {Promise<void>}
 */
async function checkK8sYamlFile(abs, root, fail, pass, kustomizeManagedRel) {
  const rel = (relative(root, abs) || abs).replaceAll('\\', '/')
  const base = basename(abs)
  const baseLower = base.toLowerCase()

  if (baseLower.endsWith('.yml')) {
    fail(`${rel}: розширення .yml — перейменуй на .yaml (див. k8s.mdc)`)
    return
  }

  let raw
  try {
    raw = await readFile(abs, 'utf8')
  } catch (error) {
    fail(`${rel}: не вдалося прочитати (${error.message})`)
    return
  }

  const lines = toLines(raw)
  if (lines.length === 0 || lines[0].trim() === '') {
    fail(`${rel}: перший рядок порожній — потрібен # yaml-language-server: $schema=…`)
    return
  }

  const firstLineIsModeline = MODELINE_RE.test(lines[0])
  const bodyForFirstDoc = k8sYamlBodyForDocumentParse(lines)
  const isAlbHttpBackendGroup = k8sYamlFirstDocIsAlbYcHttpBackendGroup(bodyForFirstDoc)

  if (isAlbHttpBackendGroup) {
    if (firstLineIsModeline) {
      fail(
        `${rel}: для kind HttpBackendGroup (apiVersion alb.yc.io/v1alpha1) не задавай # yaml-language-server: $schema — прибери перший рядок modeline (k8s.mdc)`
      )
      return
    }
    if (countSchemaModelines(lines) > 0) {
      fail(
        `${rel}: для kind HttpBackendGroup (apiVersion alb.yc.io/v1alpha1) не використовуй # yaml-language-server: $schema у файлі (k8s.mdc)`
      )
      return
    }
    const body = lines.join('\n')
    scanIngressInYamlDocuments(rel, body, fail)
    pass(`${rel}: HttpBackendGroup (alb.yc.io/v1alpha1) — modeline $schema не застосовується (k8s.mdc)`)
    const kustomizeManaged = kustomizeManagedRel.has(rel)
    validateK8sYamlPolicyDocuments(rel, baseLower, body, fail, kustomizeManaged)
    scanGatewayApiRouteBackendRefsInYamlBody(rel, body, fail)
    return
  }

  if (!firstLineIsModeline) {
    fail(`${rel}: перший рядок має бути коментарем # yaml-language-server: $schema=<url> (без префіксів перед #)`)
    return
  }

  const m = /** @type {RegExpMatchArray} */ (lines[0].match(MODELINE_RE))
  const schemaUrl = m[1]
  if (countSchemaModelines(lines) > 1) {
    fail(`${rel}: кілька рядків yaml-language-server $schema — лиш один modeline на файл (див. k8s.mdc)`)
    return
  }

  const body = yamlBodyAfterModeline(lines)

  scanIngressInYamlDocuments(rel, body, fail)

  if (schemaUrl.startsWith('file:')) {
    pass(`${rel}: локальна схема (file:) — перевірка URL за apiVersion/kind пропущена`)
  } else if (/^https:/iu.test(schemaUrl)) {
    const doc = firstYamlDocument(body)
    const { expected, reason } = expectedSchemaUrl(abs, doc)

    if (expected === null) {
      fail(`${rel}: ${reason}`)
      return
    }

    if (schemaUrl !== expected) {
      fail(`${rel}: $schema не відповідає правилу (${reason}). Очікується:\n     ${expected}\n     Зараз: ${schemaUrl}`)
      return
    }

    pass(`${rel}: $schema узгоджено (${reason})`)
  } else {
    fail(`${rel}: $schema має бути https URL або file: (див. k8s.mdc)`)
    return
  }

  const kustomizeManaged = kustomizeManagedRel.has(rel)
  validateK8sYamlPolicyDocuments(rel, baseLower, body, fail, kustomizeManaged)

  scanGatewayApiRouteBackendRefsInYamlBody(rel, body, fail)
}

/**
 * Реєструє порушення для шляхів виду **`…/k8s/dev/…`** (окремої директорії **dev** не має бути).
 * @param {string[]} yamlFiles абсолютні шляхи
 * @param {string} root корінь репозиторію
 * @param {(msg: string) => void} fail callback для реєстрації порушення
 * @returns {void}
 */
function assertNoForbiddenK8sDevPaths(yamlFiles, root, fail) {
  for (const abs of yamlFiles) {
    const rel = relative(root, abs).replaceAll('\\', '/')
    if (isForbiddenK8sDevPath(rel)) {
      fail(`${rel}: заборонена директорія k8s/dev/ — середовище dev відповідає base (див. k8s.mdc)`)
    }
  }
}

/**
 * Якщо є **`k8s/base/kustomization.yaml`**, у ньому **завжди** має бути непорожній **`namespace:`**.
 * @param {string} root корінь репозиторію
 * @param {string[]} yamlFiles абсолютні шляхи
 * @param {(msg: string) => void} fail callback для реєстрації порушення
 * @returns {Promise<void>}
 */
async function ensureBaseKustomizationHasNamespace(root, yamlFiles, fail) {
  for (const abs of yamlFiles) {
    const rel = relative(root, abs).replaceAll('\\', '/')
    if (isBaseKustomizationPath(rel)) {
      try {
        const raw = await readFile(abs, 'utf8')
        const lines = toLines(raw)
        const body = yamlBodyAfterModeline(lines)
        /** @type {import('yaml').Document[] | undefined} */
        let docs
        try {
          docs = parseAllDocuments(body)
        } catch {
          fail(`${rel}: не вдалося розпарсити YAML для перевірки namespace у base (див. k8s.mdc)`)
        }
        if (docs !== undefined) {
          const first = docs[0]?.toJSON()
          const v = baseKustomizationNamespaceViolation(first)
          if (v) {
            fail(`${rel}: ${v}`)
          }
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        fail(`${rel}: не вдалося прочитати (${msg})`)
      }
    }
  }
}

/**
 * Перевіряє відповідність проєкту правилам k8s.mdc.
 * @returns {Promise<number>} 0 — все OK, 1 — є проблеми
 */
export async function check() {
  const reporter = createCheckReporter()
  const { pass, fail } = reporter

  const root = process.cwd()

  await removeBackendConfigOnlyK8sYamlFiles(root, fail, pass)

  const yamlFiles = await findK8sYamlFiles(root)

  if (yamlFiles.length === 0) {
    pass('Немає *.yaml під k8s — перевірку $schema пропущено')
    return reporter.getExitCode()
  }

  pass(`YAML у k8s: ${yamlFiles.length} файл(ів)`)

  assertNoForbiddenK8sDevPaths(yamlFiles, root, fail)

  const kustomizeManagedRel = await collectKustomizeManagedRelPaths(root, yamlFiles)

  for (const abs of yamlFiles) {
    await checkK8sYamlFile(abs, root, fail, pass, kustomizeManagedRel)
  }

  await validateSvcYamlAndSvcHlPairs(root, yamlFiles, fail)

  await validateKustomizationIncludesSvcHlWithSvc(root, yamlFiles, fail)

  await validateKustomizationJson6902NoRemoveAddSamePath(root, yamlFiles, fail)

  await ensureBaseKustomizationHasNamespace(root, yamlFiles, fail)

  return reporter.getExitCode()
}

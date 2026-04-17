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
 * **Мішень patch:** у **`patches[].target`** і **`patchesJson6902[].target`** (без **labelSelector** / **annotationSelector**)
 * має існувати відповідний ресурс у зібраному з **`resources`**, **`bases`**, **`components`**, **`crds`** каталозі (рекурсивно для підкаталогів з **`kustomization.yaml`**).
 * Для **`patchesStrategicMerge`** і для **`patches[].path`** без **`target`** і без inline **`patch`** (зовнішній strategic-merge)
 * кожен YAML-документ з кореневим **`kind`** і **`metadata.name`** також звіряється з цим каталогом.
 *
 * Явні винятки до загальної логіки yannh/datree — таблиця **`EXPLICIT_K8S_SCHEMAS`** (`Map`): ключ
 * **`apiVersion`, `kind`, `type`** (для CRD без поля `type` у маніфесті — зірочка **`*`** як третій
 * компонент). Спочатку шукається збіг за фактичним `type`, потім за **`*`**.
 * Dockerfile — правило docker.mdc, скрипт check-docker.mjs.
 *
 * **Структура `HTTPRoute` для Hasura-Deployment:** звіряється канон 4 правил у **`spec.rules`** (редиректи **`<prefix>/ql`** і **`<prefix>/ql/`** на **`<prefix>/ql/console`** 302, **`PathPrefix <prefix>/ql`** + **URLRewrite** на **`/`**, окреме WebSocket-правило з **`RequestHeaderModifier`** remove **`Authorization`**). **Префікс параметризовано** (рядок перед **`/ql`** у першому Hasura-правилі). **Прив'язка** — за **`metadata.name`** у тому ж каталозі, що й **Deployment** з образом **`hasura/graphql-engine`** (див. k8s.mdc). **Додаткові правила** поверх канону дозволені.
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
 * Прибирає зовнішні лапки зі скаляра YAML (`"x"` / `'x'`), якщо вони парні.
 * @param {string | undefined} raw значення з `match(…)[1]` або подібне
 * @returns {string | undefined} рядок без лапок або undefined, якщо вхід undefined
 */
function trimYamlScalarQuotes(raw) {
  if (raw === undefined) {
    return
  }
  const s = String(raw)
  if (s.length >= 2 && ((s[0] === '"' && s.at(-1) === '"') || (s[0] === "'" && s.at(-1) === "'"))) {
    return s.slice(1, -1)
  }
  return s
}

/**
 * Витягує кореневе поле **`type:`** з документа (без повного YAML-парсера).
 * @param {string} doc фрагмент YAML одного документа
 * @returns {string | undefined} значення без лапок або undefined, якщо поля немає
 */
function extractTopLevelManifestType(doc) {
  for (const line of doc.split(YAML_LINE_SPLIT_RE)) {
    const m = line.match(TYPE_FIELD_RE)
    if (m) {
      const raw = trimYamlScalarQuotes(m[1])
      if (raw === undefined || raw === '') {
        return
      }
      return raw
    }
  }
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
const PATH_SPLIT_RE = /[/\\]/u
const YAML_EXTENSION_RE = /\.ya?ml$/iu
const YAML_LINE_SPLIT_RE = /\r?\n/u
const API_VERSION_FIELD_RE = /^\s*apiVersion:\s*(\S+)\s*$/
const KIND_FIELD_RE = /^\s*kind:\s*(\S+)\s*$/
const TYPE_FIELD_RE = /^\s*type:\s*(\S+)\s*$/
const YAML_DOC_SEPARATOR_LINE_RE = /^---\s*$/
const HEALTHCHECK_DELETE_RE = /\$patch:\s*delete/u
const HEALTHCHECK_KIND_RE = /kind:\s*HealthCheckPolicy/u
const METADATA_LINE_RE = /metadata:/u
const NAME_NON_EMPTY_RE = /name:\s*\S+/u
const K8S_BASE_KUSTOMIZATION_PATH_RE = /(^|\/)k8s\/base\/kustomization\.yaml$/u
const K8S_BASE_SEGMENT_RE = /(^|\/)k8s\/base\//u
const OXLINT_SCHEMA_MODELINE_RE = /^\s*#\s*yaml-language-server:\s*\$schema=\S+/u
const HTTPS_SCHEMA_RE = /^https:/iu
const HASURA_GRAPHQL_ENGINE_RE = /(^|\/)hasura\/graphql-engine(?::|$)/u

/**
 * Чи містить шлях сегмент директорії `k8s` (рівно ця назва компонента).
 * @param {string} filePath шлях до файлу
 * @returns {boolean} true, якщо серед компонентів шляху є каталог `k8s`
 */
export function pathHasK8sSegment(filePath) {
  const parts = filePath.split(PATH_SPLIT_RE)
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
 * Один файл **`kustomization.yaml`**: **`svc.yaml`** у шляхах має мати парний **`svc-hl.yaml`**.
 * @param {string} root корінь репозиторію
 * @param {string} kustAbs абсолютний шлях до kustomization.yaml
 * @param {(msg: string) => void} fail реєстрація помилки
 * @returns {Promise<void>}
 */
async function validateOneKustomizationSvcHlWithSvc(root, kustAbs, fail) {
  const rel = (relative(root, kustAbs) || kustAbs).replaceAll('\\', '/')
  let raw
  try {
    raw = await readFile(kustAbs, 'utf8')
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    fail(`${rel}: не вдалося прочитати для перевірки svc.yaml/svc-hl.yaml у kustomization (${msg})`)
    return
  }
  const lines = toLines(raw)
  const body = yamlBodyAfterModeline(lines)
  /** @type {import('yaml').Document[] | undefined} */
  let docs
  try {
    docs = parseAllDocuments(body)
  } catch {
    fail(`${rel}: не вдалося розпарсити YAML для перевірки svc.yaml/svc-hl.yaml у kustomization (див. k8s.mdc)`)
    return
  }
  const first = docs[0]?.toJSON()
  if (first === null || first === undefined || typeof first !== 'object' || Array.isArray(first)) {
    return
  }
  const pathRefs = pathsFromKustomizationObject(first)
  const kustDir = dirname(kustAbs)
  const v = kustomizationSvcYamlMissingSvcHlViolation(kustDir, pathRefs)
  if (v !== null) {
    fail(`${rel}: ${v}`)
  }
}

/**
 * Перевіряє всі **`kustomization.yaml`** під **`k8s`**: разом із **`svc.yaml`** має бути **`svc-hl.yaml`** у полях шляхів.
 * @param {string} root корінь репозиторію
 * @param {string[]} yamlFiles абсолютні шляхи до yaml під k8s
 * @param {(msg: string) => void} fail callback помилки
 * @returns {Promise<void>}
 */
async function validateKustomizationIncludesSvcHlWithSvc(root, yamlFiles, fail) {
  for (const kustAbs of yamlFiles.filter(p => basename(p).toLowerCase() === 'kustomization.yaml')) {
    await validateOneKustomizationSvcHlWithSvc(root, kustAbs, fail)
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

    /**
     * @param {string} ref шлях з kustomization
     * @returns {Promise<void>}
     */
    async function handleKustomizeManagedPathRef(ref) {
      if (ref.includes('://')) {
        return
      }
      const resolved = resolve(kustDir, ref)
      let st
      try {
        st = await stat(resolved)
      } catch {
        st = undefined
      }
      if (!st) {
        return
      }
      if (st.isFile()) {
        if (YAML_EXTENSION_RE.test(resolved)) {
          const pr = posixRelFromAbs(root, resolved)
          if (pr !== null) {
            managed.add(pr)
          }
        }
        return
      }
      if (!st.isDirectory()) {
        return
      }
      const childK = existsSync(join(resolved, 'kustomization.yaml')) ? join(resolved, 'kustomization.yaml') : null
      if (childK !== null) {
        await walkKustomization(childK)
      }
    }

    for (const ref of pathRefs) {
      await handleKustomizeManagedPathRef(ref)
    }
  }

  for (const k of kustomizationAbsList) {
    await walkKustomization(k)
  }

  return managed
}

/**
 * Шляхи лише з полів ресурсів Kustomization (**без** patch-файлів).
 * @param {unknown} obj корінь першого документа Kustomization
 * @returns {string[]} відносні посилання
 */
function resourcePathRefsFromKustomizationObject(obj) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return []
  const rec = /** @type {Record<string, unknown>} */ (obj)
  /** @type {string[]} */
  const out = []
  pushStringPaths(rec.resources, out)
  pushStringPaths(rec.bases, out)
  pushStringPaths(rec.components, out)
  pushStringPaths(rec.crds, out)
  return out
}

/**
 * Дескриптор ресурсу для звірки з **`target`** Kustomize / strategic-merge фрагментом.
 * @typedef {{ group: string, version: string, kind: string, name: string, namespace: string }} KustomizeResourceDescriptor
 */

/**
 * Розбиває **`apiVersion`** Kubernetes на **group** і **version**.
 * @param {unknown} apiVersion значення з YAML
 * @returns {{ group: string, version: string }} для `group/version` — два сегменти; для `v1` — core (**group** порожній).
 */
export function splitK8sApiVersion(apiVersion) {
  if (typeof apiVersion !== 'string') {
    return { group: '', version: '' }
  }
  const t = apiVersion.trim()
  if (t === '') {
    return { group: '', version: '' }
  }
  const i = t.indexOf('/')
  if (i === -1) {
    return { group: '', version: t }
  }
  return { group: t.slice(0, i), version: t.slice(i + 1) }
}

/**
 * Чи patch-**target** використовує **labelSelector** / **annotationSelector** (тоді статична перевірка за іменем не застосовується).
 * @param {Record<string, unknown>} t об’єкт **target**
 * @returns {boolean} true, якщо є непорожній селектор
 */
function patchTargetUsesSelector(t) {
  const ls = t.labelSelector
  if (
    ls !== undefined &&
    ls !== null &&
    ls !== '' &&
    ((typeof ls === 'object' && !Array.isArray(ls) && Object.keys(ls).length > 0) ||
      (typeof ls === 'string' && ls.trim() !== ''))
  ) {
    return true
  }
  const asel = t.annotationSelector
  if (
    asel !== undefined &&
    asel !== null &&
    asel !== '' &&
    ((typeof asel === 'object' && !Array.isArray(asel) && Object.keys(asel).length > 0) ||
      (typeof asel === 'string' && asel.trim() !== ''))
  ) {
    return true
  }
  return false
}

/**
 * Чи варто перевіряти **target** на наявність ресурсу в каталозі (є **kind** і **name**, немає селекторів).
 * @param {unknown} target значення **patches[].target**
 * @returns {boolean} true, якщо перевірка доречна
 */
export function shouldValidateKustomizePatchTarget(target) {
  if (target === null || typeof target !== 'object' || Array.isArray(target)) {
    return false
  }
  const t = /** @type {Record<string, unknown>} */ (target)
  const kind = t.kind
  const name = t.name
  if (typeof kind !== 'string' || kind.trim() === '' || typeof name !== 'string' || name.trim() === '') {
    return false
  }
  return !patchTargetUsesSelector(t)
}

/**
 * Чи **target** Kustomize відповідає дескриптору ресурсу (узгоджено з правилами відбору Kustomize: пропущені поля **target** не звужують).
 * @param {unknown} target об’єкт **target**
 * @param {KustomizeResourceDescriptor} res дескриптор з інвентарю
 * @returns {boolean} true, якщо збігається
 */
export function kustomizePatchTargetMatchesDescriptor(target, res) {
  if (target === null || typeof target !== 'object' || Array.isArray(target)) {
    return false
  }
  const rec = /** @type {Record<string, unknown>} */ (target)
  const tk = rec.kind
  const tn = rec.name
  if (typeof tk !== 'string' || typeof tn !== 'string') {
    return false
  }
  if (tk.trim() !== res.kind || tn.trim() !== res.name) {
    return false
  }
  const tgtGroup = rec.group
  if (typeof tgtGroup === 'string' && tgtGroup.trim() !== '' && res.group !== tgtGroup.trim()) {
    return false
  }
  const tgtVersion = rec.version
  if (typeof tgtVersion === 'string' && tgtVersion.trim() !== '' && res.version !== tgtVersion.trim()) {
    return false
  }
  const tgtNs = rec.namespace
  if (typeof tgtNs === 'string' && tgtNs.trim() !== '' && res.namespace !== tgtNs.trim()) {
    return false
  }
  return true
}

/**
 * Чи є в каталозі ресурс, який задовольняє **target**.
 * @param {KustomizeResourceDescriptor[]} catalog зібрані дескриптори
 * @param {unknown} target об’єкт **target**
 * @returns {boolean} true, якщо перевірка не потрібна або знайдено збіг
 */
export function kustomizeResourceCatalogMatchesPatchTarget(catalog, target) {
  if (!shouldValidateKustomizePatchTarget(target)) {
    return true
  }
  return catalog.some(res => kustomizePatchTargetMatchesDescriptor(target, res))
}

/**
 * Чи два дескриптори повністю збігаються (для strategic-merge фрагмента).
 * @param {KustomizeResourceDescriptor} a перший
 * @param {KustomizeResourceDescriptor} b другий
 * @returns {boolean} true, якщо всі поля однакові
 */
export function kustomizeResourceDescriptorsIdentityEqual(a, b) {
  return (
    a.group === b.group &&
    a.version === b.version &&
    a.kind === b.kind &&
    a.name === b.name &&
    a.namespace === b.namespace
  )
}

/**
 * Непорожнє **`metadata.name`**, якщо задано коректно.
 * @param {unknown} meta значення **metadata**
 * @returns {string} ім’я або порожній рядок
 */
function metadataNameTrimmed(meta) {
  if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) {
    return ''
  }
  const n = /** @type {Record<string, unknown>} */ (meta).name
  return typeof n === 'string' && n.trim() !== '' ? n.trim() : ''
}

/**
 * Непорожній **`metadata.namespace`**, якщо задано коректно.
 * @param {unknown} meta значення **metadata**
 * @returns {string} namespace або порожній рядок
 */
function metadataNamespaceTrimmed(meta) {
  if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) {
    return ''
  }
  const ns = /** @type {Record<string, unknown>} */ (meta).namespace
  return typeof ns === 'string' && ns.trim() !== '' ? ns.trim() : ''
}

/**
 * Будує дескриптор з маніфесту (пропускає **Kustomization** та об’єкти без **metadata.name**).
 * @param {Record<string, unknown>} obj корінь документа
 * @param {string} kustomizationDefaultNs значення **`namespace:`** з kustomization, що підключив файл
 * @returns {KustomizeResourceDescriptor | null} дескриптор для звірки або **null**, якщо документ не підходить.
 */
export function kustomizeResourceDescriptorFromManifest(obj, kustomizationDefaultNs) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    return null
  }
  const kindRaw = obj.kind
  if (typeof kindRaw !== 'string' || kindRaw.trim() === '') {
    return null
  }
  const kind = kindRaw.trim()
  if (kind === 'Kustomization') {
    return null
  }
  const meta = obj.metadata
  const name = metadataNameTrimmed(meta)
  if (name === '') {
    return null
  }
  const { group, version } = splitK8sApiVersion(obj.apiVersion)
  let namespace = ''
  if (!isClusterScopedKubernetesKind(kind)) {
    const metaNs = metadataNamespaceTrimmed(meta)
    const def =
      typeof kustomizationDefaultNs === 'string' && kustomizationDefaultNs.trim() !== ''
        ? kustomizationDefaultNs.trim()
        : ''
    namespace = metaNs || def
  }
  return { group, version, kind, name, namespace }
}

/**
 * Читає k8s YAML і повертає корені документів-об’єктів (після modeline, якщо він є).
 * @param {string} abs абсолютний шлях до файлу
 * @returns {Promise<Record<string, unknown>[]>} масив коренів-об’єктів YAML-документів (без масивів на корені).
 */
async function readK8sYamlDocumentRootsForInventory(abs) {
  let raw
  try {
    raw = await readFile(abs, 'utf8')
  } catch {
    return []
  }
  const lines = toLines(raw)
  const body = lines.length > 0 && MODELINE_RE.test(lines[0]) ? yamlBodyAfterModeline(lines) : lines.join('\n')
  /** @type {unknown[]} */
  const roots = parseK8sYamlDocumentObjectRoots(body)
  /** @type {Record<string, unknown>[]} */
  const out = []
  for (const r of roots) {
    if (r !== null && typeof r === 'object' && !Array.isArray(r)) {
      out.push(/** @type {Record<string, unknown>} */ (r))
    }
  }
  return out
}

/**
 * Збирає дескриптори ресурсів з **`resources` / `bases` / `components` / `crds`** для одного дерева kustomization.
 * Повторний вхід у той самий **`kustomization.yaml`** дає порожній внесок (як у **`collectKustomizeManagedRelPaths`**).
 * @param {string} kustAbs абсолютний шлях до **kustomization.yaml**
 * @param {string} rootNorm нормалізований абсолютний корінь репозиторію
 * @param {Set<string>} visitedKustomization нормалізовані абсолютні шляхи відвіданих **kustomization.yaml**
 * @returns {Promise<KustomizeResourceDescriptor[]>} плоский список дескрипторів із дерева **resources** / **bases** / **components** / **crds**.
 */
export async function collectResourceDescriptorsForKustomizationWalk(kustAbs, rootNorm, visitedKustomization) {
  const normKust = resolve(kustAbs)
  if (visitedKustomization.has(normKust)) {
    return []
  }
  visitedKustomization.add(normKust)

  let raw
  try {
    raw = await readFile(normKust, 'utf8')
  } catch {
    return []
  }
  const lines = toLines(raw)
  const body = lines.length > 0 && MODELINE_RE.test(lines[0]) ? yamlBodyAfterModeline(lines) : lines.join('\n')

  /** @type {import('yaml').Document[] | undefined} */
  let docs
  try {
    docs = parseAllDocuments(body)
  } catch {
    return []
  }
  const first = docs[0]?.toJSON()
  if (first === null || first === undefined || typeof first !== 'object' || Array.isArray(first)) {
    return []
  }
  const rec = /** @type {Record<string, unknown>} */ (first)
  const kustNs = typeof rec.namespace === 'string' && rec.namespace.trim() !== '' ? rec.namespace.trim() : ''
  const kustDir = dirname(normKust)
  const pathRefs = resourcePathRefsFromKustomizationObject(first)

  /** @type {KustomizeResourceDescriptor[]} */
  const out = []

  /**
   * @param {string} ref шлях з resources/bases/…
   * @returns {Promise<void>}
   */
  async function handleResourceDescriptorPathRef(ref) {
    if (typeof ref !== 'string' || ref.includes('://')) {
      return
    }
    const resolved = resolve(kustDir, ref)
    if (!resolvedFilePathIsUnderRoot(rootNorm, resolved)) {
      return
    }
    /** @type {import('node:fs').Stats | undefined} */
    let st
    try {
      st = await stat(resolved)
    } catch {
      st = undefined
    }
    if (st === undefined) {
      return
    }
    if (st.isFile() && YAML_EXTENSION_RE.test(resolved)) {
      const roots = await readK8sYamlDocumentRootsForInventory(resolved)
      for (const o of roots) {
        const d = kustomizeResourceDescriptorFromManifest(o, kustNs)
        if (d !== null) {
          out.push(d)
        }
      }
      return
    }
    if (!st.isDirectory()) {
      return
    }
    const childK = existsSync(join(resolved, 'kustomization.yaml')) ? join(resolved, 'kustomization.yaml') : null
    if (childK !== null) {
      const sub = await collectResourceDescriptorsForKustomizationWalk(childK, rootNorm, visitedKustomization)
      out.push(...sub)
    }
  }

  for (const ref of pathRefs) {
    await handleResourceDescriptorPathRef(ref)
  }

  return out
}

/**
 * Витягує записи з явним **target** з **patches** / **patchesJson6902**.
 * @param {unknown} obj перший документ Kustomization
 * @returns {Array<{ section: string, index: number, target: unknown }>} пари **section** + індекс (1-based) і **target** з YAML.
 */
function extractExplicitPatchTargetsFromKustomization(obj) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    return []
  }
  const rec = /** @type {Record<string, unknown>} */ (obj)
  /** @type {Array<{ section: string, index: number, target: unknown }>} */
  const out = []
  /**
   * @param {string} section ім’я поля
   * @param {unknown} arr масив з YAML
   * @returns {void}
   */
  const push = (section, arr) => {
    if (!Array.isArray(arr)) {
      return
    }
    let i = 0
    for (const item of arr) {
      i++
      if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
        const it = /** @type {Record<string, unknown>} */ (item)
        if ('target' in it) {
          out.push({ section, index: i, target: it.target })
        }
      }
    }
  }
  push('patches', rec.patches)
  push('patchesJson6902', rec.patchesJson6902)
  return out
}

/**
 * Людинозчитуваний опис **target** для повідомлення про помилку.
 * @param {unknown} target об’єкт **target**
 * @returns {string} короткий рядок
 */
function formatKustomizePatchTargetForMessage(target) {
  if (target === null || typeof target !== 'object' || Array.isArray(target)) {
    return String(target)
  }
  const t = /** @type {Record<string, unknown>} */ (target)
  const parts = []
  const g = t.group
  const v = t.version
  const k = t.kind
  const n = t.name
  const ns = t.namespace
  if (typeof g === 'string' && g.trim() !== '') {
    parts.push(`group=${g.trim()}`)
  }
  if (typeof v === 'string' && v.trim() !== '') {
    parts.push(`version=${v.trim()}`)
  }
  if (typeof k === 'string' && k.trim() !== '') {
    parts.push(`kind=${k.trim()}`)
  }
  if (typeof n === 'string' && n.trim() !== '') {
    parts.push(`name=${n.trim()}`)
  }
  if (typeof ns === 'string' && ns.trim() !== '') {
    parts.push(`namespace=${ns.trim()}`)
  }
  return parts.length > 0 ? parts.join(', ') : JSON.stringify(t)
}

/**
 * Явні **patches[].target** / **patchesJson6902[].target** — ресурс має бути в інвентарі.
 * @param {string} rel відносний шлях до kustomization.yaml
 * @param {Record<string, unknown>} first корінь Kustomization
 * @param {KustomizeResourceDescriptor[]} catalog інвентар resources/bases/…
 * @param {(msg: string) => void} fail реєстрація помилки
 * @returns {void}
 */
function failIfExplicitPatchTargetsNotInCatalog(rel, first, catalog, fail) {
  for (const { section, index, target } of extractExplicitPatchTargetsFromKustomization(first)) {
    if (shouldValidateKustomizePatchTarget(target) && !kustomizeResourceCatalogMatchesPatchTarget(catalog, target)) {
      fail(
        `${rel}: ${section}[${index}].target — немає відповідного ресурсу в resources/bases/components/crds (рекурсивно): ${formatKustomizePatchTargetForMessage(target)}`
      )
    }
  }
}

/**
 * Документи з YAML-файлу мають мати дескриптор у **catalog** (інвентар resources).
 * @param {string} rel відносний шлях до kustomization.yaml
 * @param {string} resolvedAbs абсолютний шлях до patch-файлу
 * @param {string} root корінь репо
 * @param {string} relPatchFallback якщо **relative** дає порожньо
 * @param {string} violationIntro префікс повідомлення (`patches[1] path` або `patchesStrategicMerge[2]`)
 * @param {KustomizeResourceDescriptor[]} catalog інвентар
 * @param {string} kustNs default namespace
 * @param {(msg: string) => void} fail реєстрація помилки
 * @returns {Promise<void>}
 */
async function failIfYamlFileRootsMissingFromCatalog(
  rel,
  resolvedAbs,
  root,
  relPatchFallback,
  violationIntro,
  catalog,
  kustNs,
  fail
) {
  const roots = await readK8sYamlDocumentRootsForInventory(resolvedAbs)
  let docIdx = 0
  for (const o of roots) {
    docIdx++
    const d = kustomizeResourceDescriptorFromManifest(o, kustNs)
    if (d !== null && !catalog.some(c => kustomizeResourceDescriptorsIdentityEqual(c, d))) {
      const relPatch = (relative(root, resolvedAbs) || relPatchFallback).replaceAll('\\', '/')
      fail(
        `${rel}: ${violationIntro} «${relPatch}» документ ${docIdx} — у каталозі resources немає ресурсу ${d.kind}/${d.name} (namespace=${d.namespace || '(порожньо)'}, apiVersion group/version=${d.group || 'core'}/${d.version})`
      )
    }
  }
}

/**
 * Вирішує відносний шлях до існуючого **.yaml** під root і перевіряє, що це файл.
 * @param {string} kustDir каталог kustomization
 * @param {string} pathStr відносний шлях
 * @param {string} rootNorm нормалізований корінь репо
 * @returns {Promise<string | null>} абсолютний шлях або null
 */
async function resolveExistingYamlFileUnderRoot(kustDir, pathStr, rootNorm) {
  const resolved = resolve(kustDir, pathStr)
  if (!resolvedFilePathIsUnderRoot(rootNorm, resolved) || !existsSync(resolved)) {
    return null
  }
  /** @type {import('node:fs').Stats | null} */
  let st = null
  try {
    st = await stat(resolved)
  } catch {
    st = null
  }
  if (st === null || !st.isFile() || !YAML_EXTENSION_RE.test(resolved)) {
    return null
  }
  return resolved
}

/**
 * Один елемент **patches[]** лише з **path** (без **target**, без inline patch): корені файлу проти інвентарю.
 * @param {string} rel відносний шлях до kustomization.yaml
 * @param {unknown} p елемент **patches**
 * @param {number} pIdx 1-based індекс у масиві
 * @param {string} kustDir каталог kustomization.yaml
 * @param {string} rootNorm нормалізований корінь репо
 * @param {string} root корінь репо
 * @param {KustomizeResourceDescriptor[]} catalog інвентар
 * @param {string} kustNs default namespace з kustomization
 * @param {(msg: string) => void} fail реєстрація помилки
 * @returns {Promise<void>}
 */
async function failIfOnePathOnlyPatchNotInCatalog(rel, p, pIdx, kustDir, rootNorm, root, catalog, kustNs, fail) {
  if (p === null || typeof p !== 'object' || Array.isArray(p)) {
    return
  }
  const pr = /** @type {Record<string, unknown>} */ (p)
  const hasTargetKey = 'target' in pr && pr.target !== undefined && pr.target !== null
  const pathStr = typeof pr.path === 'string' ? pr.path.trim() : ''
  const inlinePatch = typeof pr.patch === 'string' && pr.patch.trim() !== ''
  if (hasTargetKey || pathStr === '' || inlinePatch || pathStr.includes('://')) {
    return
  }
  const resolved = await resolveExistingYamlFileUnderRoot(kustDir, pathStr, rootNorm)
  if (resolved === null) {
    return
  }
  await failIfYamlFileRootsMissingFromCatalog(
    rel,
    resolved,
    root,
    pathStr,
    `patches[${pIdx}] path`,
    catalog,
    kustNs,
    fail
  )
}

/**
 * **patches[]** лише з **path** (без **target**, без inline patch) — документи у файлі мають збігатися з інвентарем.
 * @param {string} rel відносний шлях до kustomization.yaml
 * @param {unknown} patches поле **patches**
 * @param {string} kustDir каталог kustomization.yaml
 * @param {string} rootNorm нормалізований корінь репо
 * @param {string} root корінь репо
 * @param {KustomizeResourceDescriptor[]} catalog інвентар
 * @param {string} kustNs default namespace з kustomization
 * @param {(msg: string) => void} fail реєстрація помилки
 * @returns {Promise<void>}
 */
async function failIfPathOnlyPatchesNotInCatalog(rel, patches, kustDir, rootNorm, root, catalog, kustNs, fail) {
  if (!Array.isArray(patches)) {
    return
  }
  let pIdx = 0
  for (const p of patches) {
    pIdx++
    await failIfOnePathOnlyPatchNotInCatalog(rel, p, pIdx, kustDir, rootNorm, root, catalog, kustNs, fail)
  }
}

/**
 * **patchesStrategicMerge** — кожен документ у файлі має збігатися з інвентарем.
 * @param {string} rel відносний шлях до kustomization.yaml
 * @param {unknown} sm поле **patchesStrategicMerge**
 * @param {string} kustDir каталог kustomization.yaml
 * @param {string} rootNorm нормалізований корінь репо
 * @param {string} root корінь репо
 * @param {KustomizeResourceDescriptor[]} catalog інвентар
 * @param {string} kustNs default namespace з kustomization
 * @param {(msg: string) => void} fail реєстрація помилки
 * @returns {Promise<void>}
 */
async function failIfStrategicMergePatchesNotInCatalog(rel, sm, kustDir, rootNorm, root, catalog, kustNs, fail) {
  if (!Array.isArray(sm)) {
    return
  }
  let smIdx = 0
  for (const ref of sm) {
    smIdx++
    if (typeof ref === 'string' && ref.trim() !== '' && !ref.includes('://')) {
      const resolved = await resolveExistingYamlFileUnderRoot(kustDir, ref.trim(), rootNorm)
      if (resolved !== null) {
        await failIfYamlFileRootsMissingFromCatalog(
          rel,
          resolved,
          root,
          ref,
          `patchesStrategicMerge[${smIdx}]`,
          catalog,
          kustNs,
          fail
        )
      }
    }
  }
}

/**
 * Один **`kustomization.yaml`**: patch **target**, **path** без target, **patchesStrategicMerge**.
 * @param {string} root корінь репозиторію
 * @param {string} kustAbs абсолютний шлях до файлу
 * @param {string} rootNorm нормалізований корінь
 * @param {(msg: string) => void} fail реєстрація помилки
 * @returns {Promise<void>}
 */
async function validatePatchTargetsOneKustomizationFile(root, kustAbs, rootNorm, fail) {
  const rel = (relative(root, kustAbs) || kustAbs).replaceAll('\\', '/')
  let raw
  try {
    raw = await readFile(kustAbs, 'utf8')
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    fail(`${rel}: не вдалося прочитати для перевірки patch target (${msg})`)
    return
  }
  const lines = toLines(raw)
  const body = lines.length > 0 && MODELINE_RE.test(lines[0]) ? yamlBodyAfterModeline(lines) : lines.join('\n')
  /** @type {import('yaml').Document[] | null} */
  let docs = null
  try {
    docs = parseAllDocuments(body)
  } catch {
    fail(`${rel}: не вдалося розпарсити YAML для перевірки patch target`)
    return
  }
  const first = docs[0]?.toJSON()
  if (first === null || first === undefined || typeof first !== 'object' || Array.isArray(first)) {
    return
  }
  const rec = /** @type {Record<string, unknown>} */ (first)
  if (rec.kind !== 'Kustomization') {
    return
  }
  const visited = new Set()
  const catalog = await collectResourceDescriptorsForKustomizationWalk(kustAbs, rootNorm, visited)
  const kustDir = dirname(resolve(kustAbs))
  const kustNs = typeof rec.namespace === 'string' && rec.namespace.trim() !== '' ? rec.namespace.trim() : ''
  failIfExplicitPatchTargetsNotInCatalog(rel, first, catalog, fail)
  await failIfPathOnlyPatchesNotInCatalog(rel, rec.patches, kustDir, rootNorm, root, catalog, kustNs, fail)
  await failIfStrategicMergePatchesNotInCatalog(
    rel,
    rec.patchesStrategicMerge,
    kustDir,
    rootNorm,
    root,
    catalog,
    kustNs,
    fail
  )
}

/**
 * Перевіряє всі **`kustomization.yaml`** під **`k8s`**: **target** patch і strategic-merge посилання не вказують на ресурс поза інвентарем **resources** / **bases** / **components** / **crds**.
 * @param {string} root корінь репозиторію
 * @param {string[]} yamlFilesAbs абсолютні шляхи до yaml під k8s
 * @param {(msg: string) => void} fail реєстрація помилки
 * @returns {Promise<void>}
 */
async function validateKustomizationPatchTargetsResolved(root, yamlFilesAbs, fail) {
  const rootNorm = resolve(root)
  for (const kustAbs of yamlFilesAbs.filter(p => basename(p).toLowerCase() === 'kustomization.yaml')) {
    await validatePatchTargetsOneKustomizationFile(root, kustAbs, rootNorm, fail)
  }
}

/**
 * Чи це **`k8s/base/kustomization.yaml`** (перевірка обов’язкового непорожнього **`namespace:`**).
 * @param {string} rel шлях від кореня репозиторію
 * @returns {boolean} true для шляху виду `…/k8s/base/kustomization.yaml`
 */
export function isBaseKustomizationPath(rel) {
  const n = rel.replaceAll('\\', '/')
  return K8S_BASE_KUSTOMIZATION_PATH_RE.test(n)
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
    if (!YAML_EXTENSION_RE.test(p)) return
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
 * Оновлює прапорці наявності **BackendConfig** / інших **kind** у документі.
 * @param {unknown} kind значення **kind**
 * @param {{ hasBc: boolean, hasOther: boolean }} acc накопичувач
 * @returns {void}
 */
function updateBackendConfigKindFlags(kind, acc) {
  if (kind === 'BackendConfig') {
    acc.hasBc = true
    return
  }
  if (kind !== undefined && kind !== null && String(kind).trim() !== '') {
    acc.hasOther = true
  }
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

  const acc = { hasBc: false, hasOther: false }
  for (const doc of docs) {
    if (doc.errors.length === 0) {
      const obj = doc.toJSON()
      if (obj !== null && typeof obj === 'object' && !Array.isArray(obj)) {
        updateBackendConfigKindFlags(obj.kind, acc)
      }
    }
  }

  if (!acc.hasBc) {
    return 'none'
  }
  if (acc.hasOther) {
    return 'mixed'
  }
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
  return body.split(YAML_LINE_SPLIT_RE)
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
  const lines = body.split(YAML_LINE_SPLIT_RE)
  const out = []
  for (const line of lines) {
    if (YAML_DOC_SEPARATOR_LINE_RE.test(line)) {
      break
    }
    out.push(line)
  }
  return out.join('\n').trim()
}

/**
 * Витягує `apiVersion` та `kind` з тексту документа (без повного YAML-парсера).
 * @param {string} doc фрагмент YAML одного документа
 * @returns {{ apiVersion?: string, kind?: string }} знайдені поля або властивості відсутні
 */
function extractApiVersionAndKind(doc) {
  /** @type {string | undefined} */
  let apiVersion
  /** @type {string | undefined} */
  let kind
  for (const line of doc.split(YAML_LINE_SPLIT_RE)) {
    if (apiVersion === undefined) {
      const av = line.match(API_VERSION_FIELD_RE)
      if (av) {
        apiVersion = trimYamlScalarQuotes(av[1])
      }
    }
    if (kind === undefined) {
      const k = line.match(KIND_FIELD_RE)
      if (k) {
        kind = trimYamlScalarQuotes(k[1])
      }
    }
    if (apiVersion !== undefined && kind !== undefined) {
      break
    }
  }
  return { apiVersion, kind }
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
  if (!HEALTHCHECK_DELETE_RE.test(raw)) return false
  if (!HEALTHCHECK_KIND_RE.test(raw)) return false
  if (!METADATA_LINE_RE.test(raw)) return false
  if (!NAME_NON_EMPTY_RE.test(raw)) return false
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
 * Реєструє порушення, якщо в JSON6902-операціях є **remove** і **add** на один **path**.
 * @param {string} rel відносний шлях до kustomization.yaml
 * @param {string} label фрагмент повідомлення (наприклад `patches[1] inline JSON6902`)
 * @param {string} patchText текст patch
 * @param {(msg: string) => void} fail реєстрація порушення
 * @returns {void}
 */
function failIfJson6902RemoveAddConflictOnSamePath(rel, label, patchText, fail) {
  const ops = collectJson6902OperationsFromPatchText(patchText)
  const bad = json6902PathsWithRemoveAndAddOnSamePath(ops)
  if (bad.length > 0) {
    fail(`${rel}: ${label}: один path має і remove, і add — оформи як op: replace (k8s.mdc): ${bad.join(', ')}`)
  }
}

/**
 * Зовнішній patch-файл (масив JSON6902): remove+add на один path.
 * @param {string} rel відносний шлях до kustomization.yaml
 * @param {string} resolved абсолютний шлях до файлу patch
 * @param {string} root корінь репо
 * @param {string} patchRef відносне посилання з kustomization
 * @param {(msg: string) => void} fail реєстрація порушення
 * @returns {Promise<void>}
 */
async function auditJson6902PatchExternalFile(rel, resolved, root, patchRef, fail) {
  /** @type {import('node:fs').Stats | null} */
  let st = null
  try {
    st = await stat(resolved)
  } catch {
    st = null
  }
  if (st === null || !st.isFile()) {
    return
  }
  let pRaw
  try {
    pRaw = await readFile(resolved, 'utf8')
  } catch {
    return
  }
  const ops = collectJson6902OperationsFromPatchText(pRaw)
  if (ops.length === 0) {
    return
  }
  const bad = json6902PathsWithRemoveAndAddOnSamePath(ops)
  if (bad.length === 0) {
    return
  }
  const relPatch = (relative(root, resolved) || patchRef).replaceAll('\\', '/')
  fail(
    `${rel}: patch-файл «${relPatch}»: один path має і remove, і add — оформи як op: replace (k8s.mdc): ${bad.join(', ')}`
  )
}

/**
 * Один елемент **`patches[]`**: inline JSON6902 або зовнішній patch-файл.
 * @param {string} rel відносний шлях до kustomization.yaml
 * @param {Record<string, unknown>} pr об’єкт patch
 * @param {number} patchIdx 1-based індекс у масиві
 * @param {string} kustAbs абсолютний шлях до kustomization.yaml
 * @param {string} rootNorm нормалізований корінь репо
 * @param {string} root корінь репо
 * @param {(msg: string) => void} fail реєстрація порушення
 * @returns {Promise<void>}
 */
async function auditOneKustomizationJson6902Patch(rel, pr, patchIdx, kustAbs, rootNorm, root, fail) {
  if (typeof pr.patch === 'string' && pr.patch.trim() !== '') {
    failIfJson6902RemoveAddConflictOnSamePath(rel, `patches[${patchIdx}] inline JSON6902`, pr.patch, fail)
  }
  if (typeof pr.path !== 'string' || pr.path.trim() === '') {
    return
  }
  const patchRef = pr.path.trim()
  const resolved = resolve(dirname(kustAbs), patchRef)
  if (!resolvedFilePathIsUnderRoot(rootNorm, resolved) || !existsSync(resolved)) {
    return
  }
  await auditJson6902PatchExternalFile(rel, resolved, root, patchRef, fail)
}

/**
 * Усі **`patches[]`** у Kustomization: inline та зовнішні файли.
 * @param {string} rel відносний шлях до kustomization.yaml
 * @param {unknown} patches поле **patches**
 * @param {string} kustAbs абсолютний шлях до kustomization.yaml
 * @param {string} rootNorm нормалізований корінь репо
 * @param {string} root корінь репо
 * @param {(msg: string) => void} fail реєстрація порушення
 * @returns {Promise<void>}
 */
async function auditKustomizationPatchesJson6902(rel, patches, kustAbs, rootNorm, root, fail) {
  if (!Array.isArray(patches)) {
    return
  }
  let patchIdx = 0
  for (const p of patches) {
    patchIdx++
    if (p !== null && typeof p === 'object' && !Array.isArray(p)) {
      const pr = /** @type {Record<string, unknown>} */ (p)
      await auditOneKustomizationJson6902Patch(rel, pr, patchIdx, kustAbs, rootNorm, root, fail)
    }
  }
}

/**
 * Один YAML-документ: якщо це Kustomization — перевірка **patches** на JSON6902 remove+add.
 * @param {string} rel відносний шлях до kustomization.yaml
 * @param {unknown} rootObj корінь документа
 * @param {string} kustAbs абсолютний шлях до kustomization.yaml
 * @param {string} rootNorm нормалізований корінь репо
 * @param {string} root корінь репо
 * @param {(msg: string) => void} fail реєстрація порушення
 * @returns {Promise<void>}
 */
async function auditJson6902ForKustomizationYamlDoc(rel, rootObj, kustAbs, rootNorm, root, fail) {
  const rec = /** @type {Record<string, unknown>} */ (rootObj)
  if (rec.kind !== 'Kustomization') {
    return
  }
  await auditKustomizationPatchesJson6902(rel, rec.patches, kustAbs, rootNorm, root, fail)
}

/**
 * Один **`kustomization.yaml`**: JSON6902 remove+add на одному path.
 * @param {string} root корінь репозиторію
 * @param {string} rootNorm нормалізований корінь
 * @param {string} kustAbs абсолютний шлях до файлу
 * @param {(msg: string) => void} fail реєстрація порушення
 * @returns {Promise<void>}
 */
async function auditJson6902OneKustomizationYamlFile(root, rootNorm, kustAbs, fail) {
  const rel = (relative(root, kustAbs) || kustAbs).replaceAll('\\', '/')
  let raw
  try {
    raw = await readFile(kustAbs, 'utf8')
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    fail(`${rel}: не вдалося прочитати для перевірки JSON6902 (${msg})`)
    return
  }
  const lines = toLines(raw)
  const body = lines.length > 0 && MODELINE_RE.test(lines[0]) ? yamlBodyAfterModeline(lines) : lines.join('\n')
  /** @type {import('yaml').Document[] | null} */
  let docs = null
  try {
    docs = parseAllDocuments(body)
  } catch {
    return
  }
  for (const doc of docs) {
    if (doc.errors.length === 0) {
      const rootObj = doc.toJSON()
      if (rootObj !== null && typeof rootObj === 'object' && !Array.isArray(rootObj)) {
        await auditJson6902ForKustomizationYamlDoc(rel, rootObj, kustAbs, rootNorm, root, fail)
      }
    }
  }
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
  for (const kustAbs of yamlFilesAbs.filter(p => basename(p).toLowerCase() === 'kustomization.yaml')) {
    await auditJson6902OneKustomizationYamlFile(root, rootNorm, kustAbs, fail)
  }
}

/**
 * Заборонений **kind: Ingress** у документі.
 * @param {string} rel відносний шлях до файлу
 * @param {number} docIndex 1-based індекс документа
 * @param {Record<string, unknown>} rec корінь маніфесту
 * @param {(msg: string) => void} fail реєстрація помилки
 * @returns {void}
 */
function failIfIngressInDocument(rel, docIndex, rec, fail) {
  if (rec.kind !== 'Ingress') {
    return
  }
  fail(
    `${rel}: знайдено kind: Ingress (документ ${docIndex}) — заміни на Gateway API: HTTPRoute (hr.yaml), HealthCheckPolicy (hc.yaml) (див. k8s.mdc)`
  )
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
        failIfIngressInDocument(rel, di + 1, /** @type {Record<string, unknown>} */ (obj), fail)
      }
    }
  }
}

/**
 * Перевірка поля **resources** для одного контейнера **Deployment**.
 * @param {unknown} c елемент **containers[]**
 * @param {string} label підпис у повідомленні
 * @returns {string | null} текст порушення або null
 */
function deploymentContainerResourcesViolation(c, label) {
  if (c === null || c === undefined || typeof c !== 'object' || Array.isArray(c)) {
    return null
  }
  const cont = /** @type {Record<string, unknown>} */ (c)
  if (!('resources' in cont)) {
    return `контейнер "${label}": відсутнє поле resources — додай resources: {} (див. k8s.mdc)`
  }
  const r = cont.resources
  if (r === null || typeof r !== 'object' || Array.isArray(r)) {
    return `контейнер "${label}": resources має бути записом у YAML (наприклад порожній: resources: {})`
  }
  return null
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
    const v = deploymentContainerResourcesViolation(c, label)
    if (v !== null) {
      return v
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
  return HASURA_GRAPHQL_ENGINE_RE.test(s)
}

/**
 * Перевірка образу Hasura для одного контейнера у списку **containers** / **initContainers**.
 * @param {string} list ім’я поля для повідомлення (`containers` / `initContainers`)
 * @param {unknown} c елемент масиву
 * @param {number} i індекс
 * @returns {string | null} текст порушення або null
 */
function hasuraGraphqlEngineViolationForOneContainer(list, c, i) {
  const label =
    typeof c === 'object' && c !== null && !Array.isArray(c) && typeof c.name === 'string' && c.name !== ''
      ? c.name
      : `#${i + 1}`
  if (c === null || c === undefined || typeof c !== 'object' || Array.isArray(c)) {
    return null
  }
  const cont = /** @type {Record<string, unknown>} */ (c)
  const image = cont.image
  if (typeof image !== 'string' || image.trim() === '' || !isHasuraGraphqlEngineImageRef(image)) {
    return null
  }
  const normalized = stripImageDigest(image)
  if (!HASURA_GRAPHQL_ENGINE_ALLOWED_IMAGES.has(normalized)) {
    return `${list} "${label}": образ hasura/graphql-engine має бути ${HASURA_GRAPHQL_ENGINE_IMAGE} (зараз: ${image}) (див. k8s.mdc)`
  }
  return null
}

/**
 * Перевіряє масив **containers** / **initContainers** на зафіксований образ Hasura.
 * @param {string} list **containers** або **initContainers** (для тексту помилки)
 * @param {unknown} containers значення поля з маніфесту
 * @returns {string | null} текст порушення або null
 */
function hasuraGraphqlEngineViolationInContainerList(list, containers) {
  if (!Array.isArray(containers)) return null
  for (const [i, c] of containers.entries()) {
    const v = hasuraGraphqlEngineViolationForOneContainer(list, c, i)
    if (v !== null) {
      return v
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
 * Чи у списку контейнерів є хоча б один з образом **hasura/graphql-engine** (будь-який тег).
 * @param {unknown} containers значення **containers** / **initContainers** із podSpec
 * @returns {boolean} true — якщо знайдено хоча б один контейнер з образом Hasura
 */
function containerListHasHasuraImage(containers) {
  if (!Array.isArray(containers)) return false
  for (const c of containers) {
    if (c !== null && typeof c === 'object' && !Array.isArray(c)) {
      const image = /** @type {Record<string, unknown>} */ (c).image
      if (typeof image === 'string' && image !== '' && isHasuraGraphqlEngineImageRef(image)) return true
    }
  }
  return false
}

/**
 * Чи **Deployment** використовує образ **hasura/graphql-engine** у будь-якому контейнері (маркер для прив'язки HTTPRoute-канона).
 * @param {unknown} manifest корінь YAML-документа
 * @returns {boolean} true — для Deployment з Hasura-контейнером у containers / initContainers
 */
export function isHasuraDeploymentManifest(manifest) {
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) return false
  const rec = /** @type {Record<string, unknown>} */ (manifest)
  if (rec.kind !== 'Deployment') return false
  const spec = rec.spec
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) return false
  const template = /** @type {Record<string, unknown>} */ (spec).template
  if (template === null || typeof template !== 'object' || Array.isArray(template)) return false
  const podSpec = /** @type {Record<string, unknown>} */ (template).spec
  if (podSpec === null || typeof podSpec !== 'object' || Array.isArray(podSpec)) return false
  const p = /** @type {Record<string, unknown>} */ (podSpec)
  return containerListHasHasuraImage(p.containers) || containerListHasHasuraImage(p.initContainers)
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
 * Один документ: маршрут Gateway API має посилатися на **Service** з суфіксом **`-hl`**.
 * @param {string} rel відносний шлях до файлу
 * @param {number} docIndex 1-based індекс документа
 * @param {Record<string, unknown>} rec корінь маніфесту
 * @param {(msg: string) => void} fail callback помилки
 * @returns {void}
 */
function failIfGatewayRouteUsesNonHeadlessService(rel, docIndex, rec, fail) {
  const av = rec.apiVersion
  const kind = rec.kind
  if (
    typeof av !== 'string' ||
    !av.startsWith(GATEWAY_API_GROUP_PREFIX) ||
    typeof kind !== 'string' ||
    !GATEWAY_API_ROUTE_KINDS.has(kind)
  ) {
    return
  }
  const names = collectGatewayApiRouteBackendServiceNames(rec.spec)
  for (const svcName of names) {
    if (!svcName.endsWith(SVC_HL_NAME_SUFFIX)) {
      fail(
        `${rel}: Gateway API ${kind} (документ ${docIndex}): backendRef до Service має вказувати headless-сервіс з суфіксом «${SVC_HL_NAME_SUFFIX}» у name (зараз: «${svcName}»; див. k8s.mdc)`
      )
    }
  }
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
        failIfGatewayRouteUsesNonHeadlessService(rel, di + 1, /** @type {Record<string, unknown>} */ (obj), fail)
      }
    }
  }
}

/**
 * Звузити `unknown` до `Record<string, unknown>` (`null`, масиви, примітиви → null).
 * @param {unknown} node довільний вузол YAML-документа
 * @returns {Record<string, unknown> | null} plain-об'єкт або null, якщо це не plain-запис
 */
function asPlainRecord(node) {
  if (node === null || node === undefined || typeof node !== 'object' || Array.isArray(node)) return null
  return /** @type {Record<string, unknown>} */ (node)
}

/**
 * Чи `match` — рівно один шлях заданого типу з потрібним значенням, **без** `headers`.
 * @param {unknown} rule одне правило `HTTPRoute`
 * @param {'Exact' | 'PathPrefix'} pathType очікуваний `path.type`
 * @param {string} pathValue очікуваний `path.value`
 * @returns {boolean} true — якщо `matches` рівно один і відповідає критерію
 */
function hasuraRuleMatchesSinglePathNoHeaders(rule, pathType, pathValue) {
  const r = asPlainRecord(rule)
  if (r === null) return false
  const matches = r.matches
  if (!Array.isArray(matches) || matches.length !== 1) return false
  const m = asPlainRecord(matches[0])
  if (m === null) return false
  if (m.headers !== undefined) return false
  const p = asPlainRecord(m.path)
  if (p === null) return false
  return p.type === pathType && p.value === pathValue
}

/**
 * Чи **filters** — рівно один `RequestRedirect` з `ReplaceFullPath` на `toPath` і `statusCode: 302`.
 * @param {unknown} rule одне правило `HTTPRoute`
 * @param {string} toPath очікуваний `requestRedirect.path.replaceFullPath`
 * @returns {boolean} true — якщо filters відповідають канону редиректу
 */
function hasuraRuleHasExactRedirect(rule, toPath) {
  const r = asPlainRecord(rule)
  if (r === null) return false
  const filters = r.filters
  if (!Array.isArray(filters) || filters.length !== 1) return false
  const f = asPlainRecord(filters[0])
  if (f === null || f.type !== 'RequestRedirect') return false
  const rr = asPlainRecord(f.requestRedirect)
  if (rr === null || rr.statusCode !== 302) return false
  const p = asPlainRecord(rr.path)
  return p !== null && p.type === 'ReplaceFullPath' && p.replaceFullPath === toPath
}

/**
 * Чи серед **filters** є `URLRewrite` з `ReplacePrefixMatch: /`.
 * @param {unknown[]} filters масив filters з одного правила `HTTPRoute`
 * @returns {boolean} true — якщо фільтр `URLRewrite` має `ReplacePrefixMatch: /`
 */
function hasuraFiltersIncludeUrlRewriteToSlash(filters) {
  for (const f of filters) {
    const fr = asPlainRecord(f)
    if (fr !== null && fr.type === 'URLRewrite') {
      const rw = asPlainRecord(fr.urlRewrite)
      if (rw === null) return false
      const p = asPlainRecord(rw.path)
      return p !== null && p.type === 'ReplacePrefixMatch' && p.replacePrefixMatch === '/'
    }
  }
  return false
}

/**
 * Чи серед **filters** є `RequestHeaderModifier` з `remove: [Authorization]`.
 * @param {unknown[]} filters масив filters з одного правила `HTTPRoute`
 * @returns {boolean} true — якщо фільтр `RequestHeaderModifier` видаляє саме `Authorization`
 */
function hasuraFiltersRemoveAuthorization(filters) {
  for (const f of filters) {
    const fr = asPlainRecord(f)
    if (fr !== null && fr.type === 'RequestHeaderModifier') {
      const mod = asPlainRecord(fr.requestHeaderModifier)
      if (mod === null) return false
      const remove = mod.remove
      if (!Array.isArray(remove) || remove.length !== 1) return false
      return remove[0] === 'Authorization'
    }
  }
  return false
}

/**
 * Ім'я єдиного `backendRef` у правилі (або null, якщо backend-ів не рівно один).
 * @param {unknown} rule одне правило `HTTPRoute`
 * @returns {string | null} `backendRefs[0].name` або null, якщо backend-ів не рівно один
 */
function hasuraRuleSingleBackendName(rule) {
  const r = asPlainRecord(rule)
  if (r === null) return null
  const refs = r.backendRefs
  if (!Array.isArray(refs) || refs.length !== 1) return null
  const b = asPlainRecord(refs[0])
  if (b === null || typeof b.name !== 'string') return null
  return b.name
}

/**
 * Правило 3: `PathPrefix <qlPath>` + **filters** = 1 × `URLRewrite(ReplacePrefixMatch: /)`.
 * @param {unknown} rule одне правило `HTTPRoute`
 * @param {string} qlPath очікуваний `path.value` (`<prefix>/ql`)
 * @returns {boolean} true — якщо правило відповідає канону пункту 3
 */
function hasuraRuleIsQlUrlRewrite(rule, qlPath) {
  if (!hasuraRuleMatchesSinglePathNoHeaders(rule, 'PathPrefix', qlPath)) return false
  const r = asPlainRecord(rule)
  if (r === null) return false
  const filters = r.filters
  if (!Array.isArray(filters) || filters.length !== 1) return false
  return hasuraFiltersIncludeUrlRewriteToSlash(filters)
}

/**
 * Правило 4: WebSocket — `PathPrefix <qlPath>` + `Upgrade: websocket`, **filters** = `URLRewrite` + `RequestHeaderModifier(remove Authorization)`.
 * @param {unknown} rule одне правило `HTTPRoute`
 * @param {string} qlPath очікуваний `path.value` (`<prefix>/ql`)
 * @returns {boolean} true — якщо правило відповідає канону пункту 4 (WebSocket)
 */
function hasuraRuleIsWebsocket(rule, qlPath) {
  const r = asPlainRecord(rule)
  if (r === null) return false
  const matches = r.matches
  if (!Array.isArray(matches) || matches.length !== 1) return false
  const m = asPlainRecord(matches[0])
  if (m === null) return false
  const p = asPlainRecord(m.path)
  if (p === null || p.type !== 'PathPrefix' || p.value !== qlPath) return false
  const headers = m.headers
  if (!Array.isArray(headers) || headers.length !== 1) return false
  const h = asPlainRecord(headers[0])
  if (h === null || h.type !== 'Exact' || h.name !== 'Upgrade' || h.value !== 'websocket') return false
  const filters = r.filters
  if (!Array.isArray(filters) || filters.length !== 2) return false
  return hasuraFiltersIncludeUrlRewriteToSlash(filters) && hasuraFiltersRemoveAuthorization(filters)
}

/**
 * Знаходить перше правило з **`matches`** = `[{ path: { type: 'Exact', value: '<prefix>/ql' } }]` (без headers),
 * повертає `<prefix>` (може бути порожнім) і позицію правила 1.
 * @param {unknown[]} rules вміст `spec.rules` HTTPRoute
 * @returns {{ prefix: string, startIndex: number } | null} виявлений префікс і позиція правила 1 або null
 */
function findHasuraCanonStart(rules) {
  for (const [i, rule] of rules.entries()) {
    const r = asPlainRecord(rule)
    const matches = r === null ? null : r.matches
    if (!Array.isArray(matches) || matches.length !== 1) {
      // наступне правило
    } else {
      const m = asPlainRecord(matches[0])
      const p = m === null || m.headers !== undefined ? null : asPlainRecord(m.path)
      if (
        p !== null &&
        p.type === 'Exact' &&
        typeof p.value === 'string' &&
        p.value.endsWith('/ql')
      ) {
        return { prefix: p.value.slice(0, -'/ql'.length), startIndex: i }
      }
    }
  }
  return null
}

/**
 * Знаходить перше правило за індексом ≥ `from`, що задовольняє `predicate`. Повертає індекс або -1.
 * @param {unknown[]} rules вміст `spec.rules` HTTPRoute
 * @param {number} from мінімальний індекс, з якого починати пошук
 * @param {(rule: unknown) => boolean} predicate предикат на одне правило
 * @returns {number} індекс знайденого правила або -1
 */
function findHasuraRule(rules, from, predicate) {
  for (let i = from; i < rules.length; i++) {
    if (predicate(rules[i])) return i
  }
  return -1
}

/**
 * Чи **`HTTPRoute`** порушує канон 4 правил Hasura (див. k8s.mdc).
 * Повертає текст порушення або null, якщо канон витримано. Додаткові правила поверх канону допускаються.
 * @param {unknown} manifest корінь YAML-документа
 * @returns {string | null} текст порушення або null, якщо канон витримано
 */
export function httpRouteHasuraCanonViolation(manifest) {
  const rec = asPlainRecord(manifest)
  if (rec === null) return null
  const spec = asPlainRecord(rec.spec)
  if (spec === null) return 'HTTPRoute без spec — канон Hasura вимагає 4 правил (див. k8s.mdc)'
  const rules = spec.rules
  if (!Array.isArray(rules) || rules.length === 0) {
    return 'spec.rules порожній — канон Hasura вимагає 4 правил у порядку (див. k8s.mdc)'
  }
  const start = findHasuraCanonStart(rules)
  if (start === null) {
    return 'не знайдено правило 1 Hasura-канона: Exact "<prefix>/ql" + RequestRedirect ReplaceFullPath "<prefix>/ql/console" statusCode 302 (див. k8s.mdc)'
  }
  const { prefix, startIndex } = start
  const qlPath = `${prefix}/ql`
  const qlSlashPath = `${prefix}/ql/`
  const consolePath = `${prefix}/ql/console`

  if (!hasuraRuleHasExactRedirect(rules[startIndex], consolePath)) {
    return `правило 1 Hasura-канона (rules[${startIndex}], prefix «${prefix}»): Exact "${qlPath}" має мати RequestRedirect ReplaceFullPath "${consolePath}" statusCode 302 (див. k8s.mdc)`
  }

  const i2 = findHasuraRule(
    rules,
    startIndex + 1,
    r => hasuraRuleMatchesSinglePathNoHeaders(r, 'Exact', qlSlashPath) && hasuraRuleHasExactRedirect(r, consolePath)
  )
  if (i2 === -1) {
    return `правило 2 Hasura-канона: після правила 1 має бути Exact "${qlSlashPath}" + RequestRedirect ReplaceFullPath "${consolePath}" statusCode 302 (див. k8s.mdc)`
  }

  const i3 = findHasuraRule(
    rules,
    i2 + 1,
    r => hasuraRuleIsQlUrlRewrite(r, qlPath) && hasuraRuleSingleBackendName(r) !== null
  )
  if (i3 === -1) {
    return `правило 3 Hasura-канона: після правила 2 має бути PathPrefix "${qlPath}" + URLRewrite ReplacePrefixMatch "/" + один backendRef на headless Service (див. k8s.mdc)`
  }
  const backendName = /** @type {string} */ (hasuraRuleSingleBackendName(rules[i3]))

  const i4 = findHasuraRule(
    rules,
    i3 + 1,
    r => hasuraRuleIsWebsocket(r, qlPath) && hasuraRuleSingleBackendName(r) === backendName
  )
  if (i4 === -1) {
    return `правило 4 Hasura-канона (WebSocket): після правила 3 має бути PathPrefix "${qlPath}" + header "Upgrade: websocket" + URLRewrite ReplacePrefixMatch "/" + RequestHeaderModifier remove [Authorization] + backendRef «${backendName}» (див. k8s.mdc)`
  }

  return null
}

/**
 * Збирає **`metadata.name`** для **kind: Service** у коренях документів; при помилці викликає **fail** і повертає false.
 * @param {Record<string, unknown>[]} roots корені YAML-документів
 * @param {string} relForMsg відносний шлях до файлу для повідомлення
 * @param {string} fileLabel **svc.yaml** / **svc-hl.yaml**
 * @param {string[]} names накопичувач імен
 * @param {(msg: string) => void} fail реєстрація помилки
 * @returns {boolean} false, якщо зафіксовано порушення
 */
function appendServiceNamesFromSvcRoots(roots, relForMsg, fileLabel, names, fail) {
  for (const [i, rootObj] of roots.entries()) {
    const r = /** @type {Record<string, unknown>} */ (rootObj)
    if (r.kind === 'Service') {
      const meta = r.metadata
      if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) {
        fail(`${relForMsg}: ${fileLabel} (документ ${i + 1}): Service без metadata (див. k8s.mdc)`)
        return false
      }
      const nm = /** @type {Record<string, unknown>} */ (meta).name
      if (typeof nm !== 'string') {
        fail(`${relForMsg}: ${fileLabel} (документ ${i + 1}): Service без metadata.name (див. k8s.mdc)`)
        return false
      }
      names.push(nm)
    }
  }
  return true
}

/**
 * Узгодженість імен **Service** між **svc.yaml** та **svc-hl.yaml**.
 * @param {string} relSvc відносний шлях до **svc.yaml**
 * @param {string} relHl відносний шлях до **svc-hl.yaml**
 * @param {string[]} svcNames імена з **svc.yaml**
 * @param {string[]} hlNames імена з **svc-hl.yaml**
 * @param {(msg: string) => void} fail реєстрація помилки
 * @returns {void}
 */
function validateSvcHlServiceNamePairing(relSvc, relHl, svcNames, hlNames, fail) {
  if (svcNames.length === 0) {
    fail(`${relSvc}: svc.yaml має містити принаймні один kind: Service (див. k8s.mdc)`)
    return
  }
  if (hlNames.length === 0) {
    fail(`${relHl}: svc-hl.yaml має містити принаймні один kind: Service (див. k8s.mdc)`)
    return
  }
  const hlSet = new Set(hlNames)
  for (const n of svcNames) {
    const expectHl = `${n}${SVC_HL_NAME_SUFFIX}`
    if (!hlSet.has(expectHl)) {
      fail(
        `${relSvc}: для Service «${n}» у svc.yaml у svc-hl.yaml має бути Service з metadata.name «${expectHl}» (див. k8s.mdc)`
      )
    }
  }
  for (const h of hlNames) {
    if (h.endsWith(SVC_HL_NAME_SUFFIX)) {
      const base = h.slice(0, -SVC_HL_NAME_SUFFIX.length)
      if (!svcNames.includes(base)) {
        fail(
          `${relHl}: Service «${h}» у svc-hl.yaml не відповідає жодному Service у svc.yaml (очікується базове ім’я «${base}»; див. k8s.mdc)`
        )
      }
    } else {
      fail(
        `${relHl}: Service «${h}» у svc-hl.yaml: metadata.name має закінчуватися на «${SVC_HL_NAME_SUFFIX}» (див. k8s.mdc)`
      )
    }
  }
}

/**
 * **svc-hl.yaml** без **svc.yaml** у тому самому каталозі.
 * @param {string} root корінь репозиторію
 * @param {string[]} yamlFiles абсолютні шляхи
 * @param {Set<string>} absSet той самий набір шляхів
 * @param {(msg: string) => void} fail реєстрація помилки
 * @returns {void}
 */
function failIfSvcHlWithoutSiblingSvc(root, yamlFiles, absSet, fail) {
  for (const abs of yamlFiles.filter(p => basename(p).toLowerCase() === 'svc-hl.yaml')) {
    const svcAbs = join(dirname(abs), 'svc.yaml')
    if (!absSet.has(svcAbs)) {
      const rel = (relative(root, abs) || abs).replaceAll('\\', '/')
      fail(`${rel}: svc-hl.yaml потребує svc.yaml у тому самому каталозі (див. k8s.mdc)`)
    }
  }
}

/**
 * Одна пара **svc.yaml** / **svc-hl.yaml**: читання, імена **Service**, узгодженість.
 * @param {string} root корінь репозиторію
 * @param {Set<string>} absSet наявні yaml під k8s
 * @param {string} svcAbs абсолютний шлях до **svc.yaml**
 * @param {(msg: string) => void} fail реєстрація помилки
 * @returns {Promise<void>}
 */
async function validateOneSvcYamlHlPair(root, absSet, svcAbs, fail) {
  const rel = (relative(root, svcAbs) || svcAbs).replaceAll('\\', '/')
  const hlAbs = join(dirname(svcAbs), 'svc-hl.yaml')
  if (!absSet.has(hlAbs)) {
    fail(`${rel}: поруч обов’язковий svc-hl.yaml (headless-копія з суфіксом -hl у metadata.name; див. k8s.mdc)`)
    return
  }
  const hlRel = (relative(root, hlAbs) || hlAbs).replaceAll('\\', '/')
  let svcBody
  let hlBody
  try {
    svcBody = await readK8sYamlBodyAfterModelineForSvcPair(svcAbs)
    hlBody = await readK8sYamlBodyAfterModelineForSvcPair(hlAbs)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    fail(`${rel}: не вдалося прочитати svc.yaml / svc-hl.yaml (${msg})`)
    return
  }
  const svcRoots = parseK8sYamlDocumentObjectRoots(svcBody)
  const hlRoots = parseK8sYamlDocumentObjectRoots(hlBody)
  /** @type {string[]} */
  const svcNames = []
  if (!appendServiceNamesFromSvcRoots(svcRoots, rel, 'svc.yaml', svcNames, fail)) {
    return
  }
  /** @type {string[]} */
  const hlNames = []
  if (!appendServiceNamesFromSvcRoots(hlRoots, hlRel, 'svc-hl.yaml', hlNames, fail)) {
    return
  }
  validateSvcHlServiceNamePairing(rel, hlRel, svcNames, hlNames, fail)
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
  failIfSvcHlWithoutSiblingSvc(root, yamlFiles, absSet, fail)
  for (const svcAbs of yamlFiles.filter(p => basename(p).toLowerCase() === 'svc.yaml')) {
    await validateOneSvcYamlHlPair(root, absSet, svcAbs, fail)
  }
}

/**
 * Індексує Hasura-Deployment-и за каталогом (ключ — абсолютний шлях каталогу, значення — множина `metadata.name`).
 * Паралельно збирає всі `kind: HTTPRoute` Gateway API (`gateway.networking.k8s.io/*`) із doc-індексом.
 * @param {string[]} yamlFiles абсолютні шляхи до `*.yaml` під `k8s`
 * @returns {Promise<{
 *   hasuraByDir: Map<string, Set<string>>,
 *   httpRoutes: { abs: string, dir: string, docIndex: number, obj: Record<string, unknown> }[]
 * }>} індекс Hasura-Deployment-ів за каталогом і список HTTPRoute-документів
 */
async function collectHasuraDeploymentsAndHttpRoutes(yamlFiles) {
  /** @type {Map<string, Set<string>>} */
  const hasuraByDir = new Map()
  /** @type {{ abs: string, dir: string, docIndex: number, obj: Record<string, unknown> }[]} */
  const httpRoutes = []

  for (const abs of yamlFiles) {
    await indexOneK8sYamlForHasuraCanon(abs, hasuraByDir, httpRoutes)
  }

  return { hasuraByDir, httpRoutes }
}

/**
 * Читає один YAML і додає Hasura-Deployment-и / HTTPRoute-документи до відповідних колекцій (нещасливі читання ігнорує).
 * @param {string} abs абсолютний шлях до файлу
 * @param {Map<string, Set<string>>} hasuraByDir індекс Hasura Deployment-ів за каталогом
 * @param {{ abs: string, dir: string, docIndex: number, obj: Record<string, unknown> }[]} httpRoutes колектор HTTPRoute-документів
 * @returns {Promise<void>}
 */
async function indexOneK8sYamlForHasuraCanon(abs, hasuraByDir, httpRoutes) {
  let raw
  try {
    raw = await readFile(abs, 'utf8')
  } catch {
    return
  }
  const lines = toLines(raw)
  const body = lines.length > 0 && MODELINE_RE.test(lines[0]) ? yamlBodyAfterModeline(lines) : lines.join('\n')
  /** @type {import('yaml').Document[]} */
  let docs
  try {
    docs = parseAllDocuments(body)
  } catch {
    return
  }
  const dir = dirname(abs)

  for (const [di, doc] of docs.entries()) {
    if (doc.errors.length === 0) {
      const rec = asPlainRecord(doc.toJSON())
      if (rec !== null) {
        recordHasuraDeploymentName(rec, dir, hasuraByDir)
        const av = rec.apiVersion
        if (rec.kind === 'HTTPRoute' && typeof av === 'string' && av.startsWith(GATEWAY_API_GROUP_PREFIX)) {
          httpRoutes.push({ abs, dir, docIndex: di + 1, obj: rec })
        }
      }
    }
  }
}

/**
 * Якщо документ — Hasura-Deployment із непорожнім `metadata.name`, додає ім'я до індексу за каталогом.
 * @param {Record<string, unknown>} rec корінь YAML-документа
 * @param {string} dir абсолютний шлях до каталогу файлу
 * @param {Map<string, Set<string>>} hasuraByDir індекс Hasura Deployment-ів за каталогом (під час обходу в нього додаються імена)
 * @returns {void}
 */
function recordHasuraDeploymentName(rec, dir, hasuraByDir) {
  if (!isHasuraDeploymentManifest(rec)) return
  const meta = asPlainRecord(rec.metadata)
  const name = meta === null ? undefined : meta.name
  if (typeof name !== 'string' || name === '') return
  let set = hasuraByDir.get(dir)
  if (set === undefined) {
    set = new Set()
    hasuraByDir.set(dir, set)
  }
  set.add(name)
}

/**
 * Для кожного `kind: HTTPRoute`, що прив'язаний до **Hasura-Deployment** у тому самому каталозі за **`metadata.name`**,
 * звіряє канон 4 правил (див. `httpRouteHasuraCanonViolation` і k8s.mdc).
 * @param {string} root корінь репозиторію
 * @param {string[]} yamlFiles абсолютні шляхи до `*.yaml` під `k8s`
 * @param {(msg: string) => void} fail callback реєстрації помилки
 * @returns {Promise<void>}
 */
async function validateHasuraHttpRouteCanon(root, yamlFiles, fail) {
  const { hasuraByDir, httpRoutes } = await collectHasuraDeploymentsAndHttpRoutes(yamlFiles)
  if (hasuraByDir.size === 0 || httpRoutes.length === 0) return

  for (const hr of httpRoutes) {
    const meta = asPlainRecord(hr.obj.metadata)
    const name = meta === null ? undefined : meta.name
    const set = typeof name === 'string' && name !== '' ? hasuraByDir.get(hr.dir) : undefined
    if (set !== undefined && typeof name === 'string' && set.has(name)) {
      const v = httpRouteHasuraCanonViolation(hr.obj)
      if (v !== null) {
        const rel = (relative(root, hr.abs) || hr.abs).replaceAll('\\', '/')
        fail(`${rel}: HTTPRoute «${name}» (документ ${hr.docIndex}; прив'язано до Hasura-Deployment у тому ж каталозі): ${v}`)
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
  return K8S_BASE_SEGMENT_RE.test(n)
}

/**
 * Правила **metadata.namespace** для одного документа.
 * @param {string} rel відносний шлях
 * @param {number} docIndex 1-based
 * @param {unknown} obj корінь документа
 * @param {boolean} skipMetaNs пропуск для **kustomization.yaml**
 * @param {boolean} inBaseManifest файл у **k8s/base/**
 * @param {boolean} kustomizeManaged файл у графі kustomization
 * @param {(msg: string) => void} fail реєстрація помилки
 * @returns {void}
 */
function failIfK8sPolicyNamespaceRulesViolated(rel, docIndex, obj, skipMetaNs, inBaseManifest, kustomizeManaged, fail) {
  if (skipMetaNs) {
    return
  }
  if (inBaseManifest) {
    const req = metadataNamespaceRequiredViolation(obj, true)
    if (req !== null) {
      fail(`${rel}: документ ${docIndex}: ${req}`)
    }
    return
  }
  if (kustomizeManaged) {
    const ns = metadataNamespaceForbiddenViolation(obj)
    if (ns !== null) {
      fail(`${rel}: документ ${docIndex}: ${ns}`)
    }
    return
  }
  const req = metadataNamespaceRequiredViolation(obj, false)
  if (req !== null) {
    fail(`${rel}: документ ${docIndex}: ${req}`)
  }
}

/**
 * Deployment / Service / HealthCheckPolicy — політики для одного документа.
 * @param {string} rel відносний шлях
 * @param {string} baseLower basename (нижній регістр)
 * @param {number} docIndex 1-based
 * @param {unknown} obj корінь документа
 * @param {(msg: string) => void} fail реєстрація помилки
 * @returns {void}
 */
function failIfK8sPolicyResourceRulesViolated(rel, baseLower, docIndex, obj, fail) {
  const resV = deploymentResourcesViolation(obj)
  if (resV !== null) {
    fail(`${rel}: Deployment (документ ${docIndex}): ${resV}`)
  }
  const hasuraV = deploymentHasuraGraphqlEngineImageViolation(obj)
  if (hasuraV !== null) {
    fail(`${rel}: Deployment (документ ${docIndex}): ${hasuraV}`)
  }
  const svcGcpV = serviceForbiddenGcpAnnotationsViolation(obj)
  if (svcGcpV !== null) {
    fail(`${rel}: Service (документ ${docIndex}): ${svcGcpV}`)
  }
  if (baseLower === 'svc.yaml') {
    const svcT = serviceSvcYamlClusterIpTypeViolation(obj)
    if (svcT !== null) {
      fail(`${rel}: Service (документ ${docIndex}): ${svcT}`)
    }
  }
  if (baseLower === 'svc-hl.yaml') {
    const svcH = serviceSvcHlYamlHeadlessViolation(obj)
    if (svcH !== null) {
      fail(`${rel}: Service (документ ${docIndex}): ${svcH}`)
    }
  }
  const hcpHl = healthCheckPolicyTargetRefHeadlessServiceViolation(obj)
  if (hcpHl !== null) {
    fail(`${rel}: документ ${docIndex}: ${hcpHl}`)
  }
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
      failIfK8sPolicyNamespaceRulesViolated(rel, di + 1, obj, skipMetaNs, inBaseManifest, kustomizeManaged, fail)
      failIfK8sPolicyResourceRulesViolated(rel, baseLower, di + 1, obj, fail)
    }
  }
}

/**
 * Kind для імен файлів yannh/datree: лише літери та цифри, нижній регістр (Service → service, HTTPRoute → httproute).
 * @param {string} kind значення поля kind
 * @returns {string} рядок для шаблону імені файлу схеми
 */
function kindToSchemaFilePart(kind) {
  let out = ''
  for (const ch of kind) {
    const c = ch.codePointAt(0)
    if (c !== undefined && ((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122))) {
      out += ch
    }
  }
  return out.toLowerCase()
}

/**
 * Очікуваний URL схеми за **apiVersion/kind** (не **kustomization.yaml**).
 * @param {string} doc текст першого документа
 * @param {string} apiVersion значення **apiVersion** з маніфесту
 * @param {string} kind значення **kind** з маніфесту
 * @returns {{ expected: string | null, reason: string }} очікуваний URL і пояснення для повідомлень
 */
function expectedSchemaUrlForTypedManifest(doc, apiVersion, kind) {
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

  return expectedSchemaUrlForTypedManifest(doc, apiVersion, kind)
}

/**
 * Підраховує рядки з modeline $schema у файлі.
 * @param {string[]} lines рядки файлу
 * @returns {number} скільки рядків містять modeline `$schema`
 */
function countSchemaModelines(lines) {
  return lines.filter(l => OXLINT_SCHEMA_MODELINE_RE.test(l.trim())).length
}

/**
 * Політики маніфестів і Gateway backendRefs після розбору тіла.
 * @param {string} rel відносний шлях
 * @param {string} baseLower basename (нижній регістр)
 * @param {string} body YAML після modeline
 * @param {(msg: string) => void} fail реєстрація помилки
 * @param {Set<string>} kustomizeManagedRel kustomize-managed шляхи
 * @returns {void}
 */
function runK8sYamlPolicyAndGatewayScans(rel, baseLower, body, fail, kustomizeManagedRel) {
  const kustomizeManaged = kustomizeManagedRel.has(rel)
  validateK8sYamlPolicyDocuments(rel, baseLower, body, fail, kustomizeManaged)
  scanGatewayApiRouteBackendRefsInYamlBody(rel, body, fail)
}

/**
 * Файл з першим документом **HttpBackendGroup** (ALB Yandex): без modeline **$schema**.
 * @param {string} rel відносний шлях
 * @param {string} baseLower basename
 * @param {string[]} lines рядки файлу
 * @param {(msg: string) => void} fail реєстрація помилки
 * @param {(msg: string) => void} pass реєстрація успіху
 * @param {Set<string>} kustomizeManagedRel kustomize-managed шляхи
 * @returns {void}
 */
function checkK8sYamlHttpBackendGroupFile(rel, baseLower, lines, fail, pass, kustomizeManagedRel) {
  const body = lines.join('\n')
  scanIngressInYamlDocuments(rel, body, fail)
  pass(`${rel}: HttpBackendGroup (alb.yc.io/v1alpha1) — modeline $schema не застосовується (k8s.mdc)`)
  runK8sYamlPolicyAndGatewayScans(rel, baseLower, body, fail, kustomizeManagedRel)
}

/**
 * Стандартний файл: перший рядок — modeline **$schema**, далі перевірка URL і політики.
 * @param {string} abs абсолютний шлях
 * @param {string} rel відносний шлях
 * @param {string} baseLower basename
 * @param {string[]} lines рядки файлу
 * @param {(msg: string) => void} fail реєстрація помилки
 * @param {(msg: string) => void} pass реєстрація успіху
 * @param {Set<string>} kustomizeManagedRel kustomize-managed шляхи
 * @returns {void}
 */
function checkK8sYamlFileWithSchemaModeline(abs, rel, baseLower, lines, fail, pass, kustomizeManagedRel) {
  const match = lines[0].match(MODELINE_RE)
  if (!match) {
    fail(`${rel}: некоректний modeline $schema у першому рядку`)
    return
  }
  const schemaUrl = match[1]
  if (countSchemaModelines(lines) > 1) {
    fail(`${rel}: кілька рядків yaml-language-server $schema — лиш один modeline на файл (див. k8s.mdc)`)
    return
  }

  const body = yamlBodyAfterModeline(lines)

  scanIngressInYamlDocuments(rel, body, fail)

  if (schemaUrl.startsWith('file:')) {
    pass(`${rel}: локальна схема (file:) — перевірка URL за apiVersion/kind пропущена`)
  } else if (HTTPS_SCHEMA_RE.test(schemaUrl)) {
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

  runK8sYamlPolicyAndGatewayScans(rel, baseLower, body, fail, kustomizeManagedRel)
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
    checkK8sYamlHttpBackendGroupFile(rel, baseLower, lines, fail, pass, kustomizeManagedRel)
    return
  }

  if (!firstLineIsModeline) {
    fail(`${rel}: перший рядок має бути коментарем # yaml-language-server: $schema=<url> (без префіксів перед #)`)
    return
  }

  checkK8sYamlFileWithSchemaModeline(abs, rel, baseLower, lines, fail, pass, kustomizeManagedRel)
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
 * Один файл **k8s/base/kustomization.yaml**: непорожній **namespace:**.
 * @param {string} root корінь репозиторію
 * @param {string} abs абсолютний шлях до файлу
 * @param {(msg: string) => void} fail реєстрація порушення
 * @returns {Promise<void>}
 */
async function verifyBaseKustomizationNamespaceOnFile(root, abs, fail) {
  const rel = relative(root, abs).replaceAll('\\', '/')
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
      return
    }
    const first = docs[0]?.toJSON()
    const v = baseKustomizationNamespaceViolation(first)
    if (v) {
      fail(`${rel}: ${v}`)
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    fail(`${rel}: не вдалося прочитати (${msg})`)
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
      await verifyBaseKustomizationNamespaceOnFile(root, abs, fail)
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

  await validateHasuraHttpRouteCanon(root, yamlFiles, fail)

  await validateKustomizationIncludesSvcHlWithSvc(root, yamlFiles, fail)

  await validateKustomizationJson6902NoRemoveAddSamePath(root, yamlFiles, fail)

  await validateKustomizationPatchTargetsResolved(root, yamlFiles, fail)

  await ensureBaseKustomizationHasNamespace(root, yamlFiles, fail)

  return reporter.getExitCode()
}

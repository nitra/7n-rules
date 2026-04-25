/**
 * Перевіряє Kubernetes YAML у шляхах з сегментом `k8s` (див. k8s.mdc).
 *
 * Перший рядок `# yaml-language-server: $schema=…`, без дублікатів, розширення `.yaml`
 * (окрім `kustomization.yaml`); URL схеми за першим документом — kustomization / yannh / datree
 * (**виняток:** `apiVersion: alb.yc.io/v1alpha1`, `kind: HttpBackendGroup` — рядка `# yaml-language-server:` у файлі бути не має).
 * (datree за замовчуванням: GitHub Pages `https://datreeio.github.io/CRDs-catalog/…`).
 *
 * Додатково: у кожному YAML-документі з **`kind: Deployment`** у кожного контейнера
 * **`spec.template.spec.containers[]`** має бути ключ **`resources`** з непорожнім
 * **`resources.requests.cpu`** (рядок на кшталт **`"500m"`** або число; якщо значення ще не обрано —
 * рекомендоване за замовчуванням — **`DEFAULT_CONTAINER_CPU_REQUEST`** = **`"0.5"`**). Поле **`imagePullPolicy`**
 * не перевіряється — діють типові правила Kubernetes (`:latest` або коли тег не вказано → **Always**,
 * інші теги → **IfNotPresent**). Якщо серед **`containers`** / **`initContainers`** є образ
 * **`hasura/graphql-engine`**, дозволено лише пін **`HASURA_GRAPHQL_ENGINE_IMAGE`** (див. k8s.mdc).
 *
 * **Namespace і Kustomize:** YAML у **`…/k8s/base/`** (окрім імені **`kustomization.yaml`**)
 * завжди має **непорожній** **`metadata.namespace`** у відповідних документах (узгоджено з dev у репозиторії),
 * навіть якщо **`namespace:`** заданий у **`base/kustomization.yaml`**.
 * Поза **`k8s/base`**: для файлів, досяжних з kustomization через **`resources`**, **`bases`**, **`components`**,
 * **`crds`**, **`patches[].path`**, **`patchesStrategicMerge`**, **`metadata.namespace`** у маніфесті **не** додають;
 * файли **поза** цим графом — **непорожній** **`metadata.namespace`** (крім **кластерних** kind; див. k8s.mdc).
 *
 * **`kind: Ingress`** заборонено (потрібен перехід на Gateway API).
 * **`apiVersion: autoscaling/v1`** заборонено (мігруй **HorizontalPodAutoscaler** на **`autoscaling/v2`**).
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
 * завжди має бути непорожнє поле **`namespace:`** (перевірка, якщо файл існує). У **`apiVersion: kustomize.config.k8s.io/…`**, **`kind: Kustomization`**
 * перелік **`resources:`** (лише непорожні рядки) має бути відсортовано за алфавітом (**en**, `localeCompare`).
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
 *
 * **ConfigMap для Hasura-Deployment:** якщо в `k8s/base/` є `configmap.yaml` і поруч Deployment з образом
 * **`hasura/graphql-engine`**, то в `data` ConfigMap обов'язково має бути ключ
 * **`HASURA_GRAPHQL_ENABLE_REMOTE_SCHEMA_PERMISSIONS`** зі значенням **`"true"`** (приймається булеве `true`
 * або рядок `"true"`, без регістрової залежності).
 *
 * **HPA / PDB / topologySpreadConstraints для кожного Deployment:** у каталозі з **`Deployment`** поруч
 * обов'язкові **`hpa.yaml`** (`autoscaling/v2`, `HorizontalPodAutoscaler`, `scaleTargetRef.name` = ім'я Deployment)
 * і **`pdb.yaml`** (`policy/v1`, `PodDisruptionBudget`, `selector.matchLabels.app` = мітка `app` Deployment).
 * Env-залежні межі за сегментом після `/k8s/`: **dev-like** (`base`, `dev`, `*-qa`) — `minReplicas === 1`,
 * `maxReplicas === 1`, `minAvailable === 0`; **прод** (решта) — `minReplicas >= 2`, `maxReplicas >= 2`,
 * `minAvailable >= 1`. Сам Deployment має мати у `spec.template.spec.topologySpreadConstraints` запис
 * `maxSkew: 1`, `topologyKey: kubernetes.io/hostname`, `whenUnsatisfiable: ScheduleAnyway`,
 * `labelSelector.matchLabels.app` рівне `spec.selector.matchLabels.app` Deployment.
 *
 * **Прод-оверрайди в kustomization.yaml:** для прод overlays (не dev-like) `kustomization.yaml` у своїх
 * inline `patches[]` повинен змінювати `/spec/minReplicas` і `/spec/maxReplicas` для
 * **HorizontalPodAutoscaler**, і `/spec/minAvailable` для **PodDisruptionBudget** — щоб прод-мінімуми
 * з (`>=2`, `>=2`, `>=1`) не залишалися на dev-значеннях із base. Формат patch — JSON6902 або Strategic Merge;
 * наявність перевіряється через `kustomizationPatchPathsByTargetKind` (конкретне значення — у вмісті patch,
 * яке буде оцінено під час збірки Kustomize).
 *
 * **Існування шляхів у `kustomization.yaml`:** кожне локальне посилання (без `://`) з `resources` / `bases` /
 * `components` / `crds`, `patchesStrategicMerge`, `patches[].path`, `patchesJson6902[].path`, `configurations[]`,
 * `replacements[].path` має вказувати на наявний у репозиторії файл (`.yaml` / `.yml`) або каталог; інакше
 * помилка `check k8s` (k8s.mdc).
 *
 * **HPA / PDB тільки з Deployment у `base`:** у дереві Kustomize з `…/k8s/…/base/kustomization.yaml` не
 * дозволяти `HorizontalPodAutoscaler` / `PodDisruptionBudget` у `resources` / `bases` / `components` / `crds`
 * (рекурсивно), якщо в цьому ж дереві немає `Deployment`. У `kustomization.yaml` overlay, який підключає
 * каталог `…/k8s/…/base`, не додавай окремі YAML-файли з HPA / PDB, поки в наслідуваному `base` у дереві
 * не з’явиться `Deployment` (k8s.mdc).
 */
import { existsSync } from 'node:fs'
import { readFile, readdir, stat, unlink } from 'node:fs/promises'
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

/** Regex: витягує сегмент каталогу після `/k8s/` у POSIX-шляху. */
const K8S_ENV_SEGMENT_RE = /(?:^|\/)k8s\/([^/]+)(?:\/|$)/u

/** Regex: чи рядок є цілим числом (можливо від'ємним). */
const INTEGER_STRING_RE = /^-?\d+$/u

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

/** Префікс `apiVersion` для маніфесту Kustomize **Kustomization**. */
const KUSTOMIZE_CONFIG_API_PREFIX = 'kustomize.config.k8s.io/'

/**
 * Чи послідовність непорожніх рядків відсортована за `localeCompare` (en, ascending).
 * @param {string[]} paths рядки для перевірки
 * @returns {boolean} `true` якщо послідовність відсортована
 */
function stringPathsAreSortedEn(paths) {
  for (let i = 1; i < paths.length; i++) {
    if (paths[i - 1].localeCompare(paths[i], 'en', { sensitivity: 'base' }) > 0) {
      return false
    }
  }
  return true
}

/**
 * Порушення сорту **`resources`**: лише для **`kustomize.config.k8s.io/…`**, **`kind: Kustomization`**.
 * Порожні рядки в списку ігноруються (як у `pushStringPaths`).
 * @param {unknown} obj корінь першого YAML-документа
 * @returns {string | null} причина або `null`, якщо обмеження не застосовується
 */
export function kustomizationResourcesSortedAlphabeticallyViolation(obj) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return null
  const rec = /** @type {Record<string, unknown>} */ (obj)
  if (rec.kind !== 'Kustomization') return null
  const av = rec.apiVersion
  if (typeof av !== 'string' || !av.startsWith(KUSTOMIZE_CONFIG_API_PREFIX)) return null
  const res = rec.resources
  if (res === undefined) return null
  if (!Array.isArray(res)) {
    return 'Kustomization.resources має бути масивом (k8s.mdc)'
  }
  /** @type {string[]} */
  const paths = []
  for (const [i, item] of res.entries()) {
    if (typeof item !== 'string') {
      return `Kustomization.resources[${i}] — очікується рядок-шлях (k8s.mdc)`
    }
    const t = item.trim()
    if (t !== '') paths.push(t)
  }
  if (paths.length < 2) return null
  if (!stringPathsAreSortedEn(paths)) {
    const want = paths.toSorted((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }))
    return `Kustomization.resources має бути за алфавітом (en). Зараз: ${paths.join(', ')}; очікувано: ${want.join(', ')} (k8s.mdc)`
  }
  return null
}

/**
 * Усі **`kustomization.yaml`**: **`resources`**, відсортовані за en.
 * @param {string} root корінь репо
 * @param {string[]} yamlFilesAbs yaml під k8s
 * @param {(msg: string) => void} fail функція для фіксації порушення
 * @returns {Promise<void>} завершується після перевірки всіх kustomization.yaml
 */
async function validateKustomizationResourcesSortedAlphabetically(root, yamlFilesAbs, fail) {
  for (const kustAbs of yamlFilesAbs.filter(p => basename(p).toLowerCase() === 'kustomization.yaml')) {
    const rel = (relative(root, kustAbs) || kustAbs).replaceAll('\\', '/')
    const kust = await readFirstYamlObject(kustAbs)
    if (kust !== null) {
      const v = kustomizationResourcesSortedAlphabeticallyViolation(kust)
      if (v !== null) {
        fail(`${rel}: ${v}`)
      }
    }
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
 * @param {unknown} arr масив (може бути не масивом)
 * @param {string[]} out вихідний масив
 */
function collectObjectPathFields(arr, out) {
  if (!Array.isArray(arr)) return
  for (const item of arr) {
    if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
      const pth = /** @type {Record<string, unknown>} */ (item).path
      if (typeof pth === 'string' && pth.trim() !== '') {
        out.push(pth.trim())
      }
    }
  }
}

/**
 * @param {unknown} arr масив (може бути не масивом)
 * @param {string[]} out вихідний масив
 */
function collectStringPaths(arr, out) {
  if (!Array.isArray(arr)) return
  for (const c of arr) {
    if (typeof c === 'string' && c.trim() !== '') {
      out.push(c.trim())
    }
  }
}

/**
 * Унікальні локальні шляхи з `kustomization.yaml` для перевірки існування на диску:
 * як у `pathsFromKustomizationObject`, плюс **`patchesJson6902[].path`**, плюс **`configurations[]`**
 * (рядки-шляхи) і **`replacements[].path`**, якщо задано.
 * @param {unknown} obj корінь першого документа
 * @returns {string[]} масив локальних шляхів для перевірки існування на диску
 */
export function kustomizePathRefsForExistenceCheck(obj) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    return []
  }
  const fromPaths = pathsFromKustomizationObject(obj)
  const rec = /** @type {Record<string, unknown>} */ (obj)
  collectObjectPathFields(rec.patchesJson6902, fromPaths)
  collectStringPaths(rec.configurations, fromPaths)
  collectObjectPathFields(rec.replacements, fromPaths)
  return [...new Set(fromPaths)]
}

/**
 * @param {string} rel відносний шлях файлу
 * @param {string} r посилання з kustomization
 * @param {string} kustDir каталог kustomization.yaml
 * @param {string} rootNorm нормалізований корінь
 * @param {(msg: string) => void} fail callback
 * @returns {Promise<void>}
 */
async function validateKustomizationRef(rel, r, kustDir, rootNorm, fail) {
  const target = resolve(kustDir, r.trim())
  if (!resolvedFilePathIsUnderRoot(rootNorm, target)) {
    fail(
      `${rel}: посилання «${r}» виходить за межі репозиторію (resolve: ${(
        relative(rootNorm, target) || target
      ).replaceAll('\\', '/')}) (k8s.mdc)`
    )
    return
  }
  /** @type {import('node:fs').Stats | undefined} */
  let st
  try {
    st = await stat(target)
  } catch {
    st = undefined
  }
  if (st === undefined) {
    fail(`${rel}: посилання «${r}» вказує на неіснуючий ресурс (очікувано файл або каталог; k8s.mdc)`)
  } else if (st.isFile()) {
    if (!YAML_EXTENSION_RE.test(target)) {
      fail(
        `${rel}: «${r}» — за правилами k8s у kustomization для файлів дозволені лише розширення .yaml / .yml (k8s.mdc)`
      )
    }
  } else if (!st.isDirectory()) {
    fail(`${rel}: «${r}» — ні файл, ні каталог (k8s.mdc)`)
  }
}

/**
 * Перевіряє, що всі перелічені в `kustomization.yaml` локальні шляхи існують.
 * @param {string} root корінь репо
 * @param {string} kustAbs kustomization.yaml
 * @param {string} rootNorm нормалізований корінь
 * @param {(msg: string) => void} fail callback
 * @returns {Promise<void>}
 */
async function validateOneKustomizationPathRefsExist(root, kustAbs, rootNorm, fail) {
  const rel = (relative(root, kustAbs) || kustAbs).replaceAll('\\', '/')
  const kust = await readFirstYamlObject(kustAbs)
  if (kust === null || kust.kind !== 'Kustomization') {
    return
  }
  const refs = kustomizePathRefsForExistenceCheck(kust)
  const kustDir = dirname(resolve(kustAbs))
  for (const r of refs) {
    if (typeof r === 'string' && !r.includes('://') && r.trim() !== '') {
      await validateKustomizationRef(rel, r, kustDir, rootNorm, fail)
    }
  }
}

/**
 * Усі `kustomization.yaml` під `k8s`: локальні `path` / ресурси мають існувати.
 * @param {string} root корінь репозиторію
 * @param {string[]} yamlFilesAbs абсолютні шляхи YAML-файлів у k8s
 * @param {(msg: string) => void} fail callback для повідомлень про помилки
 * @returns {Promise<void>}
 */
async function validateKustomizationPathRefsExistOnDisk(root, yamlFilesAbs, fail) {
  const rootNorm = resolve(root)
  for (const kustAbs of yamlFilesAbs.filter(p => basename(p).toLowerCase() === 'kustomization.yaml')) {
    await validateOneKustomizationPathRefsExist(root, kustAbs, rootNorm, fail)
  }
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
 * Чи маніфест використовує заборонений **`apiVersion: autoscaling/v1`** (HPA).
 * Канон — **`autoscaling/v2`** (див. k8s.mdc).
 * @param {unknown} manifest корінь YAML-документа
 * @returns {boolean} true, якщо `apiVersion === 'autoscaling/v1'`
 */
export function isForbiddenAutoscalingV1Manifest(manifest) {
  if (manifest === null || manifest === undefined || typeof manifest !== 'object' || Array.isArray(manifest))
    return false
  const rec = /** @type {Record<string, unknown>} */ (manifest)
  return rec.apiVersion === 'autoscaling/v1'
}

/**
 * Заборонена група **`apiVersion: autoscaling/v1`** (HPA) — вимагається міграція на **`autoscaling/v2`**.
 * @param {string} rel відносний шлях до файлу
 * @param {number} docIndex 1-based індекс документа
 * @param {Record<string, unknown>} rec корінь маніфесту
 * @param {(msg: string) => void} fail реєстрація помилки
 * @returns {void}
 */
function failIfAutoscalingV1InDocument(rel, docIndex, rec, fail) {
  if (!isForbiddenAutoscalingV1Manifest(rec)) {
    return
  }
  const kind = typeof rec.kind === 'string' ? rec.kind : '(невідомо)'
  fail(
    `${rel}: знайдено apiVersion: autoscaling/v1 (документ ${docIndex}, kind: ${kind}) — мігруй на autoscaling/v2 (див. k8s.mdc)`
  )
}

/**
 * Шукає заборонені маніфести у розібраних документах: **kind: Ingress** і **apiVersion: autoscaling/v1**.
 * @param {string} rel відносний шлях до файлу
 * @param {string} body YAML після modeline
 * @param {(msg: string) => void} fail callback для помилки
 * @returns {void}
 */
function scanForbiddenManifestsInYamlDocuments(rel, body, fail) {
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
        failIfIngressInDocument(rel, di + 1, rec, fail)
        failIfAutoscalingV1InDocument(rel, di + 1, rec, fail)
      }
    }
  }
}

/**
 * Рекомендоване значення **`resources.requests.cpu`** за замовчуванням для підказки в повідомленнях (k8s.mdc).
 */
export const DEFAULT_CONTAINER_CPU_REQUEST = '0.5'

/**
 * Чи значення `resources.requests.cpu` записане у валідному вигляді:
 * непорожній рядок (`"500m"`, `"0.5"`) або додатне число.
 * @param {unknown} cpu значення поля `resources.requests.cpu`
 * @returns {boolean} true, якщо значення прийнятне
 */
function isValidCpuRequestValue(cpu) {
  if (typeof cpu === 'string') return cpu.trim() !== ''
  if (typeof cpu === 'number') return Number.isFinite(cpu) && cpu > 0
  return false
}

/**
 * Перевірка поля **`resources`** для одного контейнера **Deployment**: вимагає не лише присутність
 * **`resources`**, а й непорожнє **`resources.requests.cpu`** (див. k8s.mdc). Якщо конкретне
 * значення ще не обрано — як безпечне за замовчуванням рекомендовано **`DEFAULT_CONTAINER_CPU_REQUEST`**.
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
    return `контейнер "${label}": відсутнє поле resources — додай resources.requests.cpu (за замовчуванням ${DEFAULT_CONTAINER_CPU_REQUEST}) (див. k8s.mdc)`
  }
  const r = cont.resources
  if (r === null || typeof r !== 'object' || Array.isArray(r)) {
    return `контейнер "${label}": resources має бути записом у YAML`
  }
  const resources = /** @type {Record<string, unknown>} */ (r)
  const requests = resources.requests
  if (requests === null || requests === undefined || typeof requests !== 'object' || Array.isArray(requests)) {
    return `контейнер "${label}": додай resources.requests.cpu (за замовчуванням ${DEFAULT_CONTAINER_CPU_REQUEST}) (див. k8s.mdc)`
  }
  const req = /** @type {Record<string, unknown>} */ (requests)
  if (!('cpu' in req)) {
    return `контейнер "${label}": додай resources.requests.cpu (за замовчуванням ${DEFAULT_CONTAINER_CPU_REQUEST}) (див. k8s.mdc)`
  }
  if (!isValidCpuRequestValue(req.cpu)) {
    return `контейнер "${label}": resources.requests.cpu має бути непорожнім значенням (наприклад "500m" або ${DEFAULT_CONTAINER_CPU_REQUEST}) (зараз: ${JSON.stringify(req.cpu)}) (див. k8s.mdc)`
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
 * Обов'язковий ключ у **`data`** ConfigMap для Hasura-Deployment (узгоджено з k8s.mdc).
 */
export const HASURA_REMOTE_SCHEMA_PERMISSIONS_KEY = 'HASURA_GRAPHQL_ENABLE_REMOTE_SCHEMA_PERMISSIONS'

/**
 * Чи значення поля `data.<key>` у ConfigMap читається як логічне **true**.
 * ConfigMap у Kubernetes тримає значення як рядки, але в YAML часто пишуть без лапок —
 * тому приймаємо і булевий **true**, і рядок **"true"** (без регістрової залежності).
 * @param {unknown} v значення з `data[HASURA_REMOTE_SCHEMA_PERMISSIONS_KEY]`
 * @returns {boolean} true, якщо значення — `true` або рядок `'true'`
 */
function isConfigMapValueTrue(v) {
  if (v === true) return true
  if (typeof v === 'string' && v.trim().toLowerCase() === 'true') return true
  return false
}

/**
 * Чи порушує ConfigMap вимогу щодо **`HASURA_GRAPHQL_ENABLE_REMOTE_SCHEMA_PERMISSIONS: "true"`** (k8s.mdc).
 * Перевірка застосовна, коли в тому ж каталозі є Hasura-Deployment (див. `isHasuraDeploymentManifest`).
 * @param {unknown} manifest корінь YAML-документа ConfigMap
 * @returns {string | null} текст порушення або null, якщо не ConfigMap / ключ є і значення `true`
 */
export function hasuraConfigMapRemoteSchemaPermissionsViolation(manifest) {
  if (manifest === null || manifest === undefined || typeof manifest !== 'object' || Array.isArray(manifest))
    return null
  const rec = /** @type {Record<string, unknown>} */ (manifest)
  if (rec.kind !== 'ConfigMap') return null
  const data = rec.data
  if (data === null || data === undefined || typeof data !== 'object' || Array.isArray(data)) {
    return `data.${HASURA_REMOTE_SCHEMA_PERMISSIONS_KEY}: додай ключ зі значенням "true" (Deployment з hasura/graphql-engine — див. k8s.mdc)`
  }
  const d = /** @type {Record<string, unknown>} */ (data)
  if (!Object.hasOwn(d, HASURA_REMOTE_SCHEMA_PERMISSIONS_KEY)) {
    return `data.${HASURA_REMOTE_SCHEMA_PERMISSIONS_KEY}: додай ключ зі значенням "true" (Deployment з hasura/graphql-engine — див. k8s.mdc)`
  }
  if (!isConfigMapValueTrue(d[HASURA_REMOTE_SCHEMA_PERMISSIONS_KEY])) {
    return `data.${HASURA_REMOTE_SCHEMA_PERMISSIONS_KEY}: значення має бути "true" (зараз: ${JSON.stringify(d[HASURA_REMOTE_SCHEMA_PERMISSIONS_KEY])}) (див. k8s.mdc)`
  }
  return null
}

const K8S_YAML_EXT_RE = /\.ya?ml$/iu

/**
 * Безпечно читає файл і повертає вміст або `undefined` при помилці.
 * @param {string} filePath абсолютний шлях
 * @returns {Promise<string | undefined>} вміст файлу або undefined
 */
async function tryReadFileUtf8(filePath) {
  try {
    return await readFile(filePath, 'utf8')
  } catch {
    return
  }
}

/**
 * Безпечно парсить YAML і повертає масив документів або `undefined` при помилці.
 * @param {string} raw вміст YAML-файлу
 * @returns {import('yaml').Document.Parsed[] | undefined} документи або undefined
 */
function tryParseAllYamlDocs(raw) {
  try {
    return parseAllDocuments(raw)
  } catch {
    return
  }
}

/**
 * Шукає перший документ із заданим `kind` серед YAML-документів.
 * @param {import('yaml').Document.Parsed[]} docs масив документів (результат парсингу)
 * @param {string} kind очікуваний `kind`
 * @returns {Record<string, unknown> | null} знайдений об'єкт або null
 */
function findFirstDocByKind(docs, kind) {
  for (const doc of docs) {
    if (doc.errors.length === 0) {
      const obj = doc.toJSON()
      if (obj !== null && typeof obj === 'object' && !Array.isArray(obj)) {
        const rec = /** @type {Record<string, unknown>} */ (obj)
        if (rec.kind === kind) return rec
      }
    }
  }
  return null
}

/**
 * Збирає всі документи із заданим `kind` серед YAML-документів.
 * @param {import('yaml').Document.Parsed[]} docs масив документів (результат парсингу)
 * @param {string} kind очікуваний `kind`
 * @returns {Record<string, unknown>[]} знайдені об'єкти
 */
function collectDocsByKind(docs, kind) {
  /** @type {Record<string, unknown>[]} */
  const out = []
  for (const doc of docs) {
    if (doc.errors.length === 0) {
      const obj = doc.toJSON()
      if (obj !== null && typeof obj === 'object' && !Array.isArray(obj)) {
        const rec = /** @type {Record<string, unknown>} */ (obj)
        if (rec.kind === kind) out.push(rec)
      }
    }
  }
  return out
}

/**
 * Безпечно читає каталог і повертає масив імен або порожній масив при помилці.
 * @param {string} dirPath абсолютний шлях до каталогу
 * @returns {Promise<string[]>} імена файлів/директорій або порожній масив
 */
async function tryReaddir(dirPath) {
  try {
    return await readdir(dirPath)
  } catch {
    return []
  }
}

/**
 * Читає YAML-файл і шукає перший документ із заданим `kind`.
 * @param {string} filePath абсолютний шлях до YAML-файлу
 * @param {string} kind очікуваний `kind`
 * @returns {Promise<Record<string, unknown> | null>} знайдений об'єкт або null
 */
async function readFirstDocByKindFromFile(filePath, kind) {
  const raw = await tryReadFileUtf8(filePath)
  if (raw === undefined) return null
  const docs = tryParseAllYamlDocs(raw)
  if (docs === undefined) return null
  return findFirstDocByKind(docs, kind)
}

/**
 * Знаходить перший документ **Deployment** серед YAML-файлів каталогу (для перевірки імені ConfigMap, js-pino.mdc).
 * @param {string} dirPath абсолютний шлях до каталогу
 * @returns {Promise<Record<string, unknown> | null>} об'єкт Deployment або null
 */
export async function findDeploymentDocInDir(dirPath) {
  const entries = await tryReaddir(dirPath)
  for (const entry of entries) {
    if (K8S_YAML_EXT_RE.test(entry)) {
      const found = await readFirstDocByKindFromFile(join(dirPath, entry), 'Deployment')
      if (found !== null) return found
    }
  }
  return null
}

/**
 * Безпечно отримує вкладений об'єкт за ключем (повертає `null`, якщо не об'єкт).
 * @param {Record<string, unknown>} parent батьківський об'єкт
 * @param {string} key ключ
 * @returns {Record<string, unknown> | null} вкладений об'єкт або null
 */
function getNestedObject(parent, key) {
  const v = parent[key]
  if (v === null || v === undefined || typeof v !== 'object' || Array.isArray(v)) return null
  return /** @type {Record<string, unknown>} */ (v)
}

/**
 * Витягує **podSpec** (`spec.template.spec`) з об'єкта Deployment.
 * @param {Record<string, unknown>} deployment об'єкт Deployment
 * @returns {Record<string, unknown> | null} podSpec або null
 */
function extractPodSpec(deployment) {
  const spec = getNestedObject(deployment, 'spec')
  if (spec === null) return null
  const template = getNestedObject(spec, 'template')
  if (template === null) return null
  return getNestedObject(template, 'spec')
}

/**
 * Збирає імена ConfigMap з `envFrom[*].configMapRef.name` одного контейнера.
 * @param {unknown} container елемент масиву containers
 * @param {Set<string>} names набір, куди додаються імена
 */
function collectConfigMapRefsFromContainer(container, names) {
  if (container === null || typeof container !== 'object' || Array.isArray(container)) return
  const envFrom = /** @type {Record<string, unknown>} */ (container).envFrom
  const items = Array.isArray(envFrom) ? /** @type {unknown[]} */ (envFrom) : []
  for (const ef of items) {
    if (ef === null || typeof ef !== 'object' || Array.isArray(ef)) {
      /* пропускаємо скаляри та масиви */
    } else {
      const cmr = getNestedObject(/** @type {Record<string, unknown>} */ (ef), 'configMapRef')
      if (cmr !== null) {
        const n = cmr.name
        if (typeof n === 'string' && n.trim() !== '') names.add(n)
      }
    }
  }
}

/**
 * Збирає імена ConfigMap з `volumes[*].configMap.name`.
 * @param {unknown[]} volumes масив volumes
 * @param {Set<string>} names набір, куди додаються імена
 */
function collectConfigMapRefsFromVolumes(volumes, names) {
  for (const v of volumes) {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) {
      /* пропускаємо скаляри та масиви */
    } else {
      const cm = getNestedObject(/** @type {Record<string, unknown>} */ (v), 'configMap')
      if (cm !== null) {
        const n = cm.name
        if (typeof n === 'string' && n.trim() !== '') names.add(n)
      }
    }
  }
}

/**
 * Збирає унікальні імена **ConfigMap**, на які посилається **Deployment**
 * через `spec.template.spec.containers[*].envFrom[*].configMapRef.name`
 * та `spec.template.spec.volumes[*].configMap.name` (для перевірки js-pino.mdc).
 * @param {Record<string, unknown>} deployment об'єкт Deployment
 * @returns {Set<string>} унікальні імена ConfigMap
 */
export function collectDeploymentConfigMapRefs(deployment) {
  /** @type {Set<string>} */
  const names = new Set()
  const ps = extractPodSpec(deployment)
  if (ps === null) return names
  const containers = Array.isArray(ps.containers) ? /** @type {unknown[]} */ (ps.containers) : []
  for (const c of containers) {
    collectConfigMapRefsFromContainer(c, names)
  }
  const volumes = Array.isArray(ps.volumes) ? /** @type {unknown[]} */ (ps.volumes) : []
  collectConfigMapRefsFromVolumes(volumes, names)
  return names
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
      if (p !== null && p.type === 'Exact' && typeof p.value === 'string' && p.value.endsWith('/ql')) {
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
        fail(
          `${rel}: HTTPRoute «${name}» (документ ${hr.docIndex}; прив'язано до Hasura-Deployment у тому ж каталозі): ${v}`
        )
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
  scanForbiddenManifestsInYamlDocuments(rel, body, fail)
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

  scanForbiddenManifestsInYamlDocuments(rel, body, fail)

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

const CONFIGMAP_BASE_PATH_RE = /\/k8s\/base\/configmap\.yaml$/u

/**
 * Витягує `metadata.name` першого **ConfigMap** із YAML-вмісту.
 * @param {string} raw вміст YAML-файлу
 * @returns {string | null} ім'я ConfigMap або null (якщо не знайдено або помилка парсингу)
 */
function extractFirstConfigMapName(raw) {
  const docs = tryParseAllYamlDocs(raw)
  if (docs === undefined) return null
  const cm = findFirstDocByKind(docs, 'ConfigMap')
  if (cm === null) return null
  return manifestMetadataName(cm)
}

/**
 * Перевіряє один файл `configmap.yaml`: якщо поруч є Deployment з рівно одним ConfigMap-рефом,
 * `metadata.name` ConfigMap має збігатися з `metadata.name` Deployment.
 * @param {string} cmAbs абсолютний шлях до configmap.yaml
 * @param {string} rel відносний шлях для повідомлень
 * @param {(msg: string) => void} fail callback при помилці
 * @param {(msg: string) => void} passFn callback при успіху
 */
async function validateSingleConfigMapNameMatch(cmAbs, rel, fail, passFn) {
  const raw = await tryReadFileUtf8(cmAbs)
  if (raw === undefined) return
  const cmName = extractFirstConfigMapName(raw)
  if (cmName === null) return
  const deployment = await findDeploymentDocInDir(dirname(cmAbs))
  if (deployment === null) return
  const deployName = manifestMetadataName(deployment)
  const cmRefs = collectDeploymentConfigMapRefs(deployment)
  if (cmRefs.size !== 1 || typeof deployName !== 'string') return
  if (cmName === deployName) {
    passFn(`${rel}: metadata.name '${cmName}' збігається з Deployment (k8s.mdc)`)
  } else {
    fail(
      `${rel}: metadata.name '${cmName}' має збігатися з назвою Deployment '${deployName}' — Deployment посилається рівно на один ConfigMap (k8s.mdc)`
    )
  }
}

/**
 * Якщо в `k8s/base/` є `configmap.yaml` і Deployment посилається рівно на один ConfigMap —
 * `metadata.name` ConfigMap має збігатися з `metadata.name` Deployment (k8s.mdc).
 * @param {string} root корінь репозиторію
 * @param {string[]} yamlFilesAbs yaml під k8s
 * @param {(msg: string) => void} fail callback при помилці
 * @param {(msg: string) => void} passFn callback при успіху
 */
async function validateConfigMapNameMatchesDeployment(root, yamlFilesAbs, fail, passFn) {
  const cmFiles = yamlFilesAbs.filter(abs => {
    const rel = relative(root, abs).replaceAll('\\', '/')
    return CONFIGMAP_BASE_PATH_RE.test(`/${rel}`) || rel === 'k8s/base/configmap.yaml'
  })
  for (const cmAbs of cmFiles) {
    const rel = relative(root, cmAbs).replaceAll('\\', '/') || cmAbs
    await validateSingleConfigMapNameMatch(cmAbs, rel, fail, passFn)
  }
}

/**
 * Знаходить перший документ **ConfigMap** у файлі (з `metadata.name`).
 * @param {string} absPath абсолютний шлях до YAML-файлу
 * @returns {Promise<Record<string, unknown> | null>} об'єкт ConfigMap або null
 */
async function readFirstConfigMapDoc(absPath) {
  const raw = await tryReadFileUtf8(absPath)
  if (raw === undefined) return null
  const docs = tryParseAllYamlDocs(raw)
  if (docs === undefined) return null
  return findFirstDocByKind(docs, 'ConfigMap')
}

/**
 * Для кожного `k8s/base/configmap.yaml`, у каталозі якого поруч є Hasura-Deployment,
 * вимагає у `data` ключ **`HASURA_GRAPHQL_ENABLE_REMOTE_SCHEMA_PERMISSIONS`** зі значенням **`"true"`** (k8s.mdc).
 * @param {string} root корінь репозиторію
 * @param {string[]} yamlFilesAbs yaml під k8s
 * @param {(msg: string) => void} fail callback при помилці
 * @param {(msg: string) => void} passFn callback при успіху
 */
async function validateHasuraConfigMapRemoteSchemaPermissions(root, yamlFilesAbs, fail, passFn) {
  const cmFiles = yamlFilesAbs.filter(abs => {
    const rel = relative(root, abs).replaceAll('\\', '/')
    return CONFIGMAP_BASE_PATH_RE.test(`/${rel}`) || rel === 'k8s/base/configmap.yaml'
  })
  for (const cmAbs of cmFiles) {
    const rel = relative(root, cmAbs).replaceAll('\\', '/') || cmAbs
    const deployment = await findDeploymentDocInDir(dirname(cmAbs))
    if (deployment !== null && isHasuraDeploymentManifest(deployment)) {
      const cm = await readFirstConfigMapDoc(cmAbs)
      if (cm !== null) {
        const violation = hasuraConfigMapRemoteSchemaPermissionsViolation(cm)
        if (violation === null) {
          passFn(`${rel}: ${HASURA_REMOTE_SCHEMA_PERMISSIONS_KEY}="true" для Hasura-Deployment (k8s.mdc)`)
        } else {
          fail(`${rel}: ${violation}`)
        }
      }
    }
  }
}

/**
 * Ім'я файлу HPA поруч із Deployment (див. k8s.mdc).
 */
export const HPA_FILENAME = 'hpa.yaml'

/**
 * Ім'я файлу PDB поруч із Deployment (див. k8s.mdc).
 */
export const PDB_FILENAME = 'pdb.yaml'

/**
 * Канонічний topologyKey для **topologySpreadConstraints** у Deployment (див. k8s.mdc).
 */
const TOPOLOGY_SPREAD_TOPOLOGY_KEY = 'kubernetes.io/hostname'

/**
 * Витягує сегмент каталогу після `/k8s/` у relative-шляху (перший компонент за `k8s/`).
 * Приклад: `app/k8s/base/deploy.yaml` → `base`; `app/k8s/tr-qa/hpa.yaml` → `tr-qa`.
 * @param {string} relPath відносний шлях у POSIX-форматі (через `/`)
 * @returns {string | null} сегмент середовища або null, якщо `/k8s/` немає в шляху
 */
export function k8sEnvSegmentFromRelPath(relPath) {
  const m = relPath.match(K8S_ENV_SEGMENT_RE)
  return m ? m[1] : null
}

/**
 * Чи сегмент середовища вважається **dev-like** (м'які вимоги до HPA/PDB):
 * `base`, `dev`, або будь-що з суфіксом `-qa` (напр. `tr-qa`).
 * Решта (прод / staging / будь-який інший overlay) — прод-вимоги.
 * @param {string | null | undefined} segment сегмент після `/k8s/`
 * @returns {boolean} true для dev-like середовища
 */
export function isDevLikeK8sEnvSegment(segment) {
  if (typeof segment !== 'string' || segment === '') return false
  if (segment === 'base' || segment === 'dev') return true
  return segment.endsWith('-qa')
}

/**
 * Витягує рядкове ім'я з `metadata.name` об'єкта Kubernetes.
 * @param {Record<string, unknown>} manifest корінь маніфесту
 * @returns {string | null} непорожнє ім'я або null
 */
function manifestMetadataName(manifest) {
  const meta = manifest.metadata
  if (meta === null || meta === undefined || typeof meta !== 'object' || Array.isArray(meta)) return null
  const n = /** @type {Record<string, unknown>} */ (meta).name
  return typeof n === 'string' && n.trim() !== '' ? n : null
}

/**
 * Витягує мітку `app` з `spec.selector.matchLabels.app` Deployment.
 * @param {Record<string, unknown>} deployment об'єкт Deployment
 * @returns {string | null} непорожнє значення `app` або null, якщо не задане
 */
export function deploymentAppLabel(deployment) {
  const spec = deployment.spec
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) return null
  const selector = /** @type {Record<string, unknown>} */ (spec).selector
  if (selector === null || typeof selector !== 'object' || Array.isArray(selector)) return null
  const matchLabels = /** @type {Record<string, unknown>} */ (selector).matchLabels
  if (matchLabels === null || typeof matchLabels !== 'object' || Array.isArray(matchLabels)) return null
  const app = /** @type {Record<string, unknown>} */ (matchLabels).app
  return typeof app === 'string' && app.trim() !== '' ? app : null
}

/**
 * Перетворює значення на ціле число (приймає число або числовий рядок).
 * @param {unknown} v значення з YAML
 * @returns {number | null} ціле або null, якщо не читається як ціле
 */
function coerceInteger(v) {
  if (typeof v === 'number' && Number.isInteger(v)) return v
  if (typeof v === 'string' && INTEGER_STRING_RE.test(v.trim())) return Number.parseInt(v, 10)
  return null
}

/**
 * Перевіряє `spec.scaleTargetRef` у HPA і додає порушення до масиву.
 * @param {Record<string, unknown>} spec об'єкт `spec` HPA
 * @param {string} expectedDeployName очікуване ім'я Deployment
 * @param {string[]} errs масив порушень
 */
function validateHpaScaleTargetRef(spec, expectedDeployName, errs) {
  const str = spec.scaleTargetRef
  if (str === null || str === undefined || typeof str !== 'object' || Array.isArray(str)) {
    errs.push('spec.scaleTargetRef відсутній')
    return
  }
  const r = /** @type {Record<string, unknown>} */ (str)
  if (r.apiVersion !== 'apps/v1')
    errs.push(`spec.scaleTargetRef.apiVersion має бути apps/v1 (зараз: ${JSON.stringify(r.apiVersion)})`)
  if (r.kind !== 'Deployment')
    errs.push(`spec.scaleTargetRef.kind має бути Deployment (зараз: ${JSON.stringify(r.kind)})`)
  if (r.name !== expectedDeployName)
    errs.push(`spec.scaleTargetRef.name має бути '${expectedDeployName}' (зараз: ${JSON.stringify(r.name)})`)
}

/**
 * Перевіряє dev-like межі `minReplicas` / `maxReplicas` HPA (обидва мають бути рівно 1).
 * @param {number | null} minR значення minReplicas
 * @param {number | null} maxR значення maxReplicas
 * @param {string[]} errs масив порушень
 */
function validateHpaDevLikeReplicas(minR, maxR, errs) {
  if (minR !== null && minR !== 1)
    errs.push(`spec.minReplicas для dev-like (base/dev/*-qa) має бути 1 (зараз: ${minR})`)
  if (maxR !== null && maxR !== 1)
    errs.push(`spec.maxReplicas для dev-like (base/dev/*-qa) має бути 1 (зараз: ${maxR})`)
}

/**
 * Перевіряє прод межі `minReplicas` / `maxReplicas` HPA (обидва мають бути мінімум 2).
 * @param {number | null} minR значення minReplicas
 * @param {number | null} maxR значення maxReplicas
 * @param {string[]} errs масив порушень
 */
function validateHpaProdReplicas(minR, maxR, errs) {
  if (minR !== null && minR < 2) errs.push(`spec.minReplicas для прод середовища має бути мінімум 2 (зараз: ${minR})`)
  if (maxR !== null && maxR < 2) errs.push(`spec.maxReplicas для прод середовища має бути мінімум 2 (зараз: ${maxR})`)
}

/**
 * Перевіряє env-залежні межі `minReplicas` / `maxReplicas` HPA.
 * @param {number | null} minR значення minReplicas
 * @param {number | null} maxR значення maxReplicas
 * @param {boolean} isDevLike чи середовище dev-like
 * @param {string[]} errs масив порушень
 */
function validateHpaReplicaLimits(minR, maxR, isDevLike, errs) {
  if (minR === null) errs.push('spec.minReplicas має бути цілим числом')
  if (maxR === null) errs.push('spec.maxReplicas має бути цілим числом')
  if (minR !== null && maxR !== null && minR > maxR) {
    errs.push(`spec.minReplicas (${minR}) не може бути більше spec.maxReplicas (${maxR})`)
  }
  if (isDevLike) {
    validateHpaDevLikeReplicas(minR, maxR, errs)
  } else {
    validateHpaProdReplicas(minR, maxR, errs)
  }
}

/**
 * Перевіряє `spec.behavior` HPA (наявність scaleUp/scaleDown з policies).
 * @param {Record<string, unknown>} spec об'єкт `spec` HPA
 * @param {string[]} errs масив порушень
 */
function validateHpaBehavior(spec, errs) {
  const behavior = spec.behavior
  if (behavior === null || behavior === undefined || typeof behavior !== 'object' || Array.isArray(behavior)) {
    errs.push('spec.behavior відсутній (має містити scaleUp і scaleDown)')
    return
  }
  const b = /** @type {Record<string, unknown>} */ (behavior)
  for (const key of /** @type {const} */ (['scaleUp', 'scaleDown'])) {
    const v = b[key]
    if (v === null || v === undefined || typeof v !== 'object' || Array.isArray(v)) {
      errs.push(`spec.behavior.${key} відсутній`)
    } else {
      const policies = /** @type {Record<string, unknown>} */ (v).policies
      if (!Array.isArray(policies) || policies.length === 0) {
        errs.push(`spec.behavior.${key}.policies має бути непорожнім масивом`)
      }
    }
  }
}

/**
 * Перевіряє **HPA** (`autoscaling/v2`, `HorizontalPodAutoscaler`): структура й env-залежні межі
 * minReplicas / maxReplicas (**dev-like:** `minReplicas === 1`; **прод:** `minReplicas >= 2`, `maxReplicas >= 2`).
 * @param {unknown} manifest корінь YAML-документа HPA
 * @param {string} expectedDeployName очікуване ім'я Deployment у `scaleTargetRef.name`
 * @param {boolean} isDevLike чи середовище dev-like (base/dev/*-qa)
 * @returns {string[]} список порушень (порожній — ок)
 */
export function hpaManifestViolations(manifest, expectedDeployName, isDevLike) {
  /** @type {string[]} */
  const errs = []
  if (manifest === null || manifest === undefined || typeof manifest !== 'object' || Array.isArray(manifest)) {
    errs.push('HPA має бути обʼєктом YAML')
    return errs
  }
  const rec = /** @type {Record<string, unknown>} */ (manifest)
  if (rec.kind !== 'HorizontalPodAutoscaler')
    errs.push(`kind має бути HorizontalPodAutoscaler (зараз: ${JSON.stringify(rec.kind)})`)
  if (rec.apiVersion !== 'autoscaling/v2')
    errs.push(`apiVersion має бути autoscaling/v2 (зараз: ${JSON.stringify(rec.apiVersion)})`)
  const spec = rec.spec
  if (spec === null || spec === undefined || typeof spec !== 'object' || Array.isArray(spec)) {
    errs.push('spec відсутній або некоректний')
    return errs
  }
  const s = /** @type {Record<string, unknown>} */ (spec)
  validateHpaScaleTargetRef(s, expectedDeployName, errs)
  validateHpaReplicaLimits(coerceInteger(s.minReplicas), coerceInteger(s.maxReplicas), isDevLike, errs)
  if (!Array.isArray(s.metrics) || s.metrics.length === 0) {
    errs.push('spec.metrics має бути непорожнім масивом (наприклад, Resource/cpu/Utilization)')
  }
  validateHpaBehavior(s, errs)
  return errs
}

/**
 * Перевіряє env-залежну межу `minAvailable` у PDB.
 * @param {number | null} minA значення minAvailable
 * @param {boolean} isDevLike чи середовище dev-like
 * @param {string[]} errs масив порушень
 */
function validatePdbMinAvailable(minA, isDevLike, errs) {
  if (minA === null) {
    errs.push('spec.minAvailable має бути цілим числом')
  } else if (isDevLike) {
    if (minA !== 0) errs.push(`spec.minAvailable для dev-like (base/dev/*-qa) має бути 0 (зараз: ${minA})`)
  } else if (minA < 1) {
    errs.push(`spec.minAvailable для прод середовища має бути мінімум 1 (зараз: ${minA})`)
  }
}

/**
 * Перевіряє `spec.selector.matchLabels.app` у PDB.
 * @param {Record<string, unknown>} spec об'єкт `spec` PDB
 * @param {string} expectedAppLabel очікувана мітка `app`
 * @param {string[]} errs масив порушень
 */
function validatePdbSelector(spec, expectedAppLabel, errs) {
  const selector = spec.selector
  if (selector === null || selector === undefined || typeof selector !== 'object' || Array.isArray(selector)) {
    errs.push('spec.selector відсутній')
    return
  }
  const matchLabels = /** @type {Record<string, unknown>} */ (selector).matchLabels
  if (
    matchLabels === null ||
    matchLabels === undefined ||
    typeof matchLabels !== 'object' ||
    Array.isArray(matchLabels)
  ) {
    errs.push('spec.selector.matchLabels відсутній')
    return
  }
  const app = /** @type {Record<string, unknown>} */ (matchLabels).app
  if (app !== expectedAppLabel)
    errs.push(`spec.selector.matchLabels.app має бути '${expectedAppLabel}' (зараз: ${JSON.stringify(app)})`)
}

/**
 * Перевіряє **PDB** (`policy/v1`, `PodDisruptionBudget`): структура й env-залежна межа
 * minAvailable (**dev-like:** `=== 0`; **прод:** `>= 1`).
 * @param {unknown} manifest корінь YAML-документа PDB
 * @param {string} expectedAppLabel очікувана мітка `app` у `selector.matchLabels`
 * @param {boolean} isDevLike чи середовище dev-like (base/dev/*-qa)
 * @returns {string[]} список порушень (порожній — ок)
 */
export function pdbManifestViolations(manifest, expectedAppLabel, isDevLike) {
  /** @type {string[]} */
  const errs = []
  if (manifest === null || manifest === undefined || typeof manifest !== 'object' || Array.isArray(manifest)) {
    errs.push('PDB має бути обʼєктом YAML')
    return errs
  }
  const rec = /** @type {Record<string, unknown>} */ (manifest)
  if (rec.kind !== 'PodDisruptionBudget')
    errs.push(`kind має бути PodDisruptionBudget (зараз: ${JSON.stringify(rec.kind)})`)
  if (rec.apiVersion !== 'policy/v1')
    errs.push(`apiVersion має бути policy/v1 (зараз: ${JSON.stringify(rec.apiVersion)})`)
  const spec = rec.spec
  if (spec === null || spec === undefined || typeof spec !== 'object' || Array.isArray(spec)) {
    errs.push('spec відсутній або некоректний')
    return errs
  }
  const s = /** @type {Record<string, unknown>} */ (spec)
  validatePdbMinAvailable(coerceInteger(s.minAvailable), isDevLike, errs)
  validatePdbSelector(s, expectedAppLabel, errs)
  return errs
}

/**
 * Чи елемент `topologySpreadConstraints` відповідає канону (maxSkew=1, topologyKey, whenUnsatisfiable, app label).
 * @param {unknown} item елемент масиву topologySpreadConstraints
 * @param {string} expectedAppLabel очікувана мітка `app`
 * @returns {boolean} true, якщо збіг канонічний
 */
function isCanonicalTopologySpreadConstraint(item, expectedAppLabel) {
  if (item === null || typeof item !== 'object' || Array.isArray(item)) return false
  const it = /** @type {Record<string, unknown>} */ (item)
  if (coerceInteger(it.maxSkew) !== 1) return false
  if (it.topologyKey !== TOPOLOGY_SPREAD_TOPOLOGY_KEY) return false
  if (it.whenUnsatisfiable !== 'ScheduleAnyway') return false
  const ls = getNestedObject(it, 'labelSelector')
  if (ls === null) return false
  const ml = getNestedObject(ls, 'matchLabels')
  if (ml === null) return false
  return ml.app === expectedAppLabel
}

/**
 * Перевіряє, що Deployment має канонічний запис у **`spec.template.spec.topologySpreadConstraints`**:
 * `maxSkew: 1`, `topologyKey: kubernetes.io/hostname`, `whenUnsatisfiable: ScheduleAnyway`,
 * `labelSelector.matchLabels.app` збігається з міткою Deployment (див. k8s.mdc).
 * @param {unknown} manifest корінь YAML-документа Deployment
 * @param {string} expectedAppLabel очікувана мітка `app`
 * @returns {string | null} текст порушення або null
 */
export function deploymentTopologySpreadConstraintsViolation(manifest, expectedAppLabel) {
  if (manifest === null || manifest === undefined || typeof manifest !== 'object' || Array.isArray(manifest))
    return null
  const rec = /** @type {Record<string, unknown>} */ (manifest)
  if (rec.kind !== 'Deployment') return null
  const podSpec = extractPodSpec(rec)
  if (podSpec === null) return 'spec.template.spec відсутній'
  const tsc = podSpec.topologySpreadConstraints
  const expectedMsg = `spec.template.spec.topologySpreadConstraints: додай запис maxSkew=1, topologyKey=${TOPOLOGY_SPREAD_TOPOLOGY_KEY}, whenUnsatisfiable=ScheduleAnyway, labelSelector.matchLabels.app='${expectedAppLabel}' (k8s.mdc)`
  if (!Array.isArray(tsc) || tsc.length === 0) return expectedMsg
  for (const item of tsc) {
    if (isCanonicalTopologySpreadConstraint(item, expectedAppLabel)) return null
  }
  return `spec.template.spec.topologySpreadConstraints: бракує запису maxSkew=1, topologyKey=${TOPOLOGY_SPREAD_TOPOLOGY_KEY}, whenUnsatisfiable=ScheduleAnyway, labelSelector.matchLabels.app='${expectedAppLabel}' (k8s.mdc)`
}

/**
 * Читає YAML-файл і збирає всі документи із заданим `kind`.
 * @param {string} filePath абсолютний шлях до YAML-файлу
 * @param {string} kind очікуваний `kind`
 * @returns {Promise<Record<string, unknown>[]>} знайдені об'єкти (порожній масив, якщо файл недоступний або парсинг не вдався)
 */
async function readAllDocsByKindFromFile(filePath, kind) {
  const raw = await tryReadFileUtf8(filePath)
  if (raw === undefined) return []
  const docs = tryParseAllYamlDocs(raw)
  if (docs === undefined) return []
  return collectDocsByKind(docs, kind)
}

/**
 * Чи ім'я файлу відповідає фільтру YAML-розширення або точному basename.
 * @param {string} entry ім'я файлу
 * @param {string} [filenameFilter] точний basename або undefined для перевірки за YAML-розширенням
 * @returns {boolean} true, якщо файл підходить
 */
function matchesYamlFilter(entry, filenameFilter) {
  return filenameFilter === undefined ? K8S_YAML_EXT_RE.test(entry) : entry === filenameFilter
}

/**
 * Збирає всі документи з **k8s**-yaml за заданим `kind` у каталозі.
 * @param {string} dirPath абсолютний шлях до каталогу
 * @param {string} kind очікуваний `kind` (наприклад, `HorizontalPodAutoscaler`)
 * @param {string} [filenameFilter] фільтр за basename (наприклад, `hpa.yaml`); якщо заданий — лише цей файл
 * @returns {Promise<Record<string, unknown>[]>} список знайдених документів
 */
async function readDocsByKindInDir(dirPath, kind, filenameFilter) {
  /** @type {Record<string, unknown>[]} */
  const out = []
  const entries = await tryReaddir(dirPath)
  for (const entry of entries) {
    if (matchesYamlFilter(entry, filenameFilter)) {
      const found = await readAllDocsByKindFromFile(join(dirPath, entry), kind)
      for (const rec of found) out.push(rec)
    }
  }
  return out
}

/**
 * Збирає шляхи **JSON Pointer**, які змінює один inline `patch` у **`patches[]`** kustomization.yaml.
 * Підтримка двох форматів:
 * — **JSON6902** (масив операцій): беремо `path` кожної операції (через `collectJson6902OperationsFromPatchText`).
 * — **Strategic Merge** (YAML-обʼєкт): плоскі шляхи до всіх листових полів (наприклад
 *    `spec.minReplicas: 2` → `/spec/minReplicas`). Проміжні обʼєкти не вважаються «зміненими» — лише листки.
 * @param {string} patchText вміст поля `patch`
 * @returns {Set<string>} шляхи JSON Pointer (наприклад `/spec/minReplicas`)
 */
export function kustomizePatchModifiedPaths(patchText) {
  /** @type {Set<string>} */
  const out = new Set()
  const t = typeof patchText === 'string' ? patchText.trim() : ''
  if (t === '') return out
  const ops = collectJson6902OperationsFromPatchText(patchText)
  if (ops.length > 0) {
    for (const { path } of ops) {
      if (path) out.add(path)
    }
    return out
  }
  let parsed
  try {
    for (const d of parseAllDocuments(t)) {
      if (d.errors.length === 0) {
        parsed = d.toJSON()
        break
      }
    }
  } catch {
    return out
  }
  if (parsed === null || parsed === undefined || typeof parsed !== 'object' || Array.isArray(parsed)) return out
  /**
   * Рекурсивний обхід: шлях додаємо лише для листків (скаляр / масив).
   * @param {Record<string, unknown>} obj вузол дерева
   * @param {string} prefix поточний JSON Pointer
   */
  const walk = (obj, prefix) => {
    for (const [k, v] of Object.entries(obj)) {
      const p = `${prefix}/${k}`
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
        walk(/** @type {Record<string, unknown>} */ (v), p)
      } else {
        out.add(p)
      }
    }
  }
  walk(/** @type {Record<string, unknown>} */ (parsed), '')
  return out
}

/**
 * Читає `kind` з inline **`patch`** у форматі Strategic Merge (для випадків, коли **`target.kind`** не заданий).
 * @param {string} patchText вміст поля `patch`
 * @returns {string | null} значення `kind` першого документа або null
 */
function strategicMergePatchKind(patchText) {
  const t = typeof patchText === 'string' ? patchText.trim() : ''
  if (t === '') return null
  try {
    for (const d of parseAllDocuments(t)) {
      if (d.errors.length === 0) {
        const obj = d.toJSON()
        if (obj !== null && typeof obj === 'object' && !Array.isArray(obj)) {
          const k = /** @type {Record<string, unknown>} */ (obj).kind
          if (typeof k === 'string' && k !== '') return k
        }
      }
    }
  } catch {
    return null
  }
  return null
}

/**
 * Визначає `kind` цілі для одного inline patch: з `target.kind` або з тіла Strategic Merge.
 * @param {Record<string, unknown>} patchObj елемент масиву `patches[]`
 * @returns {string | null} kind або null, якщо не вдалося визначити
 */
function resolvePatchTargetKind(patchObj) {
  const target = patchObj.target
  if (target !== null && typeof target === 'object' && !Array.isArray(target)) {
    const tk = /** @type {Record<string, unknown>} */ (target).kind
    if (typeof tk === 'string' && tk !== '') return tk
  }
  return typeof patchObj.patch === 'string' ? strategicMergePatchKind(patchObj.patch) : null
}

/**
 * Обробляє один елемент `patches[]` і додає знайдені шляхи до `byKind`.
 * @param {unknown} p елемент масиву `patches[]`
 * @param {Map<string, Set<string>>} byKind накопичувач `kind` → шляхи JSON Pointer
 */
function processSingleKustomizePatch(p, byKind) {
  if (p === null || typeof p !== 'object' || Array.isArray(p)) return
  const pr = /** @type {Record<string, unknown>} */ (p)
  if (typeof pr.patch !== 'string') return
  const kind = resolvePatchTargetKind(pr)
  if (kind === null) return
  const paths = kustomizePatchModifiedPaths(pr.patch)
  if (!byKind.has(kind)) byKind.set(kind, new Set())
  const set = byKind.get(kind)
  for (const x of paths) set.add(x)
}

/**
 * Збирає шляхи, змінені всіма inline `patches[]` у kustomization, згрупованими за `kind` цілі.
 * `kind` визначається з `target.kind` (канон) або, якщо відсутній — з `kind:` у тілі Strategic Merge patch.
 * @param {Record<string, unknown>} kust об'єкт kustomization.yaml
 * @returns {Map<string, Set<string>>} `kind` → шляхи JSON Pointer, які overrides змінюють
 */
export function kustomizationPatchPathsByTargetKind(kust) {
  /** @type {Map<string, Set<string>>} */
  const byKind = new Map()
  const patches = kust.patches
  if (!Array.isArray(patches)) return byKind
  for (const p of patches) {
    processSingleKustomizePatch(p, byKind)
  }
  return byKind
}

/**
 * Читає перший валідний YAML-об'єкт із файлу.
 * @param {string} absPath абсолютний шлях до YAML-файлу
 * @returns {Promise<Record<string, unknown> | null>} перший об'єкт або null
 */
async function readFirstYamlObject(absPath) {
  const raw = await tryReadFileUtf8(absPath)
  if (raw === undefined) return null
  const docs = tryParseAllYamlDocs(raw)
  if (docs === undefined) return null
  for (const doc of docs) {
    if (doc.errors.length === 0) {
      const obj = doc.toJSON()
      if (obj !== null && typeof obj === 'object' && !Array.isArray(obj)) {
        return /** @type {Record<string, unknown>} */ (obj)
      }
    }
  }
  return null
}

/**
 * Чи відносний шлях вказує на `k8s/…/base/kustomization.yaml` (каталог `base` у дереві k8s).
 * @param {string} rel POSIX-шлях
 * @returns {boolean} true, якщо батьківський каталог — `…/…/base` у шляху з `k8s`
 */
function isK8sBaseKustomizationRelPath(rel) {
  const n = rel.replaceAll('\\', '/')
  const d = dirname(n).replaceAll('\\', '/')
  if (basename(d) !== 'base') {
    return false
  }
  return d.startsWith('k8s/') || d.includes('/k8s/')
}

/**
 * Чи абсолютний шлях до каталогу — k8s-`base` (ідентифікуємо за тим, що `relative` від кореня
 * містить сегмент `k8s` і basename каталогу — `base`).
 * @param {string} rootNorm нормалізований корінь репо
 * @param {string} dirAbs абсолютний шлях до каталогу
 * @returns {boolean} true для `.../k8s/.../base` з `kustomization.yaml` у цьому каталозі
 */
function isUnderK8sPathRelToRoot(rootNorm, dirAbs) {
  const rel = (relative(rootNorm, dirAbs) || '.').replaceAll('\\', '/')
  if (rel === '' || rel === '.') {
    return false
  }
  if (rel.startsWith('../') || rel === '..') {
    return false
  }
  return rel === 'k8s' || rel.startsWith('k8s/') || rel.includes('/k8s/')
}

/**
 * Чи файловий шлях усередині `dirAbs` (або збігається).
 * @param {string} dirAbs каталог
 * @param {string} fileAbs файл
 * @returns {boolean} true, якщо файл — піддерево каталогу
 */
function isResolvedFileUnderDirectory(dirAbs, fileAbs) {
  const b = resolve(dirAbs)
  const f = resolve(fileAbs)
  const r = relative(b, f).replaceAll('\\', '/')
  if (r === '' || r === '.') {
    return true
  }
  return !r.startsWith('../') && r !== '..'
}

/**
 * @param {string} resolved абсолютний шлях
 * @param {string} rootNorm нормалізований корінь
 * @returns {Promise<boolean>} true, якщо resolved є k8s base-каталогом з kustomization.yaml
 */
async function isK8sBaseDir(resolved, rootNorm) {
  if (basename(resolved) !== 'base') return false
  if (!existsSync(join(resolved, 'kustomization.yaml'))) return false
  if (!isUnderK8sPathRelToRoot(rootNorm, resolved)) return false
  let st
  try {
    st = await stat(resolved)
  } catch {
    return false
  }
  return st.isDirectory()
}

/**
 * За списку посилань kustomize повертає каталоги `.../base` з `kustomization.yaml` (наслідування base).
 * @param {string} kustDir каталог kustomization.yaml
 * @param {string[]} pathRefs тільки resources / bases / components / crds
 * @param {string} rootNorm нормалізований корінь репо
 * @returns {Promise<string[]>} абсолютні шляхи (без дедуплікації, якщо кілька однакових ref)
 */
async function k8sBaseDirsFromKustomizeResourcePathRefs(kustDir, pathRefs, rootNorm) {
  /** @type {string[]} */
  const out = []
  for (const ref of pathRefs) {
    if (typeof ref === 'string' && !ref.includes('://') && ref.trim() !== '') {
      const resolved = resolve(kustDir, ref.trim())
      if (resolvedFilePathIsUnderRoot(rootNorm, resolved) && (await isK8sBaseDir(resolved, rootNorm))) {
        out.push(resolved)
      }
    }
  }
  return out
}

/**
 * Аналізує `resources` / `bases` / `components` / `crds` kustomization: чи в дереві є
 * `Deployment` / HPA / PDB.
 * @param {string} kustAbs kustomization.yaml
 * @param {string} rootNorm корінь
 * @returns {Promise<{ hasDeployment: boolean, hasHpa: boolean, hasPdb: boolean }>} прапорці
 */
export async function kustomizeResourceTreeHpaPdbDeploymentFlags(kustAbs, rootNorm) {
  /** @type {Set<string>} */
  const visitedKustomization = new Set()
  const desc = await collectResourceDescriptorsForKustomizationWalk(kustAbs, rootNorm, visitedKustomization)
  return {
    hasDeployment: desc.some(d => d.kind === 'Deployment'),
    hasHpa: desc.some(d => d.kind === 'HorizontalPodAutoscaler'),
    hasPdb: desc.some(d => d.kind === 'PodDisruptionBudget')
  }
}

/**
 * Чи серед документів YAML-файлу є `HorizontalPodAutoscaler` або `PodDisruptionBudget`.
 * @param {string} fileAbs абсолютний шлях
 * @returns {Promise<boolean>} true, якщо такі kind знайдені
 */
async function yamlFileContainsHpaOrPdbDocument(fileAbs) {
  const raw = await tryReadFileUtf8(fileAbs)
  if (raw === undefined) {
    return false
  }
  const docs = tryParseAllYamlDocs(raw)
  if (docs === undefined) {
    return false
  }
  return docs.some(doc => {
    if (doc.errors.length > 0) return false
    const o = doc.toJSON()
    if (o === null || typeof o !== 'object' || Array.isArray(o)) return false
    const k = /** @type {Record<string, unknown>} */ (o).kind
    return k === 'HorizontalPodAutoscaler' || k === 'PodDisruptionBudget'
  })
}

/**
 * Для `…/k8s/…/base/kustomization.yaml`: HPA / PDB дозволені в дереві kustomize лише разом із Deployment.
 * @param {string} kustAbs kustomization.yaml
 * @param {string} rel для повідомлень
 * @param {(msg: string) => void} fail callback
 * @param {(msg: string) => void} passFn success
 * @param {(kust: string) => Promise<{ hasDeployment: boolean, hasHpa: boolean, hasPdb: boolean }>} getTreeFlags мемоізований аналіз дерева
 * @returns {Promise<void>}
 */
async function verifyK8sBaseKustomizeHpaPdbNeedDeployment(kustAbs, rel, fail, passFn, getTreeFlags) {
  const { hasDeployment, hasHpa, hasPdb } = await getTreeFlags(kustAbs)
  if (hasHpa || hasPdb) {
    if (hasDeployment) {
      passFn(`${rel}: у дереві kustomize base є HPA/PDB і Deployment (k8s.mdc)`)
    } else {
      fail(
        `${rel}: у base є HorizontalPodAutoscaler і/або PodDisruptionBudget у resources/bases/…, але дерева kustomize не містить Deployment — HPA і PDB дозволені тільки разом із Deployment (k8s.mdc)`
      )
    }
  }
}

/**
 * `kustomization` overlay, що посилається на `…/k8s/…/base`, не може додавати HPA / PDB як окремі YAML,
 * поки в наслідуваному base немає Deployment.
 * @param {string} root нормалізований корінь репо
 * @param {string} kustAbs kustomization.yaml
 * @param {string} rel для повідомлень
 * @param {Record<string, unknown>} kustObj перший документ
 * @param {(msg: string) => void} fail callback
 * @param {(msg: string) => void} passFn success
 * @param {(kust: string) => Promise<{ hasDeployment: boolean, hasHpa: boolean, hasPdb: boolean }>} getTreeFlags функція отримання прапорців дерева kustomize
 * @returns {Promise<void>}
 */
async function verifyOverlayHpaPdbFileRefsRespectBaseDeployment(
  root,
  kustAbs,
  rel,
  kustObj,
  fail,
  passFn,
  getTreeFlags
) {
  const kustDir = dirname(kustAbs)
  const pathRefs = resourcePathRefsFromKustomizationObject(kustObj)
  const baseDirs = await k8sBaseDirsFromKustomizeResourcePathRefs(kustDir, pathRefs, root)
  if (baseDirs.length === 0) {
    return
  }

  const treeFlags = await Promise.all(baseDirs.map(bd => getTreeFlags(join(bd, 'kustomization.yaml'))))
  const anyBaseHasDep = treeFlags.some(f => f.hasDeployment)

  for (const ref of pathRefs) {
    if (typeof ref === 'string' && !ref.includes('://') && ref.trim() !== '') {
      await checkOverlayRefHpaPdb(root, kustDir, rel, ref, baseDirs, anyBaseHasDep, fail, passFn)
    }
  }
}

/**
 * @param {string} root нормалізований корінь
 * @param {string} kustDir каталог kustomization.yaml
 * @param {string} rel відносний шлях для повідомлень
 * @param {string} ref посилання з pathRefs
 * @param {string[]} baseDirs масив base-каталогів
 * @param {boolean} anyBaseHasDep чи є Deployment у base
 * @param {(msg: string) => void} fail callback
 * @param {(msg: string) => void} passFn callback
 * @returns {Promise<void>}
 */
async function checkOverlayRefHpaPdb(root, kustDir, rel, ref, baseDirs, anyBaseHasDep, fail, passFn) {
  const fAbs = resolve(kustDir, ref.trim())
  if (!resolvedFilePathIsUnderRoot(root, fAbs) || !existsSync(fAbs)) return
  let st
  try {
    st = await stat(fAbs)
  } catch {
    return
  }
  if (!st.isFile() || !YAML_EXTENSION_RE.test(fAbs)) return
  const fUnderSomeBase = baseDirs.some(bd => isResolvedFileUnderDirectory(bd, fAbs))
  if (fUnderSomeBase) return
  const hpaPdb = await yamlFileContainsHpaOrPdbDocument(fAbs)
  if (!hpaPdb) return
  if (anyBaseHasDep) {
    passFn(
      `${rel}: overlay-файл «${(relative(root, fAbs) || ref).replaceAll('\\', '/')}» з HPA/PDB, base містить Deployment (k8s.mdc)`
    )
  } else {
    fail(
      `${rel}: посилання «${ref}» містить HorizontalPodAutoscaler і/або PodDisruptionBudget, а наслідуваний k8s/base не дає у дереві Deployment — прибери HPA/PDB або додай Deployment у base (k8s.mdc)`
    )
  }
}

/**
 * Перевіряє всі кастомізації: (1) у k8s/base дереві HPA/PDB тільки з Deployment; (2) overlay, що
 * посилається на base, не додає HPA/PDB без Deployment у base.
 * @param {string} root корінь репо
 * @param {string[]} yamlFilesAbs yaml у k8s
 * @param {(msg: string) => void} fail callback
 * @param {(msg: string) => void} passFn pass
 * @returns {Promise<void>}
 */
async function validateKustomizeHpaPdbOnlyWithBaseDeployment(root, yamlFilesAbs, fail, passFn) {
  const rootNorm = resolve(root)
  /** @type {Map<string, Promise<{ hasDeployment: boolean, hasHpa: boolean, hasPdb: boolean }>>} */
  const treeFlagsMemo = new Map()
  /**
   * @param {string} kustPath абсолютний шлях до kustomization.yaml
   * @returns {Promise<{ hasDeployment: boolean, hasHpa: boolean, hasPdb: boolean }>} прапорці наявності ресурсів у дереві
   */
  const getTreeFlags = kustPath => {
    const k = resolve(kustPath)
    let p = treeFlagsMemo.get(k)
    if (p === undefined) {
      p = kustomizeResourceTreeHpaPdbDeploymentFlags(k, rootNorm)
      treeFlagsMemo.set(k, p)
    }
    return p
  }
  const kustFiles = yamlFilesAbs.filter(abs => basename(abs).toLowerCase() === 'kustomization.yaml')
  for (const kustAbs of kustFiles) {
    const rel = (relative(rootNorm, kustAbs) || kustAbs).replaceAll('\\', '/')
    const kust = await readFirstYamlObject(kustAbs)
    if (kust !== null) {
      if (isK8sBaseKustomizationRelPath(rel)) {
        await verifyK8sBaseKustomizeHpaPdbNeedDeployment(kustAbs, rel, fail, passFn, getTreeFlags)
      } else {
        await verifyOverlayHpaPdbFileRefsRespectBaseDeployment(rootNorm, kustAbs, rel, kust, fail, passFn, getTreeFlags)
      }
    }
  }
}

/**
 * Перевіряє прод-оверрайди HPA/PDB в одному kustomization.yaml.
 * @param {Record<string, unknown>} kust об'єкт kustomization
 * @param {string} rel відносний шлях для повідомлень
 * @param {(msg: string) => void} fail callback при помилці
 * @param {(msg: string) => void} passFn callback при успіху
 */
function checkProdOverridesInKustomization(kust, rel, fail, passFn) {
  const byKind = kustomizationPatchPathsByTargetKind(kust)
  const hpaPaths = byKind.get('HorizontalPodAutoscaler') ?? new Set()
  const pdbPaths = byKind.get('PodDisruptionBudget') ?? new Set()
  let ok = true
  if (!hpaPaths.has('/spec/minReplicas')) {
    fail(
      `${rel}: прод-оверлей має перевизначати spec.minReplicas для HorizontalPodAutoscaler (мінімум 2 у проді) (k8s.mdc)`
    )
    ok = false
  }
  if (!hpaPaths.has('/spec/maxReplicas')) {
    fail(
      `${rel}: прод-оверлей має перевизначати spec.maxReplicas для HorizontalPodAutoscaler (мінімум 2 у проді) (k8s.mdc)`
    )
    ok = false
  }
  if (!pdbPaths.has('/spec/minAvailable')) {
    fail(
      `${rel}: прод-оверлей має перевизначати spec.minAvailable для PodDisruptionBudget (мінімум 1 у проді) (k8s.mdc)`
    )
    ok = false
  }
  if (ok) {
    passFn(`${rel}: прод-оверрайди HPA minReplicas/maxReplicas і PDB minAvailable присутні (k8s.mdc)`)
  }
}

/**
 * Для прод kustomization.yaml вимагає patches, що перевизначають **`/spec/minReplicas`** і **`/spec/maxReplicas`**
 * на **HorizontalPodAutoscaler**, а також **`/spec/minAvailable`** на **PodDisruptionBudget**. Не застосовується
 * до dev-like (base / dev / *-qa) — там ці значення беруть з base (див. k8s.mdc).
 * @param {string} root корінь репозиторію
 * @param {string[]} yamlFilesAbs yaml під k8s
 * @param {(msg: string) => void} fail callback при помилці
 * @param {(msg: string) => void} passFn callback при успіху
 */
async function validateProdKustomizationOverrides(root, yamlFilesAbs, fail, passFn) {
  const kustFiles = yamlFilesAbs.filter(abs => basename(abs) === 'kustomization.yaml')
  for (const kustAbs of kustFiles) {
    const rel = relative(root, kustAbs).replaceAll('\\', '/')
    const segment = k8sEnvSegmentFromRelPath(rel)
    if (segment !== null && !isDevLikeK8sEnvSegment(segment)) {
      const kust = await readFirstYamlObject(kustAbs)
      if (kust !== null) {
        checkProdOverridesInKustomization(kust, rel, fail, passFn)
      }
    }
  }
}

/**
 * Шукає HPA за `scaleTargetRef.name` серед документів.
 * @param {Record<string, unknown>[]} hpaDocs масив HPA-документів
 * @param {string} deployName ім'я Deployment
 * @returns {Record<string, unknown> | undefined} знайдений HPA або undefined
 */
function findHpaByDeployName(hpaDocs, deployName) {
  return hpaDocs.find(h => {
    const spec = getNestedObject(h, 'spec')
    if (spec === null) return false
    const str = getNestedObject(spec, 'scaleTargetRef')
    if (str === null) return false
    return str.name === deployName
  })
}

/**
 * Шукає PDB за `selector.matchLabels.app` серед документів.
 * @param {Record<string, unknown>[]} pdbDocs масив PDB-документів
 * @param {string} appLabel очікувана мітка `app`
 * @returns {Record<string, unknown> | undefined} знайдений PDB або undefined
 */
function findPdbByAppLabel(pdbDocs, appLabel) {
  return pdbDocs.find(p => {
    const spec = getNestedObject(p, 'spec')
    if (spec === null) return false
    const selector = getNestedObject(spec, 'selector')
    if (selector === null) return false
    const ml = getNestedObject(selector, 'matchLabels')
    if (ml === null) return false
    return ml.app === appLabel
  })
}

/**
 * Перевіряє HPA для одного Deployment: наявність, відповідність spec, env-залежні межі.
 * @param {Record<string, unknown>[]} hpaDocs масив HPA-документів каталогу
 * @param {string} deployName ім'я Deployment
 * @param {boolean} isDevLike чи середовище dev-like
 * @param {string} hpaRel відносний шлях до hpa.yaml для повідомлень
 * @param {(msg: string) => void} fail callback при помилці
 * @param {(msg: string) => void} passFn callback при успіху
 */
function validateHpaForDeployment(hpaDocs, deployName, isDevLike, hpaRel, fail, passFn) {
  const matchedHpa = findHpaByDeployName(hpaDocs, deployName)
  if (matchedHpa === undefined) {
    fail(
      `${hpaRel}: відсутній або не знайдено HPA зі scaleTargetRef.name='${deployName}' поруч із Deployment (k8s.mdc)`
    )
    return
  }
  const hpaErrs = hpaManifestViolations(matchedHpa, deployName, isDevLike)
  if (hpaErrs.length === 0) {
    passFn(`${hpaRel}: HPA для Deployment '${deployName}' валідний (k8s.mdc)`)
  } else {
    for (const e of hpaErrs) fail(`${hpaRel}: ${e} (k8s.mdc)`)
  }
}

/**
 * Перевіряє PDB для одного Deployment: наявність, відповідність selector, env-залежні межі.
 * @param {Record<string, unknown>[]} pdbDocs масив PDB-документів каталогу
 * @param {string} deployName ім'я Deployment
 * @param {string} appLabel мітка `app` Deployment
 * @param {boolean} isDevLike чи середовище dev-like
 * @param {string} pdbRel відносний шлях до pdb.yaml для повідомлень
 * @param {(msg: string) => void} fail callback при помилці
 * @param {(msg: string) => void} passFn callback при успіху
 */
function validatePdbForDeployment(pdbDocs, deployName, appLabel, isDevLike, pdbRel, fail, passFn) {
  const matchedPdb = findPdbByAppLabel(pdbDocs, appLabel)
  if (matchedPdb === undefined) {
    fail(
      `${pdbRel}: відсутній або не знайдено PDB зі selector.matchLabels.app='${appLabel}' поруч із Deployment (k8s.mdc)`
    )
    return
  }
  const pdbErrs = pdbManifestViolations(matchedPdb, appLabel, isDevLike)
  if (pdbErrs.length === 0) {
    passFn(`${pdbRel}: PDB для Deployment '${deployName}' валідний (k8s.mdc)`)
  } else {
    for (const e of pdbErrs) fail(`${pdbRel}: ${e} (k8s.mdc)`)
  }
}

/**
 * Перевіряє один Deployment: topologySpreadConstraints, HPA та PDB.
 * @param {Record<string, unknown>} deployment об'єкт Deployment
 * @param {string} deployRel відносний шлях каталогу для повідомлень
 * @param {boolean} isDevLike чи середовище dev-like
 * @param {Record<string, unknown>[]} hpaDocs HPA-документи каталогу
 * @param {Record<string, unknown>[]} pdbDocs PDB-документи каталогу
 * @param {(msg: string) => void} fail callback при помилці
 * @param {(msg: string) => void} passFn callback при успіху
 */
function validateSingleDeploymentHpaPdbTopology(deployment, deployRel, isDevLike, hpaDocs, pdbDocs, fail, passFn) {
  const deployName = manifestMetadataName(deployment)
  const appLabel = deploymentAppLabel(deployment)
  if (deployName === null) {
    fail(`${deployRel}: Deployment без metadata.name — не можу перевірити HPA/PDB (k8s.mdc)`)
    return
  }
  if (appLabel === null) {
    fail(`${deployRel}: Deployment '${deployName}' без spec.selector.matchLabels.app — додай мітку (k8s.mdc)`)
    return
  }
  const tscViolation = deploymentTopologySpreadConstraintsViolation(deployment, appLabel)
  if (tscViolation === null) {
    passFn(`${deployRel}: Deployment '${deployName}' має канонічні topologySpreadConstraints (k8s.mdc)`)
  } else {
    fail(`${deployRel}: Deployment '${deployName}': ${tscViolation}`)
  }
  validateHpaForDeployment(hpaDocs, deployName, isDevLike, `${deployRel}/${HPA_FILENAME}`, fail, passFn)
  validatePdbForDeployment(pdbDocs, deployName, appLabel, isDevLike, `${deployRel}/${PDB_FILENAME}`, fail, passFn)
}

/**
 * Обробляє один каталог з Deployment: читає HPA/PDB і перевіряє кожен Deployment.
 * @param {Record<string, unknown>[]} deployments масив Deployment-документів
 * @param {string} dir абсолютний шлях до каталогу
 * @param {string} root корінь репозиторію
 * @param {(msg: string) => void} fail callback при помилці
 * @param {(msg: string) => void} passFn callback при успіху
 */
async function validateDeploymentsInDir(deployments, dir, root, fail, passFn) {
  const relDir = relative(root, dir).replaceAll('\\', '/')
  const segment = k8sEnvSegmentFromRelPath(relDir + '/')
  const isDevLike = isDevLikeK8sEnvSegment(segment)
  const hpaDocs = await readDocsByKindInDir(dir, 'HorizontalPodAutoscaler', HPA_FILENAME)
  const pdbDocs = await readDocsByKindInDir(dir, 'PodDisruptionBudget', PDB_FILENAME)
  const deployRel = relDir === '' ? '.' : relDir
  for (const deployment of deployments) {
    validateSingleDeploymentHpaPdbTopology(deployment, deployRel, isDevLike, hpaDocs, pdbDocs, fail, passFn)
  }
}

/**
 * Витягує документи Deployment з YAML-файлу (повертає порожній масив, якщо файл недоступний або немає Deployment).
 * @param {string} filePath абсолютний шлях до YAML-файлу
 * @returns {Promise<Record<string, unknown>[]>} масив Deployment-документів
 */
async function extractDeploymentsFromFile(filePath) {
  const raw = await tryReadFileUtf8(filePath)
  if (raw === undefined) return []
  const docs = tryParseAllYamlDocs(raw)
  if (docs === undefined) return []
  return collectDocsByKind(docs, 'Deployment')
}

/**
 * Для кожного **Deployment** під `k8s/` перевіряє: у тому ж каталозі повинні бути
 * `hpa.yaml` (валідний `autoscaling/v2`) і `pdb.yaml` (валідний `policy/v1`), а сам Deployment
 * повинен мати канонічні **topologySpreadConstraints**. Env-залежні межі (`minReplicas`,
 * `minAvailable`) — за сегментом після `/k8s/`: `base` / `dev` / `*-qa` = dev-like, решта — прод.
 * @param {string} root корінь репозиторію
 * @param {string[]} yamlFilesAbs yaml під k8s
 * @param {(msg: string) => void} fail callback при помилці
 * @param {(msg: string) => void} passFn callback при успіху
 */
async function validateDeploymentHpaPdbAndTopology(root, yamlFilesAbs, fail, passFn) {
  /** @type {Set<string>} */
  const seenDirs = new Set()
  for (const abs of yamlFilesAbs) {
    const dir = dirname(abs)
    if (!seenDirs.has(dir)) {
      const deployments = await extractDeploymentsFromFile(abs)
      if (deployments.length > 0) {
        seenDirs.add(dir)
        await validateDeploymentsInDir(deployments, dir, root, fail, passFn)
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

  await validateHasuraHttpRouteCanon(root, yamlFiles, fail)

  await validateKustomizationIncludesSvcHlWithSvc(root, yamlFiles, fail)

  await validateKustomizationJson6902NoRemoveAddSamePath(root, yamlFiles, fail)

  await validateKustomizationPathRefsExistOnDisk(root, yamlFiles, fail)

  await validateKustomizationResourcesSortedAlphabetically(root, yamlFiles, fail)

  await validateKustomizationPatchTargetsResolved(root, yamlFiles, fail)

  await validateKustomizeHpaPdbOnlyWithBaseDeployment(root, yamlFiles, fail, pass)

  await ensureBaseKustomizationHasNamespace(root, yamlFiles, fail)

  await validateConfigMapNameMatchesDeployment(root, yamlFiles, fail, pass)

  await validateHasuraConfigMapRemoteSchemaPermissions(root, yamlFiles, fail, pass)

  await validateDeploymentHpaPdbAndTopology(root, yamlFiles, fail, pass)

  await validateProdKustomizationOverrides(root, yamlFiles, fail, pass)

  return reporter.getExitCode()
}

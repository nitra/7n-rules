/**
 * Перевіряє Kubernetes YAML у шляхах з сегментом `k8s` (див. k8s.mdc).
 *
 * Перший рядок `# yaml-language-server: $schema=…` (URL за `https://`), без дублікатів, розширення `.yaml`
 * (окрім `kustomization.yaml`); URL схеми за першим документом — kustomization / yannh / datree
 * (**виняток:** `apiVersion: alb.yc.io/v1alpha1`, `kind: HttpBackendGroup` — рядка `# yaml-language-server:` у файлі бути не має).
 * (datree за замовчуванням: GitHub Pages `https://datreeio.github.io/CRDs-catalog/…`).
 *
 * Modeline **опційний**: якщо публічної схеми немає (yannh/datree/schemastore не покривають це поєднання
 * apiVersion/kind), залиш файл **без** рядка `# yaml-language-server: $schema=…` — `check-k8s` пропустить
 * перевірку URL. **Заборонено** ставити `$schema=file:…` як заглушку (це фальшива валідація). Якщо modeline
 * присутній, він має бути **першим рядком** і містити `https://` URL, що відповідає очікуваному за apiVersion/kind.
 *
 * Додатково: у кожному YAML-документі з **`kind: Deployment`** у кожного контейнера
 * **`spec.template.spec.containers[]`** має бути **`resources.requests.cpu`** і **`resources.requests.memory`**
 * (непорожні скаляри). У шарі **`…/k8s/…/base/…`** значення жорстко **`cpu: '0.02'`**, **`memory: '128Mi'`**
 * (для **cpu** допускається число **`0.02`**). Поза base, якщо ще не підібрано власні
 * ліміти — орієнтир **`DEFAULT_CONTAINER_CPU_REQUEST`** = **`"0.5"`**, **`DEFAULT_CONTAINER_MEMORY_REQUEST`**
 * = **`"512Mi"`**. Поле **`imagePullPolicy`**
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
 * Рядок **`apiVersion: batch/v1beta1`** (CronJob, Job) **автоматично** переписується на **`apiVersion: batch/v1`**
 * (окрім рядків-коментарів і рядків, де після значення йде наприклад `# …`).
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
 * Поле **`namespace`** у **`backendRef`**, що збігається з **`metadata.namespace`** самого маршруту, — надлишкове:
 * прибери його, бо за замовчуванням Gateway API резолвить backend у тому ж namespace, що й маршрут (див. k8s.mdc).
 * **HealthCheckPolicy** (**`networking.gke.io/v1`**, GKE): **`spec.targetRef`** на **Service** — **`name`** з суфіксом **`-hl`** (див. k8s.mdc).
 * Якщо **`kustomization.yaml`** посилається на **`svc.yaml`** (**`resources`**, **`bases`**, **`components`**, **`crds`**,
 * **`patches[].path`**, **`patchesStrategicMerge`**), у **тому ж** файлі має бути посилання на відповідний **`svc-hl.yaml`**
 * в **тому ж каталозі**, що й **`svc.yaml`** (логіка збігається з **`pathsFromKustomizationObject`**).
 *
 * Структура **Kustomize** (див. k8s.mdc): заборона шляхів **`…/k8s/dev/…`**; у **`k8s/base/kustomization.yaml`**
 * завжди має бути непорожнє поле **`namespace:`** (перевірка, якщо файл існує). У **`apiVersion: kustomize.config.k8s.io/…`**, **`kind: Kustomization`**
 * перелік **`resources:`** (лише непорожні рядки) має бути відсортовано за алфавітом (**en**, `localeCompare`).
 *
 * **Структурний сорт `patches[]` у kustomization.yaml:** масив **`patches`** має бути відсортовано за tuple
 * **`[target.kind, target.name, target.namespace, path]`** (`localeCompare('en', base)`). Поля **`group`** / **`version`**
 * у tuple не входять — для них діє правило «patches[].target: лише kind і name». Додатково: вміст
 * **inline `patches[i].patch`** (literal block scalar — масив JSON6902-операцій) має бути відсортовано за **`path`**,
 * але **лише** якщо всі операції — **`add`** / **`replace`** і всі **`path`** попарно дизʼюнктні (жоден не префікс іншого).
 * Інакше порядок не чіпається — `move` / `copy` / `test` / `remove` чи спільні шляхи можуть бути семантично залежні (RFC 6902).
 *
 * **Inline JSON6902** у **`patches`** (і зовнішні файли з **`patches[].path`** під **`k8s`**, якщо вміст — масив JSON Patch): не допускається пара **`remove`** і **`add`**
 * на один і той самий **`path`** у межах одного фрагмента — потрібен **`op: replace`** (k8s.mdc). **check-k8s** це перевіряє.
 *
 * **Мішень patch:** у **`patches[].target`** і **`patchesJson6902[].target`** (без **labelSelector** / **annotationSelector**)
 * має існувати відповідний ресурс у зібраному з **`resources`**, **`bases`**, **`components`**, **`crds`** каталозі (рекурсивно для підкаталогів з **`kustomization.yaml`**).
 * Для **`patchesStrategicMerge`** і для **`patches[].path`** без **`target`** і без inline **`patch`** (зовнішній strategic-merge)
 * кожен YAML-документ з кореневим **`kind`** і **`metadata.name`** також звіряється з цим каталогом.
 *
 * **Зайві `group` / `version` у `patches[].target` / `patchesJson6902[].target`:** якщо в інвентарі **`resources`** /
 * **`bases`** / **`components`** / **`crds`** (рекурсивно) за **`kind`** + **`name`** немає колізії між різними
 * API-групами/версіями, поля **`group`** і **`version`** у **`target`** треба прибрати — Kustomize резолвить ціль
 * за **GVK + name**, а зайві поля ламаються мовчки під час змін API (k8s.mdc «patches[].target: лише kind і name»).
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
 * **HPA / PDB / topologySpreadConstraints:** для кожного **`Deployment`** у шарі **`…/k8s/…/base/`**
 * (будь-який `.yaml` у цьому каталозі) обов'язкові канонічні **topologySpreadConstraints**, а HPA і PDB
 * живуть у sibling каталозі **`…/k8s/…/components/`** (Kustomize Component, фіксована назва каталогу `components`). У `base/`
 * заборонено тримати локальні `hpa.yaml` і `pdb.yaml` (file-existence error) і також у дереві
 * base-kustomize не повинно бути HPA/PDB через `resources` / `components` / `bases`.
 * **NetworkPolicy:** для кожного **`Deployment`**, **`StatefulSet`**, **`DaemonSet`**, **`Job`**, **`CronJob`** під `k8s`
 * обов'язковий канонічний NetworkPolicy у `networkpolicy.yaml` поруч з workload-маніфестом — у base
 * (`base/networkpolicy.yaml`, підключений через `base/kustomization.yaml` `resources:` — обмеження діють і на dev)
 * і у не-base overlay (опційно — overlay-specific override).
 * Egress: kube-dns; **TCP 80/443** на `0.0.0.0/0`; інші порти — `namespaceSelector: {}` (in-cluster / `*.svc`). Заборонено `egress: [{}]`.
 * Відсутні документи **`check k8s`** створює автоматично (multi-doc у одному файлі, якщо workload-ів кілька).
 * Структура `components/`: `kustomization.yaml` з `apiVersion: kustomize.config.k8s.io/v1alpha1`, `kind: Component`,
 * `resources` що містять `hpa.yaml` і `pdb.yaml`, `hpa.yaml` (валідний `autoscaling/v2`
 * HorizontalPodAutoscaler з `scaleTargetRef.name` = ім'я Deployment, dev-like `min=max=1`), `pdb.yaml` (валідний
 * `policy/v1` PodDisruptionBudget з `selector.matchLabels.app` = мітка `app` Deployment, dev-like `minAvailable=0`).
 * Overlays (`ua/`, прод-overlays) підключають `components: [- ../components]` і додають JSON6902-патчі для
 * прод-значень: `/spec/minReplicas`, `/spec/maxReplicas` (HPA), `/spec/minAvailable` (PDB). HPA поруч із Deployment
 * у не-base оверлеях — як раніше (див. k8s.mdc).
 * Env-залежні межі за сегментом після `/k8s/`: **dev-like** (`base`, `dev`, `*-qa`) — для HPA, що лишився після
 * збірки, `minReplicas === 1`, `maxReplicas === 1`, PDB `minAvailable === 0`; **прод** — `minReplicas >= 2`,
 * `maxReplicas >= 2`, `minAvailable >= 1`.
 *
 * **Прод-оверрайди в kustomization.yaml:** для прод overlays (не dev-like) у `patches[]` потрібні перевизначення
 * **`/spec/minReplicas`** і **`/spec/maxReplicas`** для **HorizontalPodAutoscaler** і **`/spec/minAvailable`** для
 * **PDB** — якщо overlay-tree (через `resources` / `components`) містить HPA / PDB (тобто overlay підключив
 * `…/k8s/…/components/`). Формат patch — JSON6902 або Strategic Merge; наявність шляхів —
 * `kustomizationPatchPathsByTargetKind`.
 *
 * **Існування шляхів у `kustomization.yaml`:** кожне локальне посилання (без `://`) з `resources` / `bases` /
 * `components` / `crds`, `patchesStrategicMerge`, `patches[].path`, `patchesJson6902[].path`, `configurations[]`,
 * `replacements[].path` має вказувати на наявний у репозиторії файл (`.yaml` / `.yml`) або каталог; інакше
 * помилка `check k8s` (k8s.mdc).
 *
 * **Images у Kustomize — `images:`, не patch:** для кожного `kustomization.yaml` автоматично:
 * (а) конвертує JSON6902 `op: replace` на `/spec/template/spec/containers/<N>/image` (target `kind: Deployment`) у
 * запис **`images:`** — `name` береться з оригінального `image:` у base (без тегу), `newName` — з patch.value (без тегу),
 * `newTag` — лише якщо тег у patch.value відрізняється від тега в base; якщо `patches[]` після цього порожній — ключ
 * прибирається; (б) чистить існуючий блок **`images:`** — зрізає `:tag` з `name` (digest `@…` не чіпає) і видаляє
 * `newTag`, який збігається з відрізаним тегом.
 *
 * **HPA / PDB заборонені у base-дереві Kustomize:** у дереві з `…/k8s/…/base/kustomization.yaml` не дозволяти
 * `HorizontalPodAutoscaler` / `PodDisruptionBudget` у `resources` / `bases` / `components` / `crds` (рекурсивно)
 * взагалі. Канон — HPA/PDB у sibling `…/k8s/…/components/` (Kustomize Component) і підключаються лише з overlay.
 * У `kustomization.yaml` overlay, який підключає каталог `…/k8s/…/base`, не додавай окремі YAML-файли з HPA / PDB,
 * поки в наслідуваному `base` у дереві не з'явиться такий Deployment (k8s.mdc).
 */
import { existsSync } from 'node:fs'
import { readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'

import { isSeq, parseAllDocuments, parseDocument } from 'yaml'

import { createCheckReporter } from '../../../../scripts/utils/check-reporter.mjs'
import { loadCursorIgnorePaths } from '../../../../scripts/utils/load-cursor-config.mjs'
import { runConftestBatch } from '../../../../scripts/utils/run-conftest-batch.mjs'
import { walkDir } from '../../../../scripts/utils/walkDir.mjs'

/** Версія набору схем yannh — узгоджено з k8s.mdc */
const YAML_LS_MODELINE_RE = /^# yaml-language-server: \$schema=.*\n/

const YANNH_PIN = 'v1.33.9-standalone-strict'

/**
 * Дозволений образ **hasura/graphql-engine** у Deployment (узгоджено з k8s.mdc).
 * Еквівалент **`docker.io/…`** також приймається.
 */
export const HASURA_GRAPHQL_ENGINE_IMAGE = 'hasura/graphql-engine:v2.48.15.ubi.amd64'

/**
  Набір прийнятних рядків `image` без digest (`@sha256:…`).
 */
const HASURA_GRAPHQL_ENGINE_ALLOWED_IMAGES = new Set([
  HASURA_GRAPHQL_ENGINE_IMAGE,
  `docker.io/${HASURA_GRAPHQL_ENGINE_IMAGE}`
])

/**
 * Чи відносний POSIX-шлях від кореня репо вказує на YAML під **`…/k8s/…/base/…`** (після сегмента **`k8s`** у шляху
 * є каталог **`base`**). Тут очікуються маніфести шару **base**, включно з будь-яким файлом із **`kind: Deployment`**
 * (наприклад **`deploy.yaml`**, **`deployment.yaml`**).
 * @param {string} relPosix шлях через `/`
 * @returns {boolean} true, якщо шлях лежить у каталозі `…/k8s/…/base/`
 */
export function isK8sYamlUnderBaseDirectory(relPosix) {
  const parts = relPosix.replaceAll('\\', '/').split('/').filter(Boolean)
  const k = parts.indexOf('k8s')
  if (k === -1) return false
  const dirs = parts.slice(k + 1, -1)
  return dirs.includes('base')
}

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

const GATEWAY_API_GROUP_PREFIX = 'gateway.networking.k8s.io/'

const MODELINE_RE = /^#\s*yaml-language-server:\s*\$schema=(\S+)\s*$/
const PATH_SPLIT_RE = /[/\\]/u
const YAML_EXTENSION_RE = /\.ya?ml$/iu
const YAML_LINE_SPLIT_RE = /\r?\n/u
const API_VERSION_FIELD_RE = /^\s*apiVersion:\s*(\S+)\s*$/
const KIND_FIELD_RE = /^\s*kind:\s*(\S+)\s*$/
const TYPE_FIELD_RE = /^\s*type:\s*(\S+)\s*$/
const YAML_DOC_SEPARATOR_LINE_RE = /^---\s*$/
const K8S_BASE_KUSTOMIZATION_PATH_RE = /(^|\/)k8s\/base\/kustomization\.yaml$/u
const K8S_BASE_SEGMENT_RE = /(^|\/)k8s\/base\//u
const OXLINT_SCHEMA_MODELINE_RE = /^\s*#\s*yaml-language-server:\s*\$schema=\S+/u
const HTTPS_SCHEMA_RE = /^https:/iu
const HASURA_GRAPHQL_ENGINE_RE = /(^|\/)hasura\/graphql-engine(?::|$)/u
const BASE_CANON_MEMORY_RE = /^128Mi$/iu

/**
 * Видаляє хвостові символи `\n` зі стрічки без regex (щоб не тригерити sonarjs/slow-regex).
 * @param {string} s стрічка YAML/тексту
 * @returns {string} стрічка без trailing newlines
 */
function stripTrailingNewlines(s) {
  let end = s.length
  while (end > 0 && s.codePointAt(end - 1) === 10) end--
  return end === s.length ? s : s.slice(0, end)
}
const BATCH_V1BETA1_API_VERSION_LINE_RE = /^(\s*apiVersion:\s*)["']?batch\/v1beta1["']?(\s*)$/u

/**
 * Чи містить шлях сегмент директорії `k8s` (рівно ця назва компонента).
 *
 * Якщо передано `root`, перевірка ведеться **відносно** кореня репо — інакше випадає
 * false-positive, коли сам корінь репо вже містить компонент `k8s` (напр.
 * `/Users/.../abie/k8s/`): без relativize функція б повертала true для **усіх** файлів
 * у проєкті, включно з `.github/workflows/*.yml`, які належать іншому правилу (`ga.mdc`).
 *
 * Без `root` (як у юніт-тестах або коли шлях уже відносний) спрацьовує старий шлях:
 * розбиття за `/`/`\` і пошук компонента `k8s`.
 * @param {string} filePath абсолютний або відносний шлях до файлу
 * @param {string} [root] корінь репо для relativize (типово — без relativize)
 * @returns {boolean} true, якщо серед компонентів шляху **відносно root** є каталог `k8s`
 */
export function pathHasK8sSegment(filePath, root) {
  const target = root ? relative(root, filePath).replaceAll('\\', '/') : filePath
  // Порожній relative означає сам root — у ньому компонента `k8s` відносно себе немає.
  if (target === '') return false
  const parts = target.split(PATH_SPLIT_RE)
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
  /**
  @type {string[]}
   */
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

// Plan B: per-document `resources[]` sort у Kustomization — у rego-пакеті
// `k8s.kustomization`, викликається з `runAllK8sRego` на початку `check()`.
// JS-orchestrator validateKustomizationResourcesSortedAlphabetically видалено.

/**
 * Лексичне порівняння двох tuple рядків через `localeCompare('en', { sensitivity: 'base' })`.
 * Менший за довжиною список доповнюється порожніми рядками.
 * @param {string[]} a перший tuple
 * @param {string[]} b другий tuple
 * @returns {number} `< 0` якщо `a` менший, `> 0` якщо більший, `0` — рівні
 */
function compareStringTuplesEn(a, b) {
  const n = Math.max(a.length, b.length)
  for (let i = 0; i < n; i++) {
    const av = a[i] ?? ''
    const bv = b[i] ?? ''
    const c = av.localeCompare(bv, 'en', { sensitivity: 'base' })
    if (c !== 0) return c
  }
  return 0
}

/**
 * Чи послідовність tuple-ключів відсортована за `compareStringTuplesEn`.
 * @param {string[][]} tuples масив tuple-ключів у порядку, як у файлі
 * @returns {boolean} true, якщо порядок неспадний
 */
function stringTuplesAreSortedEn(tuples) {
  for (let i = 1; i < tuples.length; i++) {
    if (compareStringTuplesEn(tuples[i - 1], tuples[i]) > 0) return false
  }
  return true
}

/**
 * Tuple-ключ для сортування одного запису `patches[]` Kustomization.
 * Порядок ключів: `target.kind` → `target.name` → `target.namespace` → `path`. Відсутні поля = `''`
 * (порожні раніше за заповнені у `localeCompare` — стабільний детермінізм).
 * Поля `target.group` / `target.version` навмисно не входять у ключ — у repo діє правило
 * «patches[].target: лише kind і name», тому опертися на них не можна.
 * @param {unknown} patchItem елемент масиву `patches[]`
 * @returns {string[]} tuple для порівняння
 */
function kustomizationPatchSortKey(patchItem) {
  if (patchItem === null || typeof patchItem !== 'object' || Array.isArray(patchItem)) {
    return ['', '', '', '']
  }
  const rec = /** @type {Record<string, unknown>} */ (patchItem)
  const t = rec.target
  /**
  @type {Record<string, unknown>}
   */
  const target =
    t !== null && typeof t === 'object' && !Array.isArray(t) ? /** @type {Record<string, unknown>} */ (t) : {}
  const kind = typeof target.kind === 'string' ? target.kind : ''
  const name = typeof target.name === 'string' ? target.name : ''
  const ns = typeof target.namespace === 'string' ? target.namespace : ''
  const path = typeof rec.path === 'string' ? rec.path : ''
  return [kind, name, ns, path]
}

/**
 * Короткий ярлик запису `patches[]` для звітів («kind/name», або «path=…», або «#i»).
 * @param {unknown} patchItem елемент масиву
 * @param {number} i індекс у масиві (для fallback)
 * @returns {string} людинозрозумілий ярлик
 */
function kustomizationPatchLabel(patchItem, i) {
  const [kind, name, , path] = kustomizationPatchSortKey(patchItem)
  if (kind && name) return `${kind}/${name}`
  if (path) return `path=${path}`
  return `#${i}`
}

/**
 * Порушення сорту **`patches[]`**: лише для **`kustomize.config.k8s.io/…`**, **`kind: Kustomization`**.
 * Сортування за tuple `[target.kind, target.name, target.namespace, path]` (`localeCompare('en', base)`).
 * @param {unknown} obj корінь першого YAML-документа kustomization.yaml
 * @returns {string | null} причина або `null`, якщо обмеження не застосовується чи порядок ОК
 */
export function kustomizationPatchesSortedViolation(obj) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return null
  const rec = /** @type {Record<string, unknown>} */ (obj)
  if (rec.kind !== 'Kustomization') return null
  const av = rec.apiVersion
  if (typeof av !== 'string' || !av.startsWith(KUSTOMIZE_CONFIG_API_PREFIX)) return null
  const patches = rec.patches
  if (patches === undefined) return null
  if (!Array.isArray(patches)) {
    return 'Kustomization.patches має бути масивом (k8s.mdc)'
  }
  if (patches.length < 2) return null
  const keys = patches.map(p => kustomizationPatchSortKey(p))
  if (stringTuplesAreSortedEn(keys)) return null
  const order = patches.map((p, i) => ({ p, i, key: keys[i] }))
  order.sort((a, b) => compareStringTuplesEn(a.key, b.key) || a.i - b.i)
  const have = patches.map((p, i) => kustomizationPatchLabel(p, i)).join(', ')
  const want = order.map(x => kustomizationPatchLabel(x.p, x.i)).join(', ')
  return `Kustomization.patches має бути за алфавітом (target.kind → target.name → target.namespace → path). Зараз: ${have}; очікувано: ${want} (k8s.mdc)`
}

/** Чи рядок виглядає як JSON-Pointer-шлях `/…` (порожнє і `/` теж приймаються — `/` = корінь). */
const JSON_POINTER_RE = /^\/[^\s]*$|^$|^\/$/u

/**
 * Чи кожен `path` у наборі — окремий вузол JSON-Pointer (немає прямого префікс-збігу типу `/spec` vs `/spec/replicas`).
 * Однакові `path` теж вважаються «недизʼюнктними». Реалізація: `O(n²)` достатня для розмірів реальних patch-наборів.
 * @param {string[]} paths шляхи у тому ж порядку, що й у файлі
 * @returns {boolean} true, якщо всі шляхи попарно дизʼюнктні
 */
function jsonPointerPathsAreDisjoint(paths) {
  for (let i = 0; i < paths.length; i++) {
    for (let j = 0; j < paths.length; j++) {
      if (i === j) continue
      if (paths[i] === paths[j]) return false
      if (paths[j].startsWith(`${paths[i]}/`)) return false
    }
  }
  return true
}

/**
 * Парсить рядок JSON6902-патча в плоский масив операцій `{ op, path }` (без значень).
 * Повертає `null`, якщо це не YAML-масив об'єктів з полями `op`/`path` як рядки.
 * @param {string} raw тіло inline `patch:` (literal block scalar)
 * @returns {{ op: string, path: string }[] | null} нормалізований список ops або `null` за невідповідного формату
 */
function parseJson6902OpsFromText(raw) {
  let parsed
  try {
    parsed = parseDocument(raw).toJSON()
  } catch {
    return null
  }
  if (!Array.isArray(parsed)) return null
  /**
  @type {{ op: string, path: string }[]}
   */
  const out = []
  for (const item of parsed) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return null
    const rec = /** @type {Record<string, unknown>} */ (item)
    if (typeof rec.op !== 'string' || typeof rec.path !== 'string') return null
    out.push({ op: rec.op, path: rec.path })
  }
  return out
}

/**
 * Порушення сорту inline JSON6902-ops у одному `patches[i].patch`.
 * Сортуємо **тільки** «безпечний» набір: всі `op ∈ { add, replace }` і всі `path` дизʼюнктні
 * (немає префікс-зв'язку між шляхами). Інакше повертаємо `null` — порядок зберігаємо як у файлі,
 * бо `move`/`copy`/`test`/`remove` чи спільні шляхи можуть бути семантично залежні (RFC 6902).
 * @param {string} patchText вміст literal block (inline `patch:`)
 * @returns {string | null} опис порушення або `null`
 */
export function kustomizationInlinePatchOpsSortedViolation(patchText) {
  const ops = parseJson6902OpsFromText(patchText)
  if (ops === null) return null
  if (ops.length < 2) return null
  for (const o of ops) {
    if (o.op !== 'add' && o.op !== 'replace') return null
    if (!JSON_POINTER_RE.test(o.path)) return null
  }
  const paths = ops.map(o => o.path)
  if (!jsonPointerPathsAreDisjoint(paths)) return null
  /**
  @type {string[][]}
   */
  const keys = paths.map(p => [p])
  if (stringTuplesAreSortedEn(keys)) return null
  const want = paths.toSorted((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }))
  return `inline patch (JSON6902) має бути за алфавітом по path. Зараз: ${paths.join(', ')}; очікувано: ${want.join(', ')} (k8s.mdc)`
}

// Plan B: validateKustomizationPatchesStructuralSort видалено. Per-document
// `patches[]` sort + inline JSON6902 ops sort — у rego-пакеті `k8s.kustomization`,
// викликається з `runAllK8sRego`.

/**
 * Шляхи з полів Kustomization для resolve відносно каталогу **`kustomization.yaml`**.
 * @param {unknown} obj корінь першого документа Kustomization
 * @returns {string[]} відносні або абсолютні посилання з маніфесту
 */
function pathsFromKustomizationObject(obj) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return []
  const rec = /** @type {Record<string, unknown>} */ (obj)
  /**
  @type {string[]}
   */
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
 * @param {unknown} arr масив об'єктів із полем `path` (може бути не масивом)
 * @param {string[]} out вихідний масив для накопичення значень `path`
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
 * @param {unknown} arr масив рядків (може бути не масивом)
 * @param {string[]} out вихідний масив для накопичення непорожніх рядків
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
 * @param {(msg: string) => void} fail callback при помилці
 * @returns {Promise<void>} резолвиться по завершенню перевірки
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
  /**
  @type {import('node:fs').Stats | undefined}
   */
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
 * @returns {Promise<void>} результат
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
 * @returns {Promise<void>} результат
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
  /**
  @type {Set<string>}
   */
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
 * @returns {Promise<void>} результат
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
  /**
  @type {import('yaml').Document[] | undefined}
   */
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
 * @returns {Promise<void>} результат
 */
async function validateKustomizationIncludesSvcHlWithSvc(root, yamlFiles, fail) {
  for (const kustAbs of yamlFiles.filter(p => basename(p).toLowerCase() === 'kustomization.yaml')) {
    await validateOneKustomizationSvcHlWithSvc(root, kustAbs, fail)
  }
}

/**
 * Шляхи лише з полів ресурсів Kustomization (**без** patch-файлів).
 * @param {unknown} obj корінь першого документа Kustomization
 * @returns {string[]} відносні посилання
 */
function resourcePathRefsFromKustomizationObject(obj) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return []
  const rec = /** @type {Record<string, unknown>} */ (obj)
  /**
  @type {string[]}
   */
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
  /**
  @type {unknown[]}
   */
  const roots = parseK8sYamlDocumentObjectRoots(body)
  /**
  @type {Record<string, unknown>[]}
   */
  const out = []
  for (const r of roots) {
    if (r !== null && typeof r === 'object' && !Array.isArray(r)) {
      out.push(/** @type {Record<string, unknown>} */ (r))
    }
  }
  return out
}

/**
 * Збирає абсолютні шляхи до YAML-файлів із дерева **`resources` / `bases` / `components` / `crds`** (рекурсивно
 * через вкладені **kustomization.yaml**). Дублює обхід **`collectResourceDescriptorsForKustomizationWalk`**, але
 * повертає лише шляхи файлів — для перевірки наявності **`Deployment`** у YAML під **`…/k8s/…/base/`**.
 * @param {string} kustAbs абсолютний шлях до **kustomization.yaml**
 * @param {string} rootNorm нормалізований абсолютний корінь репозиторію
 * @param {Set<string>} visitedKustomization нормалізовані абсолютні шляхи відвіданих **kustomization.yaml**
 * @returns {Promise<string[]>} список абсолютних шляхів до `.yaml` / `.yml`
 */
async function collectYamlAbsPathsFromKustomizationTree(kustAbs, rootNorm, visitedKustomization) {
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

  /**
  @type {import('yaml').Document[] | undefined}
   */
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
  const kustDir = dirname(normKust)
  const pathRefs = resourcePathRefsFromKustomizationObject(first)

  /**
  @type {string[]}
   */
  const out = []

  /**
   * @param {string} ref шлях з resources/bases/…
   * @returns {Promise<void>} результат
   */
  async function handleResourcePathRef(ref) {
    if (typeof ref !== 'string' || ref.includes('://')) {
      return
    }
    const resolved = resolve(kustDir, ref)
    if (!resolvedFilePathIsUnderRoot(rootNorm, resolved)) {
      return
    }
    /**
  @type {import('node:fs').Stats | undefined}
     */
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
      out.push(resolved)
      return
    }
    if (!st.isDirectory()) {
      return
    }
    const childK = existsSync(join(resolved, 'kustomization.yaml')) ? join(resolved, 'kustomization.yaml') : null
    if (childK !== null) {
      const sub = await collectYamlAbsPathsFromKustomizationTree(childK, rootNorm, visitedKustomization)
      out.push(...sub)
    }
  }

  for (const ref of pathRefs) {
    await handleResourcePathRef(ref)
  }

  return out
}

/**
 * Чи в дереві kustomization є **`Deployment`** у будь-якому YAML під **`…/k8s/…/base/`** (умова для HPA/PDB у k8s.mdc).
 * @param {string} kustAbs kustomization.yaml
 * @param {string} rootNorm корінь репо
 * @returns {Promise<boolean>} true, якщо дерево містить Deployment у шарі base
 */
async function kustomizationTreeHasDeploymentUnderK8sBase(kustAbs, rootNorm) {
  const visited = new Set()
  const paths = await collectYamlAbsPathsFromKustomizationTree(kustAbs, rootNorm, visited)
  const rootResolved = resolve(rootNorm)
  for (const abs of paths) {
    const rel = (relative(rootResolved, abs) || '').replaceAll('\\', '/')
    if (!isK8sYamlUnderBaseDirectory(rel)) continue
    const roots = await readK8sYamlDocumentRootsForInventory(abs)
    if (roots.some(o => o.kind === 'Deployment')) return true
  }
  return false
}

/**
 * Збирає дескриптори ресурсів з **`resources` / `bases` / `components` / `crds`** для одного дерева kustomization.
 * Повторний вхід у той самий **`kustomization.yaml`** дає порожній внесок.
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

  /**
  @type {import('yaml').Document[] | undefined}
   */
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

  /**
  @type {KustomizeResourceDescriptor[]}
   */
  const out = []

  /*
 * @param {string} ref шлях з resources/bases/…
  
 * @returns {Promise<void>} результат
 */
  /**
   *
   * @param {*} ref параметр
   */ async function handleResourceDescriptorPathRef(ref) {
    if (typeof ref !== 'string' || ref.includes('://')) {
      return
    }
    const resolved = resolve(kustDir, ref)
    if (!resolvedFilePathIsUnderRoot(rootNorm, resolved)) {
      return
    }
    /**
  @type {import('node:fs').Stats | undefined}
     */
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
  /**
  @type {Array<{ section: string, index: number, target: unknown }>}
   */
  const out = []
  /*
 * @param {string} section ім’я поля
  
 * @param {unknown} arr масив з YAML
  
 * @returns {void} результат
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
 * @returns {void} результат
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
 * Зайві **`group`** / **`version`** у **`patches[].target`** / **`patchesJson6902[].target`**: якщо в інвентарі за **`kind`** + **`name`** немає колізії між різними API-групами/версіями, ці поля треба прибрати (k8s.mdc «patches[].target: лише kind і name»).
 * @param {string} rel відносний шлях до kustomization.yaml
 * @param {Record<string, unknown>} first корінь Kustomization
 * @param {KustomizeResourceDescriptor[]} catalog інвентар resources/bases/…
 * @param {(msg: string) => void} fail реєстрація помилки
 * @returns {void} результат
 */
function failIfExplicitPatchTargetsHaveRedundantGroupVersion(rel, first, catalog, fail) {
  for (const entry of extractExplicitPatchTargetsFromKustomization(first)) {
    const violation = describePatchTargetRedundancy(entry, catalog)
    if (violation === null) continue
    const { section, index, kind, name, redundant } = violation
    fail(
      `${rel}: ${section}[${index}].target — прибери зайві поля ${redundant.join(', ')}; для kind=${kind}, name=${name} в інвентарі немає колізії між різними API-групами/версіями (див. k8s.mdc «patches[].target: лише kind і name»)`
    )
  }
}

/**
 * Аналізує один patch.target: повертає опис надлишкових полів `group`/`version`,
 * якщо в інвентарі для пари (kind, name) немає колізії GVK; інакше `null`.
 * @param {{ section: string, index: number, target: unknown }} entry елемент із `extractExplicitPatchTargetsFromKustomization`
 * @param {KustomizeResourceDescriptor[]} catalog інвентар resources/bases/…
 * @returns {{ section: string, index: number, kind: string, name: string, redundant: string[] } | null} опис порушення або `null`
 */
function describePatchTargetRedundancy(entry, catalog) {
  const { section, index, target } = entry
  if (target === null || typeof target !== 'object' || Array.isArray(target)) return null
  const t = /** @type {Record<string, unknown>} */ (target)
  const kind = typeof t.kind === 'string' ? t.kind.trim() : ''
  const name = typeof t.name === 'string' ? t.name.trim() : ''
  if (kind === '' || name === '') return null
  if (patchTargetUsesSelector(t)) return null
  const tgtGroup = typeof t.group === 'string' ? t.group.trim() : ''
  const tgtVersion = typeof t.version === 'string' ? t.version.trim() : ''
  if (tgtGroup === '' && tgtVersion === '') return null
  const matchingByKindName = catalog.filter(r => r.kind === kind && r.name === name)
  const distinctGvk = new Set(matchingByKindName.map(r => `${r.group}/${r.version}`))
  if (distinctGvk.size > 1) return null
  /**
  @type {string[]}
   */
  const redundant = []
  if (tgtGroup !== '') redundant.push('group')
  if (tgtVersion !== '') redundant.push('version')
  return { section, index, kind, name, redundant }
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
 * @returns {Promise<void>} результат
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
  /**
  @type {import('node:fs').Stats | null}
   */
  let st
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
 * @returns {Promise<void>} результат
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
 * @returns {Promise<void>} результат
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
 * @returns {Promise<void>} результат
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
 * @returns {Promise<void>} результат
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
  /**
  @type {import('yaml').Document[]}
   */
  let docs
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
  failIfExplicitPatchTargetsHaveRedundantGroupVersion(rel, first, catalog, fail)
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
 * @returns {Promise<void>} результат
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
 * Збирає всі `*.yaml` та `*.yml` під деревом від кореня cwd, якщо шлях містить сегмент `k8s` (для `.yml` далі — fail з порадою перейменувати на `.yaml`; k8s.mdc).
 * @param {string} root корінь репозиторію (cwd)
 * @param {string[]} [ignorePaths] шляхи каталогів, повністю виключених з обходу
 * @returns {Promise<string[]>} відсортовані абсолютні шляхи до файлів
 */
async function findK8sYamlFiles(root, ignorePaths = []) {
  /**
  @type {string[]}
   */
  const out = []
  await walkDir(
    root,
    p => {
      const rel = relative(root, p).replaceAll('\\', '/')
      // `.github/` належить правилу `ga.mdc` (там канон — `.yml`); не зачіпай тут навіть
      // якщо `pathHasK8sSegment` колись зіб'ється на крайовому кейсі.
      if (rel.startsWith('.github/')) return
      if (!pathHasK8sSegment(p, root)) return
      if (!YAML_EXTENSION_RE.test(p)) return
      out.push(p)
    },
    ignorePaths
  )

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
 * @returns {void} результат
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
  /**
  @type {import('yaml').Document[]}
   */
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
 * @param {string[]} ignorePaths шляхи каталогів, повністю виключених з обходу
 * @param {(msg: string) => void} fail реєстрація порушення
 * @param {(msg: string) => void} pass реєстрація успіху
 * @returns {Promise<void>} результат
 */
async function removeBackendConfigOnlyK8sYamlFiles(root, ignorePaths, fail, pass) {
  const yamlFiles = await findK8sYamlFiles(root, ignorePaths)
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
 * Один рядок YAML: якщо це `apiVersion` зі значенням **`batch/v1beta1`**, повертає той самий рядок із **`batch/v1`**
 * (з тими самими відступами/пробілами після `apiVersion:`, крім випадків з лапками — нормалізується до `apiVersion: batch/v1`).
 * Рядки, що після trim починаються з `#`, не змінюються.
 * @param {string} line один рядок YAML
 * @returns {string} той самий рядок або з заміною apiVersion batch/v1beta1 на batch/v1
 */
function rewriteLineBatchV1beta1ApiVersion(line) {
  const t = line.trimStart()
  if (t.startsWith('#')) {
    return line
  }
  const m = line.match(BATCH_V1BETA1_API_VERSION_LINE_RE)
  if (m) {
    return `${m[1]}batch/v1${m[2]}`
  }
  return line
}

/**
 * У повному тексті YAML замінює всі **цілі** рядки `apiVersion: batch/v1beta1` (за потреби в лапках) на `apiVersion: batch/v1`.
 * Зберігає **CRLF** / **LF** як у вихідному рядку.
 * @param {string} raw вміст файлу
 * @returns {{ changed: boolean, content: string }} прапорець зміни та оновлений текст
 */
export function replaceBatchV1beta1ApiVersionInYamlText(raw) {
  const eol = raw.includes('\r\n') ? '\r\n' : '\n'
  const lines = raw.split(YAML_LINE_SPLIT_RE)
  let changed = false
  const out = lines.map(line => {
    const n = rewriteLineBatchV1beta1ApiVersion(line)
    if (n !== line) {
      changed = true
    }
    return n
  })
  if (!changed) {
    return { changed: false, content: raw }
  }
  return { changed: true, content: out.join(eol) }
}

/**
 * Проходить усі `*.yaml` / `*.yml` під сегментом `k8s` і на диску застосовує **`replaceBatchV1beta1ApiVersionInYamlText`**.
 * @param {string} root корінь репозиторію
 * @param {string[]} ignorePaths шляхи каталогів, повністю виключених з обходу
 * @param {(msg: string) => void} fail колбек повідомлення про помилку
 * @param {(msg: string) => void} pass колбек успішного повідомлення
 * @returns {Promise<void>} результат
 */
async function rewriteBatchV1beta1ApiVersionInK8sYamlFiles(root, ignorePaths, fail, pass) {
  const yamlFiles = await findK8sYamlFiles(root, ignorePaths)
  for (const abs of yamlFiles) {
    const rel = (relative(root, abs) || abs).replaceAll('\\', '/')
    try {
      const raw = await readFile(abs, 'utf8')
      const { changed, content } = replaceBatchV1beta1ApiVersionInYamlText(raw)
      if (changed) {
        await writeFile(abs, content, 'utf8')
        pass(`${rel}: оновлено apiVersion batch/v1beta1 → batch/v1 (k8s.mdc)`)
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      fail(`${rel}: не вдалося прочитати/записати при заміні batch/v1beta1 → batch/v1 (${msg})`)
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
  /**
  @type {string | undefined}
   */
  let apiVersion
  /**
  @type {string | undefined}
   */
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
  /**
  @type {Array<{ op: string, path: string }>}
   */
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
  /**
  @type {Map<string, Set<string>>}
   */
  const byPath = new Map()
  for (const { op, path } of ops) {
    if (path) {
      if (!byPath.has(path)) {
        byPath.set(path, new Set())
      }
      byPath.get(path).add(op)
    }
  }
  /**
  @type {string[]}
   */
  const out = []
  for (const [path, set] of byPath) {
    if (set.has('remove') && set.has('add')) {
      out.push(path)
    }
  }
  return out.toSorted((a, b) => a.localeCompare(b))
}

// Plan B: вся audit-ланка JSON6902 (failIfJson6902RemoveAddConflictOnSamePath,
// auditJson6902PatchExternalFile, auditOneKustomizationJson6902Patch,
// auditKustomizationPatchesJson6902) видалена. Per-document inline JSON6902
// remove+add conflict — у rego-пакеті `k8s.kustomization`. Зовнішні patch-файли
// не охоплені rego-кроком (потребує FS-доступу) — це trade-off Plan B.

/**
 * Один YAML-документ: якщо це Kustomization — перевірка **patches** на JSON6902 remove+add.
 * @param {string} rel відносний шлях до kustomization.yaml
 * @param {unknown} rootObj корінь документа
 * @param {string} kustAbs абсолютний шлях до kustomization.yaml
 * @param {string} rootNorm нормалізований корінь репо
 * @param {string} root корінь репо
 * @param {(msg: string) => void} fail реєстрація порушення
 * @returns {Promise<void>} результат
 */
/**
 * Plan B: per-document JSON6902 remove+add conflict — у rego-пакеті
 * `k8s.kustomization`, виклик через `runAllK8sRego`. JS-функції
 * auditJson6902ForKustomizationYamlDoc, auditJson6902OneKustomizationYamlFile,
 * validateKustomizationJson6902NoRemoveAddSamePath видалено.
 */

// Plan B: per-document `kind: Ingress` і `apiVersion: autoscaling/v1` заборонено —
// у rego-пакеті `k8s.manifest`, виклик через `runAllK8sRego`. JS-функції
// failIfIngressInDocument, failIfAutoscalingV1InDocument, scanForbiddenManifestsInYamlDocuments
// видалено. `isForbiddenAutoscalingV1Manifest` як публічний predicate теж видалено
// (rego — авторитативне джерело).

/**
 * Рекомендоване **`resources.requests.cpu`** поза шарем base для підказок у повідомленнях (k8s.mdc).
 */
export const DEFAULT_CONTAINER_CPU_REQUEST = '0.5'

/**
 * Рекомендоване **`resources.requests.memory`** поза шарем base для підказок у повідомленнях (k8s.mdc).
 */
export const DEFAULT_CONTAINER_MEMORY_REQUEST = '512Mi'

/**
 * Обов’язковий **`resources.requests.cpu`** у **`…/k8s/…/base/…`** (k8s.mdc).
 */
export const K8S_BASE_CONTAINER_CPU_REQUEST = '0.02'

/**
 * Обов’язковий **`resources.requests.memory`** у **`…/k8s/…/base/…`** (k8s.mdc).
 */
export const K8S_BASE_CONTAINER_MEMORY_REQUEST = '128Mi'

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
 * Чи значення `resources.requests.memory` записане у валідному вигляді (непорожній рядок або додатне число).
 * @param {unknown} mem значення поля `resources.requests.memory`
 * @returns {boolean} true, якщо значення прийнятне
 */
function isValidMemoryRequestValue(mem) {
  if (typeof mem === 'string') return mem.trim() !== ''
  if (typeof mem === 'number') return Number.isFinite(mem) && mem > 0
  return false
}

/**
 * Чи CPU у base-шарі збігається з каноном **`0.02`** (рядок або число).
 * @param {unknown} cpu значення **requests.cpu**
 * @returns {boolean} true, якщо дорівнює канону base
 */
function isBaseCanonCpuValue(cpu) {
  if (typeof cpu === 'number' && Number.isFinite(cpu)) {
    return cpu === 0.02
  }
  if (typeof cpu === 'string' && cpu.trim() !== '') {
    const t = cpu.trim()
    if (t === K8S_BASE_CONTAINER_CPU_REQUEST) return true
    const n = Number(t)
    return Number.isFinite(n) && n === 0.02
  }
  return false
}

/**
 * Чи memory у base-шарі збігається з каноном **`128Mi`** (рядок Quantity; **`Mi`** без урахування регістру).
 * @param {unknown} mem значення **requests.memory**
 * @returns {boolean} true, якщо дорівнює канону base
 */
function isBaseCanonMemoryValue(mem) {
  if (typeof mem !== 'string' || mem.trim() === '') return false
  return BASE_CANON_MEMORY_RE.test(mem.trim())
}

/**
 * Перевірка поля **`resources`** для одного контейнера **Deployment** (k8s.mdc): **requests.cpu** і **requests.memory**;
 * у шарі **`…/k8s/…/base/…`** — жорстко **`0.02`** / **`128Mi`**.
 * @param {unknown} c елемент **containers[]**
 * @param {string} label підпис у повідомленні
 * @param {boolean} inK8sBaseLayer файл маніфесту під **`…/k8s/…/base/…`**
 * @returns {string | null} текст порушення або null
 */
function deploymentContainerResourcesViolation(c, label, inK8sBaseLayer) {
  if (c === null || c === undefined || typeof c !== 'object' || Array.isArray(c)) {
    return null
  }
  const cont = /** @type {Record<string, unknown>} */ (c)
  if (!('resources' in cont)) {
    return `контейнер "${label}": відсутнє поле resources — додай resources.requests.cpu та resources.requests.memory (поза base за замовчуванням cpu=${DEFAULT_CONTAINER_CPU_REQUEST}, memory=${DEFAULT_CONTAINER_MEMORY_REQUEST}; у base — cpu='${K8S_BASE_CONTAINER_CPU_REQUEST}', memory='${K8S_BASE_CONTAINER_MEMORY_REQUEST}') (див. k8s.mdc)`
  }
  const r = cont.resources
  if (r === null || typeof r !== 'object' || Array.isArray(r)) {
    return `контейнер "${label}": resources має бути записом у YAML`
  }
  const resources = /** @type {Record<string, unknown>} */ (r)
  const requests = resources.requests
  if (requests === null || requests === undefined || typeof requests !== 'object' || Array.isArray(requests)) {
    return `контейнер "${label}": додай resources.requests.cpu та resources.requests.memory (поза base за замовчуванням cpu=${DEFAULT_CONTAINER_CPU_REQUEST}, memory=${DEFAULT_CONTAINER_MEMORY_REQUEST}) (див. k8s.mdc)`
  }
  const req = /** @type {Record<string, unknown>} */ (requests)
  if (!('cpu' in req)) {
    return `контейнер "${label}": додай resources.requests.cpu (поза base за замовчуванням ${DEFAULT_CONTAINER_CPU_REQUEST}) (див. k8s.mdc)`
  }
  if (!isValidCpuRequestValue(req.cpu)) {
    return `контейнер "${label}": resources.requests.cpu має бути непорожнім значенням (наприклад "500m" або ${DEFAULT_CONTAINER_CPU_REQUEST}) (зараз: ${JSON.stringify(req.cpu)}) (див. k8s.mdc)`
  }
  if (!('memory' in req)) {
    return `контейнер "${label}": додай resources.requests.memory (поза base за замовчуванням ${DEFAULT_CONTAINER_MEMORY_REQUEST}) (див. k8s.mdc)`
  }
  if (!isValidMemoryRequestValue(req.memory)) {
    return `контейнер "${label}": resources.requests.memory має бути непорожнім значенням (наприклад "${DEFAULT_CONTAINER_MEMORY_REQUEST}") (зараз: ${JSON.stringify(req.memory)}) (див. k8s.mdc)`
  }
  if (inK8sBaseLayer) {
    if (!isBaseCanonCpuValue(req.cpu)) {
      return `контейнер "${label}": у шарі k8s/.../base resources.requests.cpu має бути рівно '${K8S_BASE_CONTAINER_CPU_REQUEST}' (допускається число 0.02) — зараз ${JSON.stringify(req.cpu)} (див. k8s.mdc)`
    }
    if (!isBaseCanonMemoryValue(req.memory)) {
      return `контейнер "${label}": у шарі k8s/.../base resources.requests.memory має бути рівно '${K8S_BASE_CONTAINER_MEMORY_REQUEST}' (суфікс Mi без урахування регістру) — зараз ${JSON.stringify(req.memory)} (див. k8s.mdc)`
    }
  }
  return null
}

/**
 * Чи порушує маніфест вимогу **`Deployment.spec.template.spec.containers[].resources`** (див. k8s.mdc).
 * @param {unknown} manifest корінь YAML-документа як запис JavaScript
 * @param {boolean} [inK8sBaseLayer] true, якщо файл лежить під **`…/k8s/…/base/…`**
 * @returns {string | null} текст порушення для `fail` або null, якщо перевірка не застосовується / ок
 */
export function deploymentResourcesViolation(manifest, inK8sBaseLayer = false) {
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
    const v = deploymentContainerResourcesViolation(c, label, inK8sBaseLayer)
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
  /**
  @type {Record<string, unknown>[]}
   */
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
 * Знаходить перший документ **Deployment** серед YAML-файлів каталогу (для перевірки імені ConfigMap, js-run.mdc).
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
 * та `spec.template.spec.volumes[*].configMap.name` (для перевірки js-run.mdc).
 * @param {Record<string, unknown>} deployment об'єкт Deployment
 * @returns {Set<string>} унікальні імена ConfigMap
 */
export function collectDeploymentConfigMapRefs(deployment) {
  /**
  @type {Set<string>}
   */
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
  /**
  @type {string[]}
   */
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
  /**
  @type {string[]}
   */
  const out = []

  /*
 * @param {unknown} node вузол для обходу
  
 * @returns {void} результат
 */
  /**
   *
   * @param {*} node параметр
   */ function walk(node) {
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
 * Збирає **`backendRef`** до **Service** з полем **`namespace`**, що збігається з namespace маршруту.
 *
 * Поле **`namespace`** у такому **`backendRef`** надлишкове: за замовчуванням Gateway API резолвить backend
 * у тому ж namespace, що й сам маршрут (див. k8s.mdc). Зайві поля у YAML — джерело розсинхрону між середовищами.
 * @param {unknown} spec значення **`spec`** маршруту
 * @param {string} routeNs **`metadata.namespace`** маршруту (непорожній рядок)
 * @returns {string[]} імена backend-сервісів з надлишковим **`namespace`** (можливі дублікати)
 */
export function collectGatewayApiRouteBackendRefsWithRedundantNamespace(spec, routeNs) {
  /**
  @type {string[]}
   */
  const out = []

  /*
 * @param {unknown} node вузол для обходу
  
 * @returns {void} результат
 */
  /**
   *
   * @param {*} node параметр
   */ function walk(node) {
    if (node === null || node === undefined) return
    if (Array.isArray(node)) {
      for (const x of node) {
        walk(x)
      }
      return
    }
    if (typeof node !== 'object') return
    if (isGatewayApiBackendRefToService(node)) {
      const o = /** @type {Record<string, unknown>} */ (node)
      if (typeof o.namespace === 'string' && o.namespace === routeNs) {
        out.push(String(o.name))
      }
    }
    for (const v of Object.values(node)) {
      walk(v)
    }
  }

  walk(spec)
  return out
}

// Plan B: Gateway API маршрут backendRef з суфіксом `-hl` і redundant namespace —
// у rego-пакеті `k8s.gateway`, виклик через `runAllK8sRego`. JS-функції
// failIfGatewayRouteUsesNonHeadlessService, scanGatewayApiRouteBackendRefsInYamlBody видалено;
// JSDoc-блок для них прибрано (eslint-plugin-jsdoc trip-ив на «orphan» JSDoc, який
// прилипав до asPlainRecord як другий @returns).

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
 * @returns {void} результат
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
 * @returns {void} результат
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
 * @returns {Promise<void>} результат
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
  /**
  @type {string[]}
   */
  const svcNames = []
  if (!appendServiceNamesFromSvcRoots(svcRoots, rel, 'svc.yaml', svcNames, fail)) {
    return
  }
  /**
  @type {string[]}
   */
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
 * @returns {Promise<void>} результат
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
  /**
  @type {Map<string, Set<string>>}
   */
  const hasuraByDir = new Map()
  /**
  @type {{ abs: string, dir: string, docIndex: number, obj: Record<string, unknown> }[]}
   */
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
 * @returns {Promise<void>} результат
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
  /**
  @type {import('yaml').Document[]}
   */
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
 * @returns {void} результат
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
 * @returns {Promise<void>} результат
 */
async function validateHasuraHttpRouteCanon(root, yamlFiles, fail) {
  const { hasuraByDir, httpRoutes } = await collectHasuraDeploymentsAndHttpRoutes(yamlFiles)
  if (hasuraByDir.size === 0 || httpRoutes.length === 0) return

  // JS gating: відберемо файли HTTPRoute, що paired з Hasura-Deployment у тому ж каталозі
  // (за `metadata.name` HTTPRoute === metadata.name Hasura-Deployment). Per-document валідація
  // канону 4 правил Hasura — у rego-пакеті `k8s.hasura_httproute`.
  const pairedFiles = new Set()
  for (const hr of httpRoutes) {
    const meta = asPlainRecord(hr.obj.metadata)
    const name = meta === null ? undefined : meta.name
    const set = typeof name === 'string' && name !== '' ? hasuraByDir.get(hr.dir) : undefined
    if (set !== undefined && typeof name === 'string' && set.has(name)) {
      pairedFiles.add(hr.abs)
    }
  }
  if (pairedFiles.size === 0) return
  const violations = runConftestBatch({
    policyDirRel: 'k8s/hasura_httproute',
    namespace: 'k8s.hasura_httproute',
    files: [...pairedFiles]
  })
  for (const v of violations) {
    const rel = (relative(root, v.filename) || v.filename).replaceAll('\\', '/')
    fail(`${rel}: ${v.message}`)
  }
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

// Plan B: per-document валідаційне ядро для k8s YAML повністю в rego —
// `k8s.manifest`, `k8s.gateway`, `k8s.svc_yaml`, `k8s.svc_hl_yaml`,
// `k8s.base_manifest`. Виклик через `runAllK8sRego`.
// JS-функції failIfK8sPolicyNamespaceRulesViolated, failIfK8sPolicyResourceRulesViolated,
// validateK8sYamlPolicyDocuments видалено.

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

  if (YANNH_GROUPS.has(group)) {
    // yannh для груп типу `*.k8s.io` / `*.apiserver.k8s.io` зберігає у назві файлу
    // лише перший сегмент `group` до першої крапки: `networking.k8s.io` → `networking`,
    // `rbac.authorization.k8s.io` → `rbac`, `flowcontrol.apiserver.k8s.io` → `flowcontrol`.
    // Для груп без крапок (`apps`, `batch`, `autoscaling`, `policy`) це збігається з group.
    const groupPart = group.split('.')[0]
    const url = `${YANNH_BASE}${kindPart}-${groupPart}-${version}.json`
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
 * Файл з першим документом **HttpBackendGroup** (ALB Yandex): без modeline **$schema**.
 * @param {string} rel відносний шлях
 * @param {string} _baseLower basename (лишений для уніфікованої сигнатури `checkK8sYamlFile*`)
 * @param {string[]} _lines рядки файлу (лишені з тієї ж причини)
 * @param {(msg: string) => void} _fail реєстрація помилки (rego гейтує per-document)
 * @param {(msg: string) => void} pass реєстрація успіху
 * @returns {void} результат
 */
function checkK8sYamlHttpBackendGroupFile(rel, _baseLower, _lines, _fail, pass) {
  // Per-document валідація (Ingress/autoscaling/v1 заборонено, Gateway API backendRef,
  // metadata.namespace правила) — у rego (`k8s.manifest`, `k8s.gateway`, `k8s.base_manifest`),
  // батч-виклик з `runAllK8sRego` на початку `check()`.
  pass(`${rel}: HttpBackendGroup (alb.yc.io/v1alpha1) — modeline $schema не застосовується (k8s.mdc)`)
}

/**
 * Стандартний файл: перший рядок — modeline **$schema**, далі перевірка URL і політики.
 * @param {string} abs абсолютний шлях
 * @param {string} rel відносний шлях
 * @param {string} baseLower basename
 * @param {string[]} lines рядки файлу
 * @param {(msg: string) => void} fail реєстрація помилки
 * @param {(msg: string) => void} pass реєстрація успіху
 * @returns {void} результат
 */
function checkK8sYamlFileWithSchemaModeline(abs, rel, baseLower, lines, fail, pass) {
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

  // Per-document валідація (Ingress/autoscaling/v1 заборонено, Gateway API backendRef,
  // metadata.namespace правила, Service GCP-анотації, Deployment resources/Hasura image,
  // topologySpread, HCP, svc/svc-hl) — делегована rego, виконано у `runAllK8sRego` вище.

  if (schemaUrl.startsWith('file:')) {
    fail(
      `${rel}: $schema=file:… заборонено (фальшива валідація без публічної схеми). ` +
        `Якщо публічної схеми для цього apiVersion/kind немає — прибери modeline зовсім (k8s.mdc)`
    )
    return
  }
  if (HTTPS_SCHEMA_RE.test(schemaUrl)) {
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
    fail(
      `${rel}: $schema має бути https URL (file: і інші схеми заборонені — якщо публічної схеми немає, прибери modeline; k8s.mdc)`
    )
  }
}

/**
 * Перевіряє один YAML у дереві k8s (modeline, схема).
 * @param {string} abs абсолютний шлях до файлу
 * @param {string} root корінь репозиторію
 * @param {(msg: string) => void} fail реєстрація помилки
 * @param {(msg: string) => void} pass реєстрація успіху
 * @returns {Promise<void>} результат
 */
async function checkK8sYamlFile(abs, root, fail, pass) {
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
  const firstLineIsModeline = lines.length > 0 && MODELINE_RE.test(lines[0])
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
    checkK8sYamlHttpBackendGroupFile(rel, baseLower, lines, fail, pass)
    return
  }

  if (!firstLineIsModeline) {
    // Modeline опційний: дозволено, якщо публічної схеми для apiVersion/kind немає (k8s.mdc).
    // Але `# yaml-language-server: $schema=…` дозволено **лише** у першому рядку — якщо він
    // зустрічається нижче, це порушення (yaml-language-server чекає на нього у заголовку файлу).
    if (countSchemaModelines(lines) > 0) {
      fail(`${rel}: рядок # yaml-language-server: $schema=… має бути першим у файлі (без префіксів перед #; k8s.mdc)`)
      return
    }
    pass(`${rel}: без modeline — перевірка $schema пропущена (немає публічної схеми; k8s.mdc)`)
    return
  }

  checkK8sYamlFileWithSchemaModeline(abs, rel, baseLower, lines, fail, pass)
}

/**
 * Реєструє порушення для шляхів виду **`…/k8s/dev/…`** (окремої директорії **dev** не має бути).
 * @param {string[]} yamlFiles абсолютні шляхи
 * @param {string} root корінь репозиторію
 * @param {(msg: string) => void} fail callback для реєстрації порушення
 * @returns {void} результат
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
 * @returns {Promise<void>} результат
 */
// Plan B: per-document `k8s/base/kustomization.yaml` має непорожнє поле `namespace:` —
// у rego-пакеті `k8s.base_kustomization`, виклик через `runAllK8sRego`.
// JS-функції verifyBaseKustomizationNamespaceOnFile, ensureBaseKustomizationHasNamespace видалено.

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
  // JS gating: відберемо ConfigMap-файли, у каталозі яких поруч є Hasura-Deployment.
  // Per-document валідація `data.HASURA_GRAPHQL_ENABLE_REMOTE_SCHEMA_PERMISSIONS == "true"`
  // — у rego-пакеті `k8s.hasura_configmap`.
  const paired = []
  for (const cmAbs of cmFiles) {
    const deployment = await findDeploymentDocInDir(dirname(cmAbs))
    if (deployment !== null && isHasuraDeploymentManifest(deployment)) {
      paired.push(cmAbs)
    }
  }
  if (paired.length === 0) return
  const violations = runConftestBatch({
    policyDirRel: 'k8s/hasura_configmap',
    namespace: 'k8s.hasura_configmap',
    files: paired
  })
  for (const v of violations) {
    const rel = (relative(root, v.filename) || v.filename).replaceAll('\\', '/')
    fail(`${rel}: ${v.message}`)
  }
  if (violations.length === 0) {
    passFn(`Hasura-ConfigMap (${paired.length}) відповідає ${HASURA_REMOTE_SCHEMA_PERMISSIONS_KEY}="true" (rego)`)
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
 * Ім'я файлу NetworkPolicy поруч із Deployment або в `components/` (див. k8s.mdc).
 */
export const NETWORK_POLICY_FILENAME = 'networkpolicy.yaml'

/**
 * Workload-типи, для яких обов'язковий **NetworkPolicy** (див. k8s.mdc).
 * @type {readonly string[]}
 */
export const WORKLOAD_KINDS_WITH_NETWORK_POLICY = Object.freeze([
  'Deployment',
  'StatefulSet',
  'DaemonSet',
  'Job',
  'CronJob'
])

/**
 * Фіксована назва каталогу Kustomize Component, sibling до `base/`, де живуть HPA і PDB
 * (за каноном — `hpa.yaml` і `pdb.yaml` з `kind: Component` у `kustomization.yaml`). Інші назви
 * (`scale/`, `hpa-component/`) у правилі **k8s** не дозволені (k8s.mdc).
 */
export const COMPONENTS_DIR = 'components'

/**
 * `apiVersion` маніфесту Kustomize **Component** (sibling до `base/`).
 */
const KUSTOMIZE_COMPONENT_API_VERSION = 'kustomize.config.k8s.io/v1alpha1'

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
 * Витягує мітку `app` з `spec.selector.matchLabels.app` об'єкта з полем `spec.selector`.
 * @param {Record<string, unknown>} spec об'єкт `spec` workload
 * @returns {string | null} результат
 */
function appLabelFromSpecSelector(spec) {
  const selector = getNestedObject(spec, 'selector')
  if (selector === null) return null
  const matchLabels = getNestedObject(selector, 'matchLabels')
  if (matchLabels === null) return null
  const app = matchLabels.app
  return typeof app === 'string' && app.trim() !== '' ? app : null
}

/**
 * Витягує мітку `app` для workload, для якого потрібен NetworkPolicy.
 * Deployment / StatefulSet / DaemonSet / Job — `spec.selector.matchLabels.app`;
 * CronJob — `spec.jobTemplate.spec.selector.matchLabels.app`.
 * @param {Record<string, unknown>} manifest AST workload
 * @returns {string | null} непорожнє значення `app` або null
 */
export function workloadAppLabel(manifest) {
  const kind = manifest.kind
  if (typeof kind !== 'string') return null
  if (kind === 'CronJob') {
    const jobTemplate = getNestedObject(getNestedObject(manifest, 'spec'), 'jobTemplate')
    const jobSpec = jobTemplate === null ? null : getNestedObject(jobTemplate, 'spec')
    return jobSpec === null ? null : appLabelFromSpecSelector(jobSpec)
  }
  const spec = getNestedObject(manifest, 'spec')
  if (spec === null) return null
  return appLabelFromSpecSelector(spec)
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
  /**
  @type {string[]}
   */
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
  /**
  @type {string[]}
   */
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

/**
 * Канонічний YAML **NetworkPolicy** для workload з іменем `workloadName` і міткою `app`.
 * @param {string} deployName `metadata.name` workload (Deployment, StatefulSet, …)
 * @param {string} appLabel `spec.selector.matchLabels.app` (або selector у `jobTemplate` для CronJob)
 * @returns {string} вміст `networkpolicy.yaml`
 */
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

/**
 * Перевіряє **NetworkPolicy** (`networking.k8s.io/v1`): структура й прив'язка до workload.
 * @param {unknown} manifest корінь YAML-документа NetworkPolicy
 * @param {string} expectedDeployName очікуване `metadata.name` workload
 * @param {string} expectedAppLabel очікувана мітка `app` у `podSelector.matchLabels`
 * @returns {string[]} список порушень (порожній — ок)
 */
export function networkPolicyManifestViolations(manifest, expectedDeployName, expectedAppLabel) {
  /**
  @type {string[]}
   */
  const errs = []
  if (manifest === null || manifest === undefined || typeof manifest !== 'object' || Array.isArray(manifest)) {
    errs.push('NetworkPolicy має бути обʼєктом YAML')
    return errs
  }
  const rec = /** @type {Record<string, unknown>} */ (manifest)
  if (rec.kind !== 'NetworkPolicy') errs.push(`kind має бути NetworkPolicy (зараз: ${JSON.stringify(rec.kind)})`)
  if (rec.apiVersion !== 'networking.k8s.io/v1')
    errs.push(`apiVersion має бути networking.k8s.io/v1 (зараз: ${JSON.stringify(rec.apiVersion)})`)
  const name = manifestMetadataName(rec)
  if (name !== expectedDeployName)
    errs.push(`metadata.name має бути '${expectedDeployName}' (зараз: ${JSON.stringify(name)})`)
  const spec = rec.spec
  if (spec === null || spec === undefined || typeof spec !== 'object' || Array.isArray(spec)) {
    errs.push('spec відсутній або некоректний')
    return errs
  }
  const s = /** @type {Record<string, unknown>} */ (spec)
  const podSelector = s.podSelector
  if (
    podSelector === null ||
    podSelector === undefined ||
    typeof podSelector !== 'object' ||
    Array.isArray(podSelector)
  ) {
    errs.push('spec.podSelector відсутній')
    return errs
  }
  const matchLabels = /** @type {Record<string, unknown>} */ (podSelector).matchLabels
  if (
    matchLabels === null ||
    matchLabels === undefined ||
    typeof matchLabels !== 'object' ||
    Array.isArray(matchLabels)
  ) {
    errs.push('spec.podSelector.matchLabels відсутній')
    return errs
  }
  const app = /** @type {Record<string, unknown>} */ (matchLabels).app
  if (app !== expectedAppLabel)
    errs.push(`spec.podSelector.matchLabels.app має бути '${expectedAppLabel}' (зараз: ${JSON.stringify(app)})`)
  return errs
}

/**
 * Додає `resourceName` у `resources:` kustomization/Component YAML, якщо ще немає; сортує за алфавітом (en).
 * @param {string} raw вміст `kustomization.yaml`
 * @param {string} resourceName ім'я файлу ресурсу (наприклад `networkpolicy.yaml`)
 * @returns {{ changed: boolean, content: string }} результат
 */
export function ensureResourceInKustomizationYaml(raw, resourceName) {
  const doc = parseDocument(raw)
  const resourcesNode = doc.get('resources')
  /**
  @type {string[]}
   */
  let items = []
  if (resourcesNode && isSeq(resourcesNode)) {
    items = resourcesNode.items
      .map(n => (n && typeof n === 'object' && 'value' in n ? String(n.value) : ''))
      .filter(s => s !== '')
  }
  if (items.includes(resourceName)) {
    return { changed: false, content: raw }
  }
  items.push(resourceName)
  items.sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }))
  doc.set('resources', doc.createNode(items))
  return { changed: true, content: String(doc) }
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
  /**
  @type {Record<string, unknown>[]}
   */
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
  /**
  @type {Set<string>}
   */
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
  /**
  @type {Map<string, Set<string>>}
   */
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
  /**
  @type {string[]}
   */
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
  /**
  @type {Set<string>}
   */
  const visitedKustomization = new Set()
  const desc = await collectResourceDescriptorsForKustomizationWalk(kustAbs, rootNorm, visitedKustomization)
  const hasDeployment = await kustomizationTreeHasDeploymentUnderK8sBase(kustAbs, rootNorm)
  return {
    hasDeployment,
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
 * Для `…/k8s/…/base/kustomization.yaml`: HPA / PDB заборонені у base-дереві Kustomize взагалі.
 * Канон — HPA/PDB живуть у sibling каталозі **`…/k8s/…/components/`** (Kustomize Component) і підключаються
 * лише з overlay (`components: [- ../components]`). Dev-середовище — `base` без HPA/PDB.
 * @param {string} kustAbs kustomization.yaml
 * @param {string} rel для повідомлень
 * @param {(msg: string) => void} fail callback при помилці
 * @param {(msg: string) => void} passFn callback при успіху
 * @param {(kust: string) => Promise<{ hasDeployment: boolean, hasHpa: boolean, hasPdb: boolean }>} getTreeFlags мемоізований аналіз дерева
 * @returns {Promise<void>} результат
 */
async function verifyK8sBaseKustomizeHasNoHpaPdb(kustAbs, rel, fail, passFn, getTreeFlags) {
  const { hasHpa, hasPdb } = await getTreeFlags(kustAbs)
  if (hasHpa || hasPdb) {
    fail(
      `${rel}: у base-дереві kustomize є HorizontalPodAutoscaler і/або PodDisruptionBudget — HPA/PDB заборонені у base, переведіть у sibling каталог components/ і підключайте з overlay (k8s.mdc)`
    )
  } else {
    passFn(`${rel}: base-дерево kustomize без HPA/PDB (k8s.mdc)`)
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
 * @returns {Promise<void>} результат
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
 * @param {(msg: string) => void} fail callback при помилці
 * @param {(msg: string) => void} passFn callback при успіху
 * @returns {Promise<void>} резолвиться по завершенню перевірки
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
 * @returns {Promise<void>} результат
 */
async function validateKustomizeHpaPdbOnlyWithBaseDeployment(root, yamlFilesAbs, fail, passFn) {
  const rootNorm = resolve(root)
  /**
  @type {Map<string, Promise<{ hasDeployment: boolean, hasHpa: boolean, hasPdb: boolean }>>}
   */
  const treeFlagsMemo = new Map()
  /*
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
        await verifyK8sBaseKustomizeHasNoHpaPdb(kustAbs, rel, fail, passFn, getTreeFlags)
      } else {
        await verifyOverlayHpaPdbFileRefsRespectBaseDeployment(rootNorm, kustAbs, rel, kust, fail, passFn, getTreeFlags)
      }
    }
  }
}

/**
 * @typedef {{ needsHpaReplicaPatches: boolean, needsPdbMinAvailablePatch: boolean }} ProdOverlayHpaPdbOverrideNeeds
 */

/**
 * Перевіряє наявність прод-оверрайдів у **kustomization.yaml** залежно від того, що успадковується з base.
 * @param {Record<string, unknown>} kust об'єкт kustomization
 * @param {string} rel відносний шлях для повідомлень
 * @param {(msg: string) => void} fail callback при помилці
 * @param {(msg: string) => void} passFn callback при успіху
 * @param {ProdOverlayHpaPdbOverrideNeeds} needs що саме має бути в **patches[]**
 */
function checkProdOverridesInKustomization(kust, rel, fail, passFn, needs) {
  const byKind = kustomizationPatchPathsByTargetKind(kust)
  const hpaPaths = byKind.get('HorizontalPodAutoscaler') ?? new Set()
  const pdbPaths = byKind.get('PodDisruptionBudget') ?? new Set()
  let ok = true
  if (needs.needsHpaReplicaPatches) {
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
  }
  if (needs.needsPdbMinAvailablePatch && !pdbPaths.has('/spec/minAvailable')) {
    fail(
      `${rel}: прод-оверлей має перевизначати spec.minAvailable для PodDisruptionBudget (мінімум 1 у проді) (k8s.mdc)`
    )
    ok = false
  }
  if (ok) {
    passFn(`${rel}: прод-оверрайди HPA/PDB за потреби присутні (k8s.mdc)`)
  }
}

/**
 * Які прод-оверрайди потрібні для **kustomization.yaml** (не dev-like).
 *
 * Тригер — overlay-tree (через `resources` / `components`) містить HPA / PDB. На практиці це означає,
 * що overlay підключив sibling каталог `…/k8s/…/components/` (Kustomize Component) з канонічними
 * `hpa.yaml` / `pdb.yaml`. Тоді у `patches[]` обов'язкові JSON6902-патчі прод-значень: для **HPA** —
 * `/spec/minReplicas` і `/spec/maxReplicas` (мінімум 2), для **PDB** — `/spec/minAvailable` (мінімум 1).
 * Для dev-like (`base` / `dev` / `*-qa`) overrides не потрібні (k8s.mdc).
 *
 * **Виняток — Kustomize Component (`kind: Component`):** сам `…/k8s/…/components/kustomization.yaml`
 * не overlay, а **джерело** ресурсів для overlays. Прод-перезаписи живуть у `<env>/kustomization.yaml`,
 * що підключає Component через `components:`; у самому Component patches не потрібні (env-неутральний).
 * @param {string} rootNorm нормалізований корінь репозиторію
 * @param {string} kustAbs абсолютний шлях до kustomization.yaml
 * @returns {Promise<ProdOverlayHpaPdbOverrideNeeds>} прапорці потрібних перевизначень
 */
export async function prodOverlayHpaPdbOverrideNeeds(rootNorm, kustAbs) {
  const rel = (relative(rootNorm, kustAbs) || kustAbs).replaceAll('\\', '/')
  const segment = k8sEnvSegmentFromRelPath(rel)
  if (segment === null || isDevLikeK8sEnvSegment(segment)) {
    return { needsHpaReplicaPatches: false, needsPdbMinAvailablePatch: false }
  }

  // Kustomize Component (kind: Component) — джерело канонічних HPA/PDB для overlays,
  // а не overlay сам по собі. Прод-перезаписи (/spec/minReplicas, /spec/maxReplicas,
  // /spec/minAvailable) живуть у <env>/kustomization.yaml, що підключає Component
  // через `components:`; у самому Component patches не потрібні (env-неутральний).
  const kustDoc = await readFirstYamlObject(kustAbs)
  if (kustDoc !== null && kustDoc.kind === 'Component') {
    return { needsHpaReplicaPatches: false, needsPdbMinAvailablePatch: false }
  }

  const flags = await kustomizeResourceTreeHpaPdbDeploymentFlags(kustAbs, rootNorm)
  return {
    needsHpaReplicaPatches: flags.hasHpa,
    needsPdbMinAvailablePatch: flags.hasPdb
  }
}

/**
 * Чи прод-оверлей потребує **будь-яких** overrides HPA/PDB у **patches[]** (зведений прапорець).
 * @param {string} rootNorm нормалізований корінь репозиторію
 * @param {string} kustAbs абсолютний шлях до kustomization.yaml
 * @returns {Promise<boolean>} true, якщо потрібен хоча б один тип оверрайду
 */
export async function prodOverlayNeedsHpaPdbOverrides(rootNorm, kustAbs) {
  const n = await prodOverlayHpaPdbOverrideNeeds(rootNorm, kustAbs)
  return n.needsHpaReplicaPatches || n.needsPdbMinAvailablePatch
}

/**
 * Для прод kustomization.yaml вимагає **patches[]** за потреби: **`/spec/minReplicas`** і **`/spec/maxReplicas`**
 * для **HorizontalPodAutoscaler** (якщо в успадкованому base лишився HPA без delete-patch), **`/spec/minAvailable`**
 * для **PDB** (якщо в base є PDB).
 *
 * Не застосовується до dev-like (base / dev / *-qa).
 * @param {string} root корінь репозиторію
 * @param {string[]} yamlFilesAbs yaml під k8s
 * @param {(msg: string) => void} fail callback при помилці
 * @param {(msg: string) => void} passFn callback при успіху
 */
async function validateProdKustomizationOverrides(root, yamlFilesAbs, fail, passFn) {
  const rootNorm = resolve(root)
  const kustFiles = yamlFilesAbs.filter(abs => basename(abs) === 'kustomization.yaml')
  for (const kustAbs of kustFiles) {
    const rel = (relative(rootNorm, kustAbs) || kustAbs).replaceAll('\\', '/')
    const needs = await prodOverlayHpaPdbOverrideNeeds(rootNorm, kustAbs)
    if (!needs.needsHpaReplicaPatches && !needs.needsPdbMinAvailablePatch) continue
    const kust = await readFirstYamlObject(kustAbs)
    if (kust !== null) checkProdOverridesInKustomization(kust, rel, fail, passFn, needs)
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
 * Шукає NetworkPolicy за `metadata.name`.
 * @param {Record<string, unknown>[]} npDocs документи NetworkPolicy
 * @param {string} deployName очікуване `metadata.name`
 * @returns {Record<string, unknown> | undefined} результат
 */
function findNetworkPolicyByDeployName(npDocs, deployName) {
  return npDocs.find(doc => manifestMetadataName(doc) === deployName)
}

/**
 * Перевіряє NetworkPolicy для одного workload: наявність і прив'язка за іменем / міткою `app`.
 * @param {Record<string, unknown>[]} npDocs масив NetworkPolicy-документів каталогу
 * @param {string} workloadName `metadata.name` workload
 * @param {string} appLabel мітка `app` у selector workload
 * @param {string} workloadKind `kind` workload (Deployment, StatefulSet, …)
 * @param {string} npRel відносний шлях до networkpolicy.yaml для повідомлень
 * @param {(msg: string) => void} fail callback при помилці
 * @param {(msg: string) => void} passFn callback при успіху
 */
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

/**
 * Перевіряє sibling каталог `…/k8s/…/components/` для одного **Deployment** з шару `…/k8s/…/base/`.
 *
 * Канон (k8s.mdc):
 * - Існує каталог `<baseDir>/../components/`.
 * - У ньому `kustomization.yaml` з `apiVersion: kustomize.config.k8s.io/v1alpha1`, `kind: Component` і
 *   `resources` що містять `hpa.yaml` і `pdb.yaml`.
 * - `components/hpa.yaml` — валідний `autoscaling/v2` `HorizontalPodAutoscaler` зі `scaleTargetRef.name`,
 *   що дорівнює `metadata.name` цього Deployment, з dev-like значеннями `min=max=1`.
 * - `components/pdb.yaml` — валідний `policy/v1` `PodDisruptionBudget` зі `selector.matchLabels.app`,
 *   що дорівнює мітці `app` Deployment, з dev-like `minAvailable=0`.
 * - **NetworkPolicy** в components не живе — він підключений з `base/networkpolicy.yaml` через
 *   `base/kustomization.yaml` `resources:` (див. `validateNetworkPoliciesForK8sWorkloads`).
 * @param {string} baseDir абсолютний шлях до `…/k8s/…/base/`
 * @param {string} deployName ім'я Deployment з base
 * @param {string} appLabel мітка `app` з `spec.selector.matchLabels.app`
 * @param {string} root корінь репозиторію
 * @param {(msg: string) => void} fail callback при помилці
 * @param {(msg: string) => void} passFn callback при успіху
 * @returns {Promise<void>} результат
 */
export async function validateComponentsForBaseDeployment(baseDir, deployName, appLabel, root, fail, passFn) {
  const componentsDir = resolve(baseDir, '..', COMPONENTS_DIR)
  const componentsRel = (relative(root, componentsDir) || componentsDir).replaceAll('\\', '/')
  if (!existsSync(componentsDir)) {
    fail(
      `${componentsRel}: для Deployment '${deployName}' з sibling base/ обов'язковий каталог components/ з hpa.yaml і pdb.yaml (Kustomize Component) (k8s.mdc)`
    )
    return
  }
  let stat0
  try {
    stat0 = await stat(componentsDir)
  } catch {
    stat0 = null
  }
  if (stat0 === null || !stat0.isDirectory()) {
    fail(`${componentsRel}: очікується каталог Kustomize Component (k8s.mdc)`)
    return
  }
  await validateComponentsKustomizationManifest(componentsDir, componentsRel, fail, passFn)
  await validateComponentsHpaFile(componentsDir, componentsRel, deployName, fail, passFn)
  await validateComponentsPdbFile(componentsDir, componentsRel, deployName, appLabel, fail, passFn)
}

/**
 * Перевіряє `components/kustomization.yaml`: `apiVersion: kustomize.config.k8s.io/v1alpha1`, `kind: Component`,
 * `resources` містить `hpa.yaml` і `pdb.yaml` (як мінімум). NetworkPolicy у components вже не живе —
 * він підключений з `base/networkpolicy.yaml`.
 * @param {string} componentsDir абсолютний шлях до каталогу `components/`
 * @param {string} componentsRel відносний шлях для повідомлень
 * @param {(msg: string) => void} fail callback при помилці
 * @param {(msg: string) => void} passFn callback при успіху
 * @returns {Promise<void>} результат
 */
async function validateComponentsKustomizationManifest(componentsDir, componentsRel, fail, passFn) {
  const kustAbs = join(componentsDir, 'kustomization.yaml')
  if (!existsSync(kustAbs)) {
    fail(`${componentsRel}/kustomization.yaml: відсутній — додай Kustomize Component-маніфест (k8s.mdc)`)
    return
  }
  const obj = await readFirstYamlObject(kustAbs)
  if (obj === null) {
    fail(`${componentsRel}/kustomization.yaml: не вдалося розпарсити перший YAML-документ (k8s.mdc)`)
    return
  }
  if (obj.apiVersion !== KUSTOMIZE_COMPONENT_API_VERSION) {
    fail(
      `${componentsRel}/kustomization.yaml: apiVersion має бути '${KUSTOMIZE_COMPONENT_API_VERSION}' (зараз: ${JSON.stringify(obj.apiVersion)}) (k8s.mdc)`
    )
  }
  if (obj.kind !== 'Component') {
    fail(
      `${componentsRel}/kustomization.yaml: kind має бути 'Component' (зараз: ${JSON.stringify(obj.kind)}) (k8s.mdc)`
    )
  }
  const resources = Array.isArray(obj.resources) ? obj.resources.filter(x => typeof x === 'string') : []
  const hasHpa = resources.includes(HPA_FILENAME)
  const hasPdb = resources.includes(PDB_FILENAME)
  if (!hasHpa) {
    fail(`${componentsRel}/kustomization.yaml: у resources має бути '${HPA_FILENAME}' (k8s.mdc)`)
  }
  if (!hasPdb) {
    fail(`${componentsRel}/kustomization.yaml: у resources має бути '${PDB_FILENAME}' (k8s.mdc)`)
  }
  if (obj.apiVersion === KUSTOMIZE_COMPONENT_API_VERSION && obj.kind === 'Component' && hasHpa && hasPdb) {
    passFn(`${componentsRel}/kustomization.yaml: канонічний Kustomize Component з hpa.yaml і pdb.yaml (k8s.mdc)`)
  }
}

/**
 * Перевіряє `components/hpa.yaml`: HPA для Deployment, dev-like `min=max=1`.
 * @param {string} componentsDir абсолютний шлях до каталогу `components/`
 * @param {string} componentsRel відносний шлях для повідомлень
 * @param {string} deployName ім'я Deployment з base
 * @param {(msg: string) => void} fail callback при помилці
 * @param {(msg: string) => void} passFn callback при успіху
 * @returns {Promise<void>} результат
 */
async function validateComponentsHpaFile(componentsDir, componentsRel, deployName, fail, passFn) {
  const hpaAbs = join(componentsDir, HPA_FILENAME)
  const hpaRel = `${componentsRel}/${HPA_FILENAME}`
  if (!existsSync(hpaAbs)) {
    fail(`${hpaRel}: відсутній — додай HorizontalPodAutoscaler для Deployment '${deployName}' (k8s.mdc)`)
    return
  }
  const hpaDocs = await readAllDocsByKindFromFile(hpaAbs, 'HorizontalPodAutoscaler')
  validateHpaForDeployment(hpaDocs, deployName, true, hpaRel, fail, passFn)
}

/**
 * Перевіряє `components/pdb.yaml`: PDB для Deployment, dev-like `minAvailable=0`.
 * @param {string} componentsDir абсолютний шлях до каталогу `components/`
 * @param {string} componentsRel відносний шлях для повідомлень
 * @param {string} deployName ім'я Deployment з base
 * @param {string} appLabel мітка `app` Deployment
 * @param {(msg: string) => void} fail callback при помилці
 * @param {(msg: string) => void} passFn callback при успіху
 * @returns {Promise<void>} результат
 */
async function validateComponentsPdbFile(componentsDir, componentsRel, deployName, appLabel, fail, passFn) {
  const pdbAbs = join(componentsDir, PDB_FILENAME)
  const pdbRel = `${componentsRel}/${PDB_FILENAME}`
  if (!existsSync(pdbAbs)) {
    fail(`${pdbRel}: відсутній — додай PodDisruptionBudget для Deployment '${deployName}' (k8s.mdc)`)
    return
  }
  const pdbDocs = await readAllDocsByKindFromFile(pdbAbs, 'PodDisruptionBudget')
  validatePdbForDeployment(pdbDocs, deployName, appLabel, true, pdbRel, fail, passFn)
}

/**
 * Перевіряє один Deployment: topologySpreadConstraints, HPA та PDB.
 *
 * Для **base-шару** HPA/PDB не вимагаються поруч із Deployment — натомість викликач має звіряти sibling
 * каталог `components/` через `validateComponentsForBaseDeployment`.
 * @param {Record<string, unknown>} deployment об'єкт Deployment
 * @param {string} deployRel відносний шлях каталогу для повідомлень
 * @param {boolean} isDevLike чи середовище dev-like
 * @param {boolean} isK8sBaseLayer чи каталог під **`…/k8s/…/base/`** (HPA/PDB поруч не вимагаємо — живуть у `components/`)
 * @param {Record<string, unknown>[]} hpaDocs HPA-документи каталогу
 * @param {Record<string, unknown>[]} pdbDocs PDB-документи каталогу
 * @param {(msg: string) => void} fail callback при помилці
 * @param {(msg: string) => void} passFn callback при успіху
 */
function validateSingleDeploymentHpaPdbTopology(
  deployment,
  deployRel,
  isDevLike,
  isK8sBaseLayer,
  hpaDocs,
  pdbDocs,
  fail,
  passFn
) {
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
  if (isK8sBaseLayer) {
    return
  }
  validateHpaForDeployment(hpaDocs, deployName, isDevLike, `${deployRel}/${HPA_FILENAME}`, fail, passFn)
  validatePdbForDeployment(pdbDocs, deployName, appLabel, isDevLike, `${deployRel}/${PDB_FILENAME}`, fail, passFn)
}

/**
 * Обробляє один каталог з Deployment: читає HPA/PDB/NetworkPolicy і перевіряє кожен Deployment.
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
  const isK8sBaseLayer = isK8sYamlUnderBaseDirectory(`${relDir}/probe.yaml`)
  const deployRel = relDir === '' ? '.' : relDir
  if (isK8sBaseLayer && deployments.length > 0) {
    failIfBaseLayerHasLocalHpaOrPdb(dir, deployRel, fail)
  }
  const hpaDocs = isK8sBaseLayer ? [] : await readDocsByKindInDir(dir, 'HorizontalPodAutoscaler', HPA_FILENAME)
  const pdbDocs = isK8sBaseLayer ? [] : await readDocsByKindInDir(dir, 'PodDisruptionBudget', PDB_FILENAME)
  for (const deployment of deployments) {
    validateSingleDeploymentHpaPdbTopology(
      deployment,
      deployRel,
      isDevLike,
      isK8sBaseLayer,
      hpaDocs,
      pdbDocs,
      fail,
      passFn
    )
    if (isK8sBaseLayer) {
      await validateBaseLayerComponentsIfNamed(deployment, dir, root, fail, passFn)
    }
  }
}

/**
 * У шарі `…/k8s/…/base/` забороняє локальні `hpa.yaml` / `pdb.yaml` (вони мають жити у sibling `components/`).
 * @param {string} dir абсолютний каталог Deployment-маніфесту
 * @param {string} deployRel відносний шлях для повідомлень (`.` якщо корінь репо)
 * @param {(msg: string) => void} fail callback при порушенні
 */
function failIfBaseLayerHasLocalHpaOrPdb(dir, deployRel, fail) {
  if (existsSync(join(dir, HPA_FILENAME))) {
    fail(
      `${deployRel}/${HPA_FILENAME}: у шарі k8s/.../base не тримай локальний hpa.yaml — HPA живе у sibling components/ (k8s.mdc)`
    )
  }
  if (existsSync(join(dir, PDB_FILENAME))) {
    fail(
      `${deployRel}/${PDB_FILENAME}: у шарі k8s/.../base не тримай локальний pdb.yaml — PDB живе у sibling components/ (k8s.mdc)`
    )
  }
}

/**
 * Якщо у Deployment є `metadata.name` і `spec.selector.matchLabels.app` — викликає
 * `validateComponentsForBaseDeployment` для звірки sibling-`components/`. Без цих ключів
 * каталог `components/` неможливо звʼязати з конкретним Deployment, тож пропускаємо мовчки.
 * @param {Record<string, unknown>} deployment AST документа Deployment
 * @param {string} dir абсолютний каталог Deployment-маніфесту
 * @param {string} root абсолютний корінь репо
 * @param {(msg: string) => void} fail callback при порушенні
 * @param {(msg: string) => void} passFn callback при успіху
 */
async function validateBaseLayerComponentsIfNamed(deployment, dir, root, fail, passFn) {
  const deployName = manifestMetadataName(deployment)
  const appLabel = deploymentAppLabel(deployment)
  if (deployName === null || appLabel === null) return
  await validateComponentsForBaseDeployment(dir, deployName, appLabel, root, fail, passFn)
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
 * Витягує workload-документи, для яких потрібен NetworkPolicy (Deployment, StatefulSet, …).
 * @param {string} filePath абсолютний шлях до YAML-файлу
 * @returns {Promise<Record<string, unknown>[]>} результат
 */
async function extractNetworkPolicyWorkloadsFromFile(filePath) {
  const raw = await tryReadFileUtf8(filePath)
  if (raw === undefined) return []
  const docs = tryParseAllYamlDocs(raw)
  if (docs === undefined) return []
  /**
  @type {Record<string, unknown>[]}
   */
  const out = []
  for (const kind of WORKLOAD_KINDS_WITH_NETWORK_POLICY) {
    out.push(...collectDocsByKind(docs, kind))
  }
  return out
}

/**
 * Групує workload-и з NetworkPolicy за каталогом маніфесту.
 * @param {string[]} yamlFilesAbs абсолютні шляхи yaml під `k8s`
 * @returns {Promise<Map<string, Record<string, unknown>[]>>} результат
 */
async function collectNetworkPolicyWorkloadsByDir(yamlFilesAbs) {
  /**
  @type {Map<string, Record<string, unknown>[]>}
   */
  const byDir = new Map()
  for (const abs of yamlFilesAbs) {
    const workloads = await extractNetworkPolicyWorkloadsFromFile(abs)
    if (workloads.length === 0) continue
    const dir = dirname(abs)
    const merged = byDir.get(dir)
    if (merged === undefined) {
      byDir.set(dir, [...workloads])
    } else {
      merged.push(...workloads)
    }
  }
  return byDir
}

/**
 * Для кожного **Deployment** у шарі **`…/k8s/…/base/`** (будь-який YAML у відповідному каталозі) перевіряє:
 * заборона локальних **`hpa.yaml`** і **`pdb.yaml`** (file-existence); канонічні **topologySpreadConstraints**;
 * наявність і канон sibling каталогу **`components/`** (Kustomize Component) з `hpa.yaml` і `pdb.yaml` через
 * `validateComponentsForBaseDeployment`. У не-base шарах — звична схема (`hpa.yaml` / `pdb.yaml` поруч).
 * Env-залежні межі — за сегментом після `/k8s/`: dev-like vs прод.
 * @param {string} root корінь репозиторію
 * @param {string[]} yamlFilesAbs yaml під k8s
 * @param {(msg: string) => void} fail callback при помилці
 * @param {(msg: string) => void} passFn callback при успіху
 */
async function validateDeploymentHpaPdbAndTopology(root, yamlFilesAbs, fail, passFn) {
  const rootNorm = resolve(root)
  /**
  @type {Map<string, Record<string, unknown>[]>}
   */
  const deploymentsByDir = new Map()
  for (const abs of yamlFilesAbs) {
    const rel = (relative(rootNorm, abs) || abs).replaceAll('\\', '/')
    if (!isK8sYamlUnderBaseDirectory(rel)) continue
    const deployments = await extractDeploymentsFromFile(abs)
    if (deployments.length === 0) continue
    const dir = dirname(abs)
    const merged = deploymentsByDir.get(dir)
    if (merged === undefined) {
      deploymentsByDir.set(dir, [...deployments])
    } else {
      merged.push(...deployments)
    }
  }
  for (const [dir, deployments] of deploymentsByDir) {
    await validateDeploymentsInDir(deployments, dir, rootNorm, fail, passFn)
  }
}

/**
 * Перевіряє NetworkPolicy для **Deployment**, **StatefulSet**, **DaemonSet**, **Job**, **CronJob**
 * під `k8s` — у `networkpolicy.yaml` поруч з workload-маніфестом (у base, у не-base — як overlay-specific override).
 * @param {string} root корінь репозиторію
 * @param {string[]} yamlFilesAbs yaml під k8s
 * @param {(msg: string) => void} fail callback при помилці
 * @param {(msg: string) => void} passFn callback при успіху
 * @returns {Promise<void>} результат
 */
async function validateNetworkPoliciesForK8sWorkloads(root, yamlFilesAbs, fail, passFn) {
  const rootNorm = resolve(root)
  const workloadsByDir = await collectNetworkPolicyWorkloadsByDir(yamlFilesAbs)
  for (const [dir, workloads] of workloadsByDir) {
    const relDir = (relative(rootNorm, dir) || dir).replaceAll('\\', '/')
    const deployRel = relDir === '' ? '.' : relDir
    const npAbs = join(dir, NETWORK_POLICY_FILENAME)
    const npRel = (relative(rootNorm, npAbs) || npAbs).replaceAll('\\', '/')
    const npDocs = existsSync(npAbs) ? await readAllDocsByKindFromFile(npAbs, 'NetworkPolicy') : []
    for (const workload of workloads) {
      const workloadName = manifestMetadataName(workload)
      const appLabel = workloadAppLabel(workload)
      const workloadKind = typeof workload.kind === 'string' ? workload.kind : 'workload'
      if (workloadName === null) {
        fail(`${deployRel}: ${workloadKind} без metadata.name — не можу перевірити NetworkPolicy (k8s.mdc)`)
        continue
      }
      if (appLabel === null) {
        fail(
          `${deployRel}: ${workloadKind} '${workloadName}' без мітки app у selector (spec.selector.matchLabels.app або jobTemplate для CronJob) (k8s.mdc)`
        )
        continue
      }
      validateNetworkPolicyForWorkload(npDocs, workloadName, appLabel, workloadKind, npRel, fail, passFn)
    }
  }
}

/**
 * Розбирає рядок image на ім'я і тег, з виявленням digest.
 *
 * - `foo@sha256:…` — `hasDigest: true`, тег не виділяється;
 * - `localhost:5000/foo` (порт без тегу) — теж без виділення;
 * - `localhost:5000/foo:tag` — `name: 'localhost:5000/foo'`, `tag: 'tag'`.
 *
 * Тег визначається лише по **останній** двокрапці; якщо після неї є `/` — це порт реєстру, не тег.
 * @param {string} image рядок image
 * @returns {{ name: string, tag: string | null, hasDigest: boolean }} ім'я (з реєстром/портом), тег (null якщо немає), та чи є digest
 */
export function splitImageNameTagDigest(image) {
  if (image.includes('@')) {
    return { name: image, tag: null, hasDigest: true }
  }
  const lastColon = image.lastIndexOf(':')
  if (lastColon === -1) {
    return { name: image, tag: null, hasDigest: false }
  }
  const after = image.slice(lastColon + 1)
  if (after === '' || after.includes('/')) {
    return { name: image, tag: null, hasDigest: false }
  }
  return { name: image.slice(0, lastColon), tag: after, hasDigest: false }
}

/**
 * Розпаковує YAML-скаляр з оточуючими лапками (single або double). Інші стилі (block scalar) — повертає як є.
 * @param {string} raw сирий рядок-значення без trailing whitespace/comment
 * @returns {{ unquoted: string, quote: '' | "'" | '"' }} текст без лапок та сам стиль лапок (порожній, якщо їх не було)
 */
function parseQuotedYamlScalar(raw) {
  if (raw.length >= 2) {
    const first = raw.charAt(0)
    const last = raw.at(-1)
    if (first === '"' && last === '"') {
      return { unquoted: raw.slice(1, -1), quote: '"' }
    }
    if (first === "'" && last === "'") {
      return { unquoted: raw.slice(1, -1).replaceAll("''", "'"), quote: "'" }
    }
  }
  return { unquoted: raw, quote: '' }
}

/**
 * Загортає скаляр у лапки, повертаючи оригінальний стиль.
 * @param {string} value значення без оточуючих лапок
 * @param {'' | "'" | '"'} quote стиль лапок
 * @returns {string} рядок-скаляр для запису назад у YAML
 */
function requoteYamlScalar(value, quote) {
  if (quote === '"') return `"${value}"`
  if (quote === "'") return `'${value.replaceAll("'", "''")}'`
  return value
}

/** Regex: рядок верхнього рівня з ключем `images:` (без значення в тому ж рядку). */
const KUSTOMIZATION_IMAGES_KEY_RE = /^images:\s*(?:#.*)?$/u
/** Regex: початок елемента масиву (`-` з відступом). Групує сам відступ перед `-`. */
const KUSTOMIZATION_LIST_ITEM_RE = /^(\s*)-\s/u
/**
 * Regex: значення поля (name / newName / newTag) у рядку, з опційним `- ` префіксом.
 * Захоплює увесь хвіст рядка одним капчером `valueWithTrailing`; коментар і trailing-пробіли
 * розбираються після матчу через {@link splitYamlValueAndTrailing} — це уникає вкладеного
 * `?` (lazy) + `?` (опційний хвіст), на який реагує `sonarjs/slow-regex`.
 */
const KUSTOMIZATION_IMAGE_FIELD_RE = /^(\s*(?:-\s+)?)(name|newName|newTag):(\s+)(\S[^\n]*)$/u

/**
 * Розщеплює правий бік YAML-рядка `<value>[<пробіли>#<comment>]` на «чистий» value та trailing
 * (пробіли + коментар), без використання regex з backtracking.
 * @param {string} valueWithTrailing «сирий» хвіст рядка після `<key>:<sep>`
 * @returns {{ value: string, trailing: string }} розбиті частини
 */
function splitYamlValueAndTrailing(valueWithTrailing) {
  const hashIdx = findCommentStart(valueWithTrailing)
  const upTo = hashIdx === -1 ? valueWithTrailing.length : hashIdx
  let valueEnd = upTo
  while (valueEnd > 0) {
    const code = valueWithTrailing.codePointAt(valueEnd - 1)
    if (code !== 32 && code !== 9 && code !== 10 && code !== 13) break
    valueEnd--
  }
  const value = valueWithTrailing.slice(0, valueEnd)
  return { value, trailing: valueWithTrailing.slice(valueEnd) }
}

/**
 * Знаходить індекс стартового `#`-коментаря: перший `#`, перед яким є пробіл (інакше `#`
 * — частина значення). Повертає -1, якщо коментаря немає.
 * @param {string} s рядок (хвіст YAML-рядка)
 * @returns {number} індекс стартового `#` або -1
 */
function findCommentStart(s) {
  for (let i = 0; i < s.length; i++) {
    if (s.codePointAt(i) !== 35) continue
    if (i === 0) return i
    const prev = s.codePointAt(i - 1)
    if (prev === 32 || prev === 9) return i
  }
  return -1
}
/** Regex: рядок у блоці `images:` починається з пробілу/таба (належить блоку). */
const KUSTOMIZATION_BLOCK_INDENT_RE = /^\s/u

/**
 * Автофікс блоку `images:` у kustomization.yaml: зрізає `:tag` з `name` (digest `@…` не чіпає)
 * і видаляє `newTag`, який збігається зі зрізаним тегом. Працює рядково, зберігаючи коментарі
 * й форматування.
 * @param {string} raw вміст файлу
 * @returns {{ changed: boolean, content: string }} прапорець, чи були зміни, та (за потреби) очищений текст
 */
export function cleanupKustomizationImagesInYamlText(raw) {
  const eol = raw.includes('\r\n') ? '\r\n' : '\n'
  const lines = raw.split(YAML_LINE_SPLIT_RE)

  const imagesRange = findImagesBlockRange(lines)
  if (imagesRange === null) return { changed: false, content: raw }

  const entries = splitImagesBlockEntries(lines, imagesRange.start, imagesRange.end)

  /**
  @type {Map<number, string>}
   */
  const replacements = new Map()
  /**
  @type {Set<number>}
   */
  const removals = new Set()
  let changed = false

  for (const entry of entries) {
    if (processImagesEntry(lines, entry, replacements, removals)) changed = true
  }

  if (!changed) return { changed: false, content: raw }

  /**
  @type {string[]}
   */
  const out = []
  for (const [i, line] of lines.entries()) {
    if (removals.has(i)) continue
    out.push(replacements.has(i) ? replacements.get(i) : line)
  }
  return { changed: true, content: out.join(eol) }
}

/**
 * Знаходить діапазон рядків YAML, що належать блоку `images:` верхнього рівня.
 * @param {string[]} lines рядки файлу
 * @returns {{ start: number, end: number } | null} `start` — перший рядок ПІСЛЯ ключа `images:`,
 *   `end` — перший рядок не з блоку (виключно), або null, якщо ключа немає
 */
function findImagesBlockRange(lines) {
  let imagesStart = -1
  for (const [i, line] of lines.entries()) {
    if (KUSTOMIZATION_IMAGES_KEY_RE.test(line)) {
      imagesStart = i + 1
      break
    }
  }
  if (imagesStart === -1) return null
  let imagesEnd = lines.length
  for (let i = imagesStart; i < lines.length; i++) {
    const l = lines[i]
    if (l === '' || KUSTOMIZATION_BLOCK_INDENT_RE.test(l) || l.startsWith('#')) continue
    imagesEnd = i
    break
  }
  return { start: imagesStart, end: imagesEnd }
}

/**
 * Розбиває діапазон рядків блоку `images:` на елементи списку (`- name: …`).
 * @param {string[]} lines рядки файлу
 * @param {number} blockStart перший рядок блоку (включно)
 * @param {number} blockEnd перший рядок не з блоку (виключно)
 * @returns {Array<{ start: number, end: number }>} діапазони рядків кожного елемента
 */
function splitImagesBlockEntries(lines, blockStart, blockEnd) {
  /**
  @type {Array<{ start: number, end: number }>}
   */
  const entries = []
  let curStart = -1
  for (let i = blockStart; i < blockEnd; i++) {
    if (!KUSTOMIZATION_LIST_ITEM_RE.test(lines[i])) continue
    if (curStart >= 0) entries.push({ start: curStart, end: i })
    curStart = i
  }
  if (curStart >= 0) entries.push({ start: curStart, end: blockEnd })
  return entries
}

/**
 * Обробляє один елемент `images[]`: збирає `name` (зрізає :tag) і `newTag` (видаляє, якщо
 * збігається зі зрізаним). Записує плановані заміни/видалення в передані колекції.
 * @param {string[]} lines рядки файлу
 * @param {{ start: number, end: number }} entry діапазон рядків елемента
 * @param {Map<number, string>} replacements буфер замін «номер_рядка → новий рядок»
 * @param {Set<number>} removals буфер видалень «номер_рядка»
 * @returns {boolean} true, якщо для цього елемента запланована хоча б одна зміна
 */
function processImagesEntry(lines, entry, replacements, removals) {
  /**
  @type {string | null}
   */
  let strippedTag = null
  let nameProcessed = false
  /**
  @type {{ lineIdx: number, value: string } | null}
   */
  let newTagInfo = null
  let newTagProcessed = false
  let changed = false

  for (let i = entry.start; i < entry.end; i++) {
    const parsed = parseImagesEntryLine(lines[i])
    if (parsed === null) continue
    if (parsed.key === 'name' && !nameProcessed) {
      nameProcessed = true
      const result = applyNameStripTag(lines[i], parsed)
      if (result.replacement !== null) {
        replacements.set(i, result.replacement)
        changed = true
      }
      strippedTag = result.strippedTag
    } else if (parsed.key === 'newTag' && !newTagProcessed) {
      newTagProcessed = true
      const { unquoted } = parseQuotedYamlScalar(parsed.value)
      newTagInfo = { lineIdx: i, value: unquoted }
    }
  }

  if (newTagInfo !== null && strippedTag !== null && newTagInfo.value === strippedTag) {
    removals.add(newTagInfo.lineIdx)
    changed = true
  }
  return changed
}

/**
 * Парсить рядок YAML-поля `name|newName|newTag`, повертає його складники або null, якщо рядок
 * не відповідає формату.
 * @param {string} line рядок YAML
 * @returns {{ prefix: string, key: 'name' | 'newName' | 'newTag', sep: string, value: string, trailing: string } | null}
 *   Розібрані поля або null
 */
function parseImagesEntryLine(line) {
  const m = line.match(KUSTOMIZATION_IMAGE_FIELD_RE)
  if (m === null) return null
  const [, prefix, key, sep, valueWithTrailing] = m
  const { value, trailing } = splitYamlValueAndTrailing(valueWithTrailing)
  return { prefix, key: /** @type {'name' | 'newName' | 'newTag'} */ (key), sep, value, trailing }
}

/**
 * Якщо `value` містить тег — повертає новий рядок без тега та сам тег. Інакше — null/null.
 * @param {string} originalLine оригінальний рядок YAML
 * @param {{ prefix: string, sep: string, value: string, trailing: string }} parsed розібрані складники
 * @returns {{ replacement: string | null, strippedTag: string | null }} планована заміна (або null) і зрізаний тег
 */
function applyNameStripTag(originalLine, parsed) {
  const { unquoted, quote } = parseQuotedYamlScalar(parsed.value)
  const split = splitImageNameTagDigest(unquoted)
  if (split.tag === null) return { replacement: null, strippedTag: null }
  const newLine = `${parsed.prefix}name:${parsed.sep}${requoteYamlScalar(split.name, quote)}${parsed.trailing}`
  return { replacement: newLine === originalLine ? null : newLine, strippedTag: split.tag }
}

/** Regex: JSON6902 path для image окремого контейнера у Pod-шаблоні Deployment. */
const KUSTOMIZATION_DEPLOYMENT_CONTAINER_IMAGE_PATH_RE = /^\/spec\/template\/spec\/containers\/(\d+)\/image$/u

/**
 * Якщо `patchObj` — JSON6902 для `kind: Deployment`, повертає всі image-replace ops
 * у його `patch:` разом із `opIndex` (позиція в масиві ops) і `totalOps` (загальна довжина).
 * @param {unknown} patchObj елемент масиву `patches[]`
 * @returns {{
 *   deployName: string,
 *   totalOps: number,
 *   ops: Array<{ containerIndex: number, newImage: string, opIndex: number }>
 * } | null} інформація про image-replace ops у патчі або null
 */
export function imageReplaceDeploymentPatchInfo(patchObj) {
  const pr = asPlainObject(patchObj)
  if (pr === null) return null
  const deployName = deploymentTargetName(pr.target)
  if (deployName === null) return null
  if (typeof pr.patch !== 'string') return null

  const parsedArr = tryParseJson6902Array(pr.patch)
  if (parsedArr === null) return null

  /**
  @type {Array<{ containerIndex: number, newImage: string, opIndex: number }>}
   */
  const ops = []
  for (const [i, element] of parsedArr.entries()) {
    const op = asPlainObject(element)
    if (op === null) continue
    const containerIndex = singleImageReplaceContainerIndex(op)
    if (containerIndex === null) continue
    if (typeof op.value !== 'string' || op.value.trim() === '') continue
    ops.push({ containerIndex, newImage: op.value.trim(), opIndex: i })
  }
  if (ops.length === 0) return null
  return { deployName, totalOps: parsedArr.length, ops }
}

/**
 * Перевіряє, що значення — це plain-object (не null, не масив), і повертає його з типом
 * `Record<string, unknown>` або null. Скорочує перевірки на початку гілок.
 * @param {unknown} value будь-що з YAML/JSON
 * @returns {Record<string, unknown> | null} вузол як plain-object або null
 */
function asPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  return /** @type {Record<string, unknown>} */ (value)
}

/**
 * Перевіряє, що `target` — це Deployment з непорожнім ім'ям, і повертає це ім'я (trimmed).
 * @param {unknown} target значення `patches[i].target`
 * @returns {string | null} ім'я Deployment або null
 */
function deploymentTargetName(target) {
  const t = asPlainObject(target)
  if (t === null) return null
  if (t.kind !== 'Deployment') return null
  if (typeof t.name !== 'string' || t.name.trim() === '') return null
  return t.name.trim()
}

/**
 * Парсить `patch`-рядок як YAML-масив JSON6902-операцій (≥ 1 елемент).
 * @param {string} patch текст YAML-масиву JSON6902-операцій
 * @returns {unknown[] | null} масив операцій або null
 */
function tryParseJson6902Array(patch) {
  let parsedArr
  try {
    for (const d of parseAllDocuments(patch.trim())) {
      if (d.errors.length !== 0) continue
      const j = d.toJSON()
      if (Array.isArray(j)) {
        parsedArr = j
        break
      }
    }
  } catch {
    return null
  }
  return Array.isArray(parsedArr) && parsedArr.length >= 1 ? parsedArr : null
}

/**
 * Якщо операція — `op: replace` на шляху контейнера-image, повертає індекс контейнера.
 * @param {Record<string, unknown>} op об'єкт операції JSON6902
 * @returns {number | null} індекс контейнера у `containers[N]` або null
 */
function singleImageReplaceContainerIndex(op) {
  if (typeof op.op !== 'string' || op.op.toLowerCase() !== 'replace') return null
  if (typeof op.path !== 'string') return null
  const m = op.path.match(KUSTOMIZATION_DEPLOYMENT_CONTAINER_IMAGE_PATH_RE)
  return m === null ? null : Number(m[1])
}

/**
 * Шукає `Deployment.spec.template.spec.containers[N].image` у YAML-файлі.
 * @param {string} absPath абсолютний шлях до YAML-файлу
 * @param {string} deployName ім'я Deployment
 * @param {number} containerIndex індекс контейнера
 * @returns {Promise<string | null>} рядок image або null
 */
async function findDeploymentContainerImageInFile(absPath, deployName, containerIndex) {
  const raw = await tryReadFileUtf8(absPath)
  if (raw === undefined) return null
  const docs = tryParseAllYamlDocs(raw)
  if (docs === undefined) return null
  for (const d of docs) {
    if (d.errors.length !== 0) continue
    const img = imageFromDeploymentDoc(d.toJSON(), deployName, containerIndex)
    if (img !== null) return img
  }
  return null
}

/**
 * Витягує `containers[N].image` з YAML-документа, якщо він — Deployment з відповідним іменем.
 * @param {unknown} doc розпаршений YAML як plain JS-обʼєкт
 * @param {string} deployName очікуване `metadata.name` Deployment
 * @param {number} containerIndex індекс контейнера у `spec.template.spec.containers[]`
 * @returns {string | null} обрізаний `image` або null
 */
function imageFromDeploymentDoc(doc, deployName, containerIndex) {
  const oo = asPlainObject(doc)
  if (oo === null || oo.kind !== 'Deployment') return null
  const meta = asPlainObject(oo.metadata)
  if (meta === null || meta.name !== deployName) return null
  const containers = containersOfDeployment(oo)
  if (containers === null) return null
  if (containerIndex < 0 || containerIndex >= containers.length) return null
  const c = asPlainObject(containers[containerIndex])
  if (c === null) return null
  const img = c.image
  if (typeof img === 'string' && img.trim() !== '') return img.trim()
  return null
}

/**
 * Витягує `spec.template.spec.containers` з обʼєкта Deployment (або null, якщо структура неповна).
 * @param {Record<string, unknown>} deployment plain-object документу Deployment
 * @returns {unknown[] | null} масив контейнерів або null
 */
function containersOfDeployment(deployment) {
  const spec = asPlainObject(deployment.spec)
  if (spec === null) return null
  const tmpl = asPlainObject(spec.template)
  if (tmpl === null) return null
  const podSpec = asPlainObject(tmpl.spec)
  if (podSpec === null) return null
  const containers = podSpec.containers
  return Array.isArray(containers) ? containers : null
}

/**
 * Рекурсивно проходить дерево kustomization (resources / bases / components / crds), шукаючи
 * `Deployment` із заданим іменем; повертає image потрібного контейнера або null, якщо не знайдено.
 * @param {string} kustAbs абсолютний шлях до kustomization.yaml (поточний шар)
 * @param {string} rootNorm нормалізований корінь репо
 * @param {string} deployName ім'я Deployment
 * @param {number} containerIndex індекс контейнера
 * @param {Set<string>} visited нормалізовані відвідані kustomization.yaml
 * @returns {Promise<string | null>} image або null
 */
async function walkKustomizationForDeploymentImage(kustAbs, rootNorm, deployName, containerIndex, visited) {
  const norm = resolve(kustAbs)
  if (visited.has(norm)) return null
  visited.add(norm)

  const obj = await readFirstYamlObject(norm)
  if (obj === null) return null
  const kustDir = dirname(norm)
  const refs = pathsFromKustomizationObject(obj)

  for (const ref of refs) {
    const resolved = normalizeKustomizationRef(ref, kustDir, rootNorm)
    if (resolved === null) continue
    const img = await imageFromResolvedKustomizationRef(resolved, rootNorm, deployName, containerIndex, visited)
    if (img !== null) return img
  }
  return null
}

/**
 * Перевіряє та нормалізує посилання `resources[]/components[]/bases[]` з kustomization.yaml.
 * Пропускає неприйнятні (URL, порожні, поза межами репо) посилання.
 * @param {unknown} ref значення з масиву посилань
 * @param {string} kustDir абсолютний каталог поточної kustomization
 * @param {string} rootNorm нормалізований корінь репо
 * @returns {string | null} абсолютний резолвлений шлях або null, якщо посилання треба пропустити
 */
function normalizeKustomizationRef(ref, kustDir, rootNorm) {
  if (typeof ref !== 'string' || ref.includes('://') || ref.trim() === '') return null
  const resolved = resolve(kustDir, ref.trim())
  return resolvedFilePathIsUnderRoot(rootNorm, resolved) ? resolved : null
}

/**
 * Намагається отримати image для `<deployName>:<containerIndex>` з резолвленого посилання
 * (файл або підкаталог з kustomization.yaml).
 * @param {string} resolvedAbs абсолютний шлях файлу або каталогу
 * @param {string} rootNorm нормалізований корінь репо
 * @param {string} deployName ім'я Deployment
 * @param {number} containerIndex індекс контейнера
 * @param {Set<string>} visited нормалізовані відвідані kustomization.yaml
 * @returns {Promise<string | null>} знайдений image або null
 */
async function imageFromResolvedKustomizationRef(resolvedAbs, rootNorm, deployName, containerIndex, visited) {
  let st
  try {
    st = await stat(resolvedAbs)
  } catch {
    return null
  }
  if (st.isFile() && YAML_EXTENSION_RE.test(resolvedAbs)) {
    return findDeploymentContainerImageInFile(resolvedAbs, deployName, containerIndex)
  }
  if (st.isDirectory()) {
    const childK = join(resolvedAbs, 'kustomization.yaml')
    if (existsSync(childK)) {
      return walkKustomizationForDeploymentImage(childK, rootNorm, deployName, containerIndex, visited)
    }
  }
  return null
}

/**
 * Конвертує JSON6902 image-replace patches у `images:` для одного kustomization.yaml.
 *
 * Алгоритм:
 *
 * 1. Читає файл, парсить як **Document** (yaml lib), щоб максимально зберегти форматування.
 * 2. Для кожного `patches[i]` з `target.kind: Deployment` і єдиною операцією
 *    `op: replace` на `path: /spec/template/spec/containers/N/image` шукає оригінальний image
 *    через `walkKustomizationForDeploymentImage` (resources → recursively).
 * 3. Будує `images:` запис: `name = base_image_без_тегу/digest`, `newName = patch_value_без_тегу`,
 *    `newTag = patch_value_тег`, **якщо** він відрізняється від тега base.
 * 4. Видаляє відповідні patches; якщо `patches:` стає порожнім — видаляє ключ.
 * 5. Записує файл назад через `Document.toString()`.
 * @param {string} kustAbs абсолютний шлях до kustomization.yaml
 * @param {string} rootNorm нормалізований корінь репо
 * @returns {Promise<{ changed: boolean, content?: string, errors: string[] }>} прапорець змін, новий вміст (за наявності) і список нефатальних помилок під час конвертації
 */
export async function convertImagePatchesToImagesInKustomization(kustAbs, rootNorm) {
  const raw = await tryReadFileUtf8(kustAbs)
  if (raw === undefined) return { changed: false, errors: [] }

  const parsed = parseKustomizationWithPatches(raw)
  if (parsed === null) return { changed: false, errors: [] }
  const { doc, candidates } = parsed
  if (candidates.length === 0) return { changed: false, errors: [] }

  const { conversions, errors } = await buildPatchToImageConversions(kustAbs, rootNorm, candidates)
  if (conversions.length === 0) return { changed: false, errors }

  if (!applyConversionsToDoc(doc, conversions)) return { changed: false, errors }

  const content = doc.toString()
  if (content === raw) return { changed: false, errors }
  return { changed: true, content, errors }
}

/**
 * Парсить kustomization.yaml як Document і повертає його разом зі списком кандидатів-патчів
 * (по одному кандидату на кожну image-replace op у `patches[i].patch` — патч може містити кілька).
 * Повертає null, якщо документ не розпарсився, не є Kustomization або не має масиву `patches:`.
 * @param {string} raw текст файлу
 * @returns {{
 *   doc: ReturnType<typeof parseDocument>,
 *   candidates: Array<{
 *     index: number,
 *     totalOps: number,
 *     info: { deployName: string, containerIndex: number, newImage: string, opIndex: number }
 *   }>
 * } | null} document і список кандидатів, або null
 */
function parseKustomizationWithPatches(raw) {
  let doc
  try {
    doc = parseDocument(raw)
  } catch {
    return null
  }
  if (doc.errors.length > 0) return null

  const rec = asPlainObject(doc.toJSON())
  if (rec === null) return null
  if (rec.kind !== 'Kustomization') return null
  if (typeof rec.apiVersion !== 'string' || !rec.apiVersion.startsWith(KUSTOMIZE_CONFIG_API_PREFIX)) return null
  if (!Array.isArray(rec.patches)) return null

  /**
  @type {Array<{ index: number, totalOps: number, info: { deployName: string, containerIndex: number, newImage: string, opIndex: number } }>}
   */
  const candidates = []
  for (const [i, p] of rec.patches.entries()) {
    const info = imageReplaceDeploymentPatchInfo(p)
    if (info === null) continue
    for (const op of info.ops) {
      candidates.push({
        index: i,
        totalOps: info.totalOps,
        info: {
          deployName: info.deployName,
          containerIndex: op.containerIndex,
          newImage: op.newImage,
          opIndex: op.opIndex
        }
      })
    }
  }
  return { doc, candidates }
}

/**
 * Для кожного кандидата шукає базовий image у дереві resources та формує запис конвертації
 * (або повідомлення про помилку, чому конвертація неможлива).
 * @param {string} kustAbs абсолютний шлях до kustomization.yaml
 * @param {string} rootNorm нормалізований корінь репо
 * @param {Array<{ index: number, totalOps: number, info: { deployName: string, containerIndex: number, newImage: string, opIndex: number } }>} candidates кандидати з `patches[]`
 * @returns {Promise<{ conversions: Array<{ index: number, opIndex: number, totalOps: number, name: string, newName: string, newTag: string | null }>, errors: string[] }>}
 *   результати конвертації та зібрані нефатальні помилки
 */
async function buildPatchToImageConversions(kustAbs, rootNorm, candidates) {
  /**
  @type {Array<{ index: number, opIndex: number, totalOps: number, name: string, newName: string, newTag: string | null }>}
   */
  const conversions = []
  /**
  @type {string[]}
   */
  const errors = []

  for (const { index, totalOps, info } of candidates) {
    const baseImage = await walkKustomizationForDeploymentImage(
      kustAbs,
      rootNorm,
      info.deployName,
      info.containerIndex,
      new Set()
    )
    const conversion = buildConversionForCandidate(index, info, baseImage, errors)
    if (conversion !== null) conversions.push({ ...conversion, opIndex: info.opIndex, totalOps })
  }

  return { conversions, errors }
}

/**
 * Будує одну конвертацію `patches[index]` → `images[]` запис з відповідним `newTag`.
 * Якщо щось не так (немає baseImage, digest у base/new) — додає текст у `errors` і повертає null.
 * @param {number} index індекс патча в `patches[]`
 * @param {{ deployName: string, containerIndex: number, newImage: string, opIndex: number }} info один із записів `imageReplaceDeploymentPatchInfo().ops` (плюс `deployName` патча)
 * @param {string | null} baseImage знайдений базовий image або null
 * @param {string[]} errors буфер нефатальних помилок (мутується)
 * @returns {{ index: number, name: string, newName: string, newTag: string | null } | null} запис конвертації або null
 */
function buildConversionForCandidate(index, info, baseImage, errors) {
  if (baseImage === null) {
    errors.push(
      `patches[${index}]: не знайдено Deployment ${info.deployName}.containers[${info.containerIndex}].image у дереві resources — конвертацію патча в images: пропущено (k8s.mdc)`
    )
    return null
  }
  const baseSplit = splitImageNameTagDigest(baseImage)
  if (baseSplit.hasDigest) {
    errors.push(
      `patches[${index}]: base image для ${info.deployName} містить digest (${baseImage}) — автоконвертацію патча пропущено (k8s.mdc)`
    )
    return null
  }
  const newSplit = splitImageNameTagDigest(info.newImage)
  if (newSplit.hasDigest) {
    errors.push(
      `patches[${index}]: значення патча для ${info.deployName} містить digest (${info.newImage}) — автоконвертацію пропущено (k8s.mdc)`
    )
    return null
  }
  const finalNewTag = newSplit.tag !== null && newSplit.tag !== baseSplit.tag ? newSplit.tag : null
  return { index, name: baseSplit.name, newName: newSplit.name, newTag: finalNewTag }
}

/**
 * Застосовує конвертації до Document: для кожного `patches[i]` або видаляє патч цілком (коли всі
 * його ops конвертовано), або переписує inline `patch:`, лишаючи решту ops без коментарів.
 * Допише `images:` з усіма конвертованими записами.
 * @param {ReturnType<typeof parseDocument>} doc документ kustomization.yaml
 * @param {Array<{ index: number, opIndex: number, totalOps: number, name: string, newName: string, newTag: string | null }>} conversions конвертації
 * @returns {boolean} true, якщо мутації відбулися (документ можна серіалізувати)
 */
function applyConversionsToDoc(doc, conversions) {
  const patchesNode = doc.get('patches', true)
  if (!isSeq(patchesNode)) return false

  applyPatchConversionsToPatchesNode(patchesNode, groupConversionsByPatchIndex(conversions))
  if (patchesNode.items.length === 0) {
    doc.delete('patches')
  }
  appendConvertedImagesNode(doc, conversions)
  return true
}

/**
 * Згруповує конвертації за індексом `patches[i]` і збирає `opIdx`-список ops, які треба видалити.
 * @param {Array<{ index: number, opIndex: number, totalOps: number }>} conversions конвертації
 * @returns {Map<number, { totalOps: number, opIdx: number[] }>} згруповане
 */
function groupConversionsByPatchIndex(conversions) {
  /**
  @type {Map<number, { totalOps: number, opIdx: number[] }>}
   */
  const byPatch = new Map()
  for (const c of conversions) {
    const slot = byPatch.get(c.index) ?? { totalOps: c.totalOps, opIdx: [] }
    slot.opIdx.push(c.opIndex)
    byPatch.set(c.index, slot)
  }
  return byPatch
}

/**
 * Застосовує згруповані конвертації до `patches:` Sequence: видаляє повністю-конвертовані
 * patches або переписує inline `patch:` без конвертованих ops. Іде в порядку спадання
 * індексів, щоб зберегти стабільність вилучень з масиву.
 * @param {import('yaml').YAMLSeq & { get(i: number, keep: true): unknown, delete(i: number): void, items: unknown[] }} patchesNode YAML Seq (звужено через `isSeq` у caller-і)
 * @param {Map<number, { totalOps: number, opIdx: number[] }>} byPatch згруповані конвертації
 */
function applyPatchConversionsToPatchesNode(patchesNode, byPatch) {
  const sortedIdx = [...byPatch.keys()].toSorted((a, b) => b - a)
  for (const i of sortedIdx) {
    const slot = byPatch.get(i)
    if (slot === undefined) continue
    if (slot.opIdx.length === slot.totalOps) {
      patchesNode.delete(i)
      continue
    }
    rewriteInlinePatchAtIndex(patchesNode, i, slot.opIdx)
  }
}

/**
 * Переписує inline `patch:` у `patches[i]`, видаляючи ops зі списку. Якщо вузол не знайдено
 * або переписування не вдалося — залишає Document без змін.
 * @param {import('yaml').YAMLSeq & { get(i: number, keep: true): unknown, delete(i: number): void, items: unknown[] }} patchesNode YAML Seq (звужено через `isSeq` у caller-і)
 * @param {number} i індекс у `patches:`
 * @param {number[]} opIdx індекси ops для видалення
 */
function rewriteInlinePatchAtIndex(patchesNode, i, opIdx) {
  const patchEntry = patchesNode.get(i, true)
  if (patchEntry === undefined || patchEntry === null) return
  const patchScalar = patchEntry.get('patch', true)
  if (patchScalar === undefined || patchScalar === null || typeof patchScalar.value !== 'string') return
  const rewritten = rewriteInlinePatchWithoutOps(patchScalar.value, opIdx)
  if (rewritten === null) return
  patchScalar.value = rewritten
}

/**
 * Дописує `images:` Seq у Document результатами конвертацій (створює, якщо немає).
 * @param {import('yaml').Document} doc YAML Document
 * @param {Array<{ name: string, newName: string, newTag: string | null }>} conversions конвертації
 */
function appendConvertedImagesNode(doc, conversions) {
  const existing = doc.get('images', true)
  const imagesNode = isSeq(existing) ? existing : doc.createNode([])
  if (existing !== imagesNode) {
    doc.set('images', imagesNode)
  }
  for (const { name, newName, newTag } of conversions) {
    const entry = newTag === null ? { name, newName } : { name, newName, newTag }
    imagesNode.add(doc.createNode(entry))
  }
}

/**
 * Видаляє ops за списком індексів з inline `patch:` (текст YAML-масиву JSON6902-ops)
 * і повертає переписаний текст. Зберігає block-style. Повертає null, якщо не вдалося розпарсити
 * або після видалення не лишилось ops.
 * @param {string} patchText текст YAML-масиву ops (literal block scalar)
 * @param {number[]} opIndices індекси ops, які треба видалити
 * @returns {string | null} переписаний текст або null
 */
function rewriteInlinePatchWithoutOps(patchText, opIndices) {
  let inner
  try {
    inner = parseDocument(patchText)
  } catch {
    return null
  }
  if (inner.errors.length > 0) return null
  const seq = inner.contents
  if (!isSeq(seq)) return null

  const toRemove = [...new Set(opIndices)].toSorted((a, b) => b - a)
  for (const i of toRemove) {
    if (i < 0 || i >= seq.items.length) return null
    seq.delete(i)
  }
  if (seq.items.length === 0) return null
  seq.flow = false
  return stripTrailingNewlines(inner.toString())
}

/**
 * Прибирає рядок modeline з блоку YAML (для multi-doc `networkpolicy.yaml`).
 * @param {string} yamlText фрагмент YAML
 * @returns {string} результат
 */
function stripYamlLanguageServerModeline(yamlText) {
  return yamlText.replace(YAML_LS_MODELINE_RE, '')
}

/**
 * Імена NetworkPolicy, уже присутні у файлі.
 * @param {string} npAbs абсолютний шлях до `networkpolicy.yaml`
 * @returns {Promise<Set<string>>} результат
 */
async function existingNetworkPolicyNames(npAbs) {
  if (!existsSync(npAbs)) return new Set()
  const docs = await readAllDocsByKindFromFile(npAbs, 'NetworkPolicy')
  /**
  @type {Set<string>}
   */
  const names = new Set()
  for (const doc of docs) {
    const n = manifestMetadataName(doc)
    if (n !== null) names.add(n)
  }
  return names
}

/**
 * Дописує відсутні NetworkPolicy-документи у `networkpolicy.yaml` (multi-doc через `---`).
 * @param {string} npAbs абсолютний шлях до файлу
 * @param {Array<{ name: string, appLabel: string, kind: string }>} toAdd workload-и без NP
 * @param {string} npRel відносний шлях для повідомлень
 * @param {(msg: string) => void} passFn callback при успіху
 * @returns {Promise<void>} результат
 */
async function appendNetworkPolicyDocuments(npAbs, toAdd, npRel, passFn) {
  if (toAdd.length === 0) return
  let content = ''
  if (existsSync(npAbs)) {
    const raw = await readFile(npAbs, 'utf8')
    content = raw.trimEnd()
  }
  const blocks = toAdd.map(({ name, appLabel }, i) => {
    const block = buildNetworkPolicyYaml(name, appLabel)
    return i === 0 && content === '' ? block.trimEnd() : stripYamlLanguageServerModeline(block).trimEnd()
  })
  const joined = blocks.join('\n---\n')
  content = content === '' ? `${joined}\n` : `${content}\n---\n${joined}\n`
  await writeFile(npAbs, content, 'utf8')
  for (const { name, kind } of toAdd) {
    passFn(`${npRel}: додано NetworkPolicy для ${kind} '${name}' (k8s.mdc)`)
  }
}

/**
 * Перевіряє, чи `spec.egress` містить in-cluster rule з порожнім namespaceSelector БЕЗ ports
 * (legacy catch-all — заборонено новим каноном k8s.mdc).
 * @param {unknown} doc розпарсений NetworkPolicy-документ
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

/**
 * Створює відсутні NetworkPolicy для workload-ів у каталозі (`networkpolicy.yaml` поруч з workload-маніфестом).
 * Якщо каталог — base, додатково додає `networkpolicy.yaml` у `kustomization.yaml` `resources:` (якщо файл існує).
 * @param {string} dir абсолютний каталог workload-маніфесту
 * @param {Record<string, unknown>[]} workloads workload-документи з цього каталогу
 * @param {string} rootNorm корінь репо
 * @param {(msg: string) => void} fail callback при помилці
 * @param {(msg: string) => void} passFn callback при успіху
 * @returns {Promise<void>} результат
 */
async function ensureNetworkPoliciesForWorkloadsInDir(dir, workloads, rootNorm, fail, passFn) {
  const relDir = (relative(rootNorm, dir) || dir).replaceAll('\\', '/')
  const npAbs = join(dir, NETWORK_POLICY_FILENAME)
  const npRel = (relative(rootNorm, npAbs) || npAbs).replaceAll('\\', '/')
  if (existsSync(npAbs)) {
    const migrated = await regenerateLegacyNetworkPolicyDocsInFile(npAbs)
    if (migrated) {
      passFn(`${npRel}: міграція legacy catch-all egress → канон з явними in-cluster портами (k8s.mdc)`)
    }
  }
  const existing = await existingNetworkPolicyNames(npAbs)
  /**
  @type {Array<{ name: string, appLabel: string, kind: string }>}
   */
  const toAdd = []
  for (const workload of workloads) {
    const name = manifestMetadataName(workload)
    const appLabel = workloadAppLabel(workload)
    const kind = typeof workload.kind === 'string' ? workload.kind : 'workload'
    if (name === null || appLabel === null) continue
    if (!existing.has(name)) toAdd.push({ name, appLabel, kind })
  }
  if (toAdd.length === 0) return
  try {
    await appendNetworkPolicyDocuments(npAbs, toAdd, npRel, passFn)
    const kustAbs = join(dir, 'kustomization.yaml')
    if (existsSync(kustAbs)) {
      const raw = await readFile(kustAbs, 'utf8')
      const { changed, content } = ensureResourceInKustomizationYaml(raw, NETWORK_POLICY_FILENAME)
      if (changed) {
        await writeFile(kustAbs, content, 'utf8')
        const kustRel = relDir === '' ? 'kustomization.yaml' : `${relDir}/kustomization.yaml`
        passFn(`${kustRel}: додано '${NETWORK_POLICY_FILENAME}' у resources (k8s.mdc)`)
      }
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    fail(`${npRel}: не вдалося створити/оновити NetworkPolicy (${msg})`)
  }
}

/**
 * Автоматично створює відсутні **NetworkPolicy** для Deployment, StatefulSet, DaemonSet, Job і CronJob
 * під `k8s` (`networkpolicy.yaml` поруч з workload-маніфестом, у base додаток — у `base/kustomization.yaml` resources).
 * @param {string} root корінь репозиторію
 * @param {string[]} yamlFilesAbs абсолютні шляхи yaml під `k8s`
 * @param {(msg: string) => void} fail callback при помилці
 * @param {(msg: string) => void} passFn callback при успіху
 * @returns {Promise<void>} результат
 */
async function ensureNetworkPoliciesForK8sWorkloads(root, yamlFilesAbs, fail, passFn) {
  const rootNorm = resolve(root)
  const workloadsByDir = await collectNetworkPolicyWorkloadsByDir(yamlFilesAbs)
  for (const [dir, workloads] of workloadsByDir) {
    await ensureNetworkPoliciesForWorkloadsInDir(dir, workloads, rootNorm, fail, passFn)
  }
}

/**
 * Прохід для всіх `kustomization.yaml`: конвертує image-replace patches у `images:`,
 * потім чистить `images:` (зрізає теги в `name`, видаляє надлишкові `newTag`).
 * @param {string} root корінь репо
 * @param {string[]} yamlFilesAbs всі yaml під k8s
 * @param {(msg: string) => void} fail колбек повідомлення про помилку
 * @param {(msg: string) => void} pass колбек успішного повідомлення
 * @returns {Promise<void>} результат
 */
async function autofixKustomizationImagesYaml(root, yamlFilesAbs, fail, pass) {
  const rootNorm = resolve(root)
  const kusts = yamlFilesAbs.filter(p => basename(p).toLowerCase() === 'kustomization.yaml')
  for (const kustAbs of kusts) {
    const rel = (relative(root, kustAbs) || kustAbs).replaceAll('\\', '/')
    await runImagePatchToImagesConversion(kustAbs, rel, rootNorm, fail, pass)
    await runKustomizationImagesCleanup(kustAbs, rel, fail, pass)
  }
}

/**
 * Прогон автоконвертації `patches[].image-replace` → `images:` для одного kustomization.yaml.
 * @param {string} kustAbs абсолютний шлях до kustomization.yaml
 * @param {string} rel posix-шлях відносно кореня репо (для повідомлень)
 * @param {string} rootNorm нормалізований корінь репо
 * @param {(msg: string) => void} fail колбек повідомлення про помилку
 * @param {(msg: string) => void} pass колбек успішного повідомлення
 * @returns {Promise<void>} завершується після конвертації або реєстрації помилки
 */
async function runImagePatchToImagesConversion(kustAbs, rel, rootNorm, fail, pass) {
  try {
    const r = await convertImagePatchesToImagesInKustomization(kustAbs, rootNorm)
    for (const err of r.errors) fail(`${rel}: ${err}`)
    if (r.changed && r.content !== undefined) {
      await writeFile(kustAbs, r.content, 'utf8')
      pass(`${rel}: image-replace patch(es) конвертовано в images: (k8s.mdc)`)
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    fail(`${rel}: не вдалося конвертувати image-replace patches → images: (${msg})`)
  }
}

/**
 * Прогон чистильника `images:` (зрізає `:tag` з name й видаляє надлишковий `newTag`).
 * @param {string} kustAbs абсолютний шлях до kustomization.yaml
 * @param {string} rel posix-шлях відносно кореня репо (для повідомлень)
 * @param {(msg: string) => void} fail колбек повідомлення про помилку
 * @param {(msg: string) => void} pass колбек успішного повідомлення
 * @returns {Promise<void>} завершується після очищення або реєстрації помилки
 */
async function runKustomizationImagesCleanup(kustAbs, rel, fail, pass) {
  try {
    const raw = await readFile(kustAbs, 'utf8')
    const r = cleanupKustomizationImagesInYamlText(raw)
    if (r.changed) {
      await writeFile(kustAbs, r.content, 'utf8')
      pass(`${rel}: images: cleanup — зрізано :tag з name й видалено надлишкове newTag (k8s.mdc)`)
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    fail(`${rel}: не вдалося очистити images: (${msg})`)
  }
}

/**
 * Перевіряє відповідність проєкту правилам k8s.mdc.
 * @returns {Promise<number>} 0 — все OK, 1 — є проблеми
 */
/**
 * Plan B (rego-authoritative): на початку `check()` батч-викликаємо path-фільтровані
 * rego-пакети з `npm/policy/k8s/` через `runConftestBatch`. Пакети hasura_configmap і
 * hasura_httproute мають cross-file gating (паруються з Hasura-Deployment) — вони запускаються
 * з відповідних orchestrator-функцій (`validateHasuraConfigMapRemoteSchemaPermissions`,
 * `validateHasuraHttpRouteCanon`). Структурна частина HPA/PDB (`k8s.hpa_pdb`) тут на всіх yaml,
 * env-залежні межі min/maxReplicas і expected-name — JS-cross-file у `validateDeploymentHpaPdbAndTopology`.
 * @param {string} root корінь репозиторію (cwd)
 * @param {string[]} yamlFiles абсолютні шляхи знайдених *.yaml під `…/k8s/`
 * @param {(msg: string) => void} fail callback при помилці
 * @returns {void} результат
 */
function runAllK8sRego(root, yamlFiles, fail) {
  const relOf = abs => relative(root, abs).replaceAll('\\', '/') || abs

  const allYaml = yamlFiles
  const kustYaml = yamlFiles.filter(p => basename(p).toLowerCase() === 'kustomization.yaml')
  const svcYaml = yamlFiles.filter(p => basename(p) === 'svc.yaml')
  const svcHlYaml = yamlFiles.filter(p => basename(p) === 'svc-hl.yaml')
  const baseKustYaml = yamlFiles.filter(p => isBaseKustomizationPath(relOf(p)))
  const baseResourceYaml = yamlFiles.filter(p => {
    const r = relOf(p)
    if (!K8S_BASE_SEGMENT_RE.test(r)) return false
    return basename(p).toLowerCase() !== 'kustomization.yaml'
  })

  /**
  @type {Array<{ ns: string, dir: string, files: string[] }>}
   */
  const targets = [
    { ns: 'k8s.manifest', dir: 'k8s/manifest', files: allYaml },
    { ns: 'k8s.gateway', dir: 'k8s/gateway', files: allYaml },
    { ns: 'k8s.hpa_pdb', dir: 'k8s/hpa_pdb', files: allYaml },
    { ns: 'k8s.network_policy', dir: 'k8s/network_policy', files: allYaml },
    { ns: 'k8s.kustomization', dir: 'k8s/kustomization', files: kustYaml },
    { ns: 'k8s.svc_yaml', dir: 'k8s/svc_yaml', files: svcYaml },
    { ns: 'k8s.svc_hl_yaml', dir: 'k8s/svc_hl_yaml', files: svcHlYaml },
    { ns: 'k8s.base_kustomization', dir: 'k8s/base_kustomization', files: baseKustYaml },
    { ns: 'k8s.base_manifest', dir: 'k8s/base_manifest', files: baseResourceYaml }
  ]

  for (const t of targets) {
    if (t.files.length === 0) continue
    const violations = runConftestBatch({ policyDirRel: t.dir, namespace: t.ns, files: t.files })
    for (const v of violations) {
      fail(`${relOf(v.filename)}: ${v.message}`)
    }
  }
}

/**
 * Точка входу `check k8s`: повний набір перевірок маніфестів і структури `…/k8s` (див. JSDoc на початку файлу).
 * @returns {Promise<number>} `process.exitCode`: 0 при успіху, 1 при будь-якому `fail(...)`
 */
export async function check() {
  const reporter = createCheckReporter()
  const { pass, fail } = reporter

  const root = process.cwd()
  const ignorePaths = await loadCursorIgnorePaths(root)

  await rewriteBatchV1beta1ApiVersionInK8sYamlFiles(root, ignorePaths, fail, pass)

  await removeBackendConfigOnlyK8sYamlFiles(root, ignorePaths, fail, pass)

  const yamlFiles = await findK8sYamlFiles(root, ignorePaths)

  if (yamlFiles.length === 0) {
    pass('Немає *.yaml під k8s — перевірку $schema пропущено')
    return reporter.getExitCode()
  }

  pass(`YAML у k8s: ${yamlFiles.length} файл(ів)`)

  await autofixKustomizationImagesYaml(root, yamlFiles, fail, pass)

  await ensureNetworkPoliciesForK8sWorkloads(root, yamlFiles, fail, pass)

  assertNoForbiddenK8sDevPaths(yamlFiles, root, fail)

  // Plan B: пер-документні структурні правила — у rego-полісі `npm/policy/k8s/*`,
  // викликаємо одним батчем на namespace через runConftestBatch. JS нижче робить
  // лише cross-file orchestration, modeline та FS-existence перевірки.
  runAllK8sRego(root, yamlFiles, fail)
  pass(`Rego-полісі (npm/policy/k8s/*) виконано на ${yamlFiles.length} файл(ах)`)

  for (const abs of yamlFiles) {
    await checkK8sYamlFile(abs, root, fail, pass)
  }

  await validateSvcYamlAndSvcHlPairs(root, yamlFiles, fail)

  await validateHasuraHttpRouteCanon(root, yamlFiles, fail)

  await validateKustomizationIncludesSvcHlWithSvc(root, yamlFiles, fail)

  await validateKustomizationPathRefsExistOnDisk(root, yamlFiles, fail)

  await validateKustomizationPatchTargetsResolved(root, yamlFiles, fail)

  await validateKustomizeHpaPdbOnlyWithBaseDeployment(root, yamlFiles, fail, pass)

  await validateConfigMapNameMatchesDeployment(root, yamlFiles, fail, pass)

  await validateHasuraConfigMapRemoteSchemaPermissions(root, yamlFiles, fail, pass)

  await validateDeploymentHpaPdbAndTopology(root, yamlFiles, fail, pass)

  await validateNetworkPoliciesForK8sWorkloads(root, yamlFiles, fail, pass)

  await validateProdKustomizationOverrides(root, yamlFiles, fail, pass)

  return reporter.getExitCode()
}

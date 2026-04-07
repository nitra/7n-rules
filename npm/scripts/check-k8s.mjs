/**
 * Перевіряє Kubernetes YAML у шляхах з сегментом `k8s` (див. k8s.mdc).
 *
 * Перший рядок `# yaml-language-server: $schema=…`, без дублікатів, розширення `.yaml`
 * (окрім `kustomization.yml`); URL схеми за першим документом — kustomization / yannh / datree
 * (datree за замовчуванням: GitHub Pages `https://datreeio.github.io/CRDs-catalog/…`).
 *
 * Додатково: у кожному YAML-документі з **`kind: Deployment`** у кожного контейнера
 * **`spec.template.spec.containers[]`** має бути ключ **`resources`** (значення — об'єкт, допускається
 * порожній **`{}`**) та **`imagePullPolicy: Always`**.
 *
 * У файлах **не** `kustomization.yaml` / `kustomization.yml` у документах не має бути **`metadata.namespace`**
 * (namespace лише в Kustomize).
 *
 * **`kind: Ingress`** заборонено (потрібен перехід на Gateway API). Якщо є **`HealthCheckPolicy`**,
 * має існувати **`ru/kustomization.yaml`** з patch видалення цього kind (`$patch: delete`).
 *
 * Структура **Kustomize** (див. k8s.mdc): заборона шляхів **`…/k8s/dev/…`**; якщо є **`…/k8s/base/kustomization.yaml`**
 * (або **`.yml`**), у першому документі має бути непорожнє поле **`namespace`**.
 *
 * Явні винятки до загальної логіки yannh/datree — таблиця **`EXPLICIT_K8S_SCHEMAS`** (`Map`): ключ
 * **`apiVersion`, `kind`, `type`** (для CRD без поля `type` у маніфесті — зірочка **`*`** як третій
 * компонент). Спочатку шукається збіг за фактичним `type`, потім за **`*`**.
 * Dockerfile — правило docker.mdc, скрипт check-docker.mjs.
 */
import { readFile } from 'node:fs/promises'
import { basename, relative } from 'node:path'

import { parseAllDocuments } from 'yaml'

import { pass } from './utils/pass.mjs'
import { walkDir } from './utils/walkDir.mjs'

/** Версія набору схем yannh — узгоджено з k8s.mdc */
const YANNH_PIN = 'v1.33.9-standalone-strict'

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
 * Чи це **`k8s/base/kustomization.yaml`** або **`kustomization.yml`** (перевірка поля **`namespace`**).
 * @param {string} rel шлях від кореня репозиторію
 * @returns {boolean} true, якщо це `…/k8s/base/kustomization.yaml` або `…/k8s/base/kustomization.yml`
 */
export function isBaseKustomizationPath(rel) {
  const n = rel.replaceAll('\\', '/')
  return /(^|\/)k8s\/base\/kustomization\.yaml$/u.test(n) || /(^|\/)k8s\/base\/kustomization\.yml$/u.test(n)
}

/**
 * Чи коректне поле **`namespace`** у розібраному Kustomization для **`base`**.
 * @param {unknown} obj перший документ YAML
 * @returns {string | null} текст порушення або null, якщо ок
 */
export function baseKustomizationNamespaceViolation(obj) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    return 'у base/kustomization.yaml має бути непорожній namespace (див. k8s.mdc)'
  }
  const rec = /** @type {Record<string, unknown>} */ (obj)
  const ns = rec.namespace
  if (typeof ns === 'string' && ns.trim() !== '') {
    return null
  }
  return 'у base/kustomization.yaml має бути непорожній namespace (наприклад namespace: dev; див. k8s.mdc)'
}

/**
 * Збирає всі yaml/yml під деревом від кореня cwd, якщо шлях містить сегмент `k8s`.
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
  // eslint-disable-next-line unicorn/no-array-sort -- toSorted потребує lib ES2023 у перевірці типів IDE
  return [...out].sort((a, b) => a.localeCompare(b))
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
 * Чи відносний шлях вказує на **`ru/kustomization.yaml`** (сегмент **`ru`** перед ім’ям файлу).
 * @param {string} rel шлях від кореня репозиторію
 * @returns {boolean} true, якщо це `…/ru/kustomization.yaml`
 */
export function isRuKustomizationPath(rel) {
  const norm = rel.replaceAll('\\', '/')
  return /(^|\/)ru\/kustomization\.yaml$/u.test(norm)
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
 * Шукає **Ingress** / **HealthCheckPolicy** у розібраних документах; реєструє порушення для Ingress.
 * @param {string} rel відносний шлях до файлу
 * @param {string} body YAML після modeline
 * @param {(msg: string) => void} fail callback для помилки (Ingress)
 * @param {string[]} healthCheckPolicyFiles накопичувач шляхів, де зустріли HealthCheckPolicy
 * @returns {void}
 */
function scanIngressAndHealthCheckPolicy(rel, body, fail, healthCheckPolicyFiles) {
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
            `${rel}: знайдено kind: Ingress (документ ${di + 1}) — заміни на Gateway API: HTTPRoute (hr.yaml), HealthCheckPolicy (hc.yaml), patch у ru/kustomization.yaml (див. k8s.mdc)`
          )
        } else if (rec.kind === 'HealthCheckPolicy' && !healthCheckPolicyFiles.includes(rel)) {
          healthCheckPolicyFiles.push(rel)
        }
      }
    }
  }
}

/**
 * Якщо у дереві k8s є HealthCheckPolicy, вимагає **ru/kustomization.yaml** з patch видалення.
 * @param {string} root корінь cwd
 * @param {string[]} yamlFiles абсолютні шляхи до yaml під k8s
 * @param {string[]} healthCheckPolicyFiles відносні шляхи з HealthCheckPolicy
 * @param {(msg: string) => void} fail callback для помилки (немає ru або немає patch)
 * @returns {Promise<void>} завершення після перевірки overlay ru
 */
async function ensureRuKustomizationHealthCheckDelete(root, yamlFiles, healthCheckPolicyFiles, fail) {
  if (healthCheckPolicyFiles.length === 0) {
    return
  }

  const ruAbsList = yamlFiles.filter(abs => isRuKustomizationPath(relative(root, abs) || abs))
  if (ruAbsList.length === 0) {
    fail(
      `Знайдено HealthCheckPolicy у ${healthCheckPolicyFiles.join(', ')} — додай ru/kustomization.yaml з patch видалення (див. k8s.mdc)`
    )
    return
  }

  for (const abs of ruAbsList) {
    let raw
    try {
      raw = await readFile(abs, 'utf8')
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      fail(`${relative(root, abs) || abs}: не вдалося прочитати (${msg})`)
      return
    }
    if (ruKustomizationHasHealthCheckDeletePatch(raw)) {
      return
    }
  }

  fail(
    'Є HealthCheckPolicy, але жоден ru/kustomization.yaml не містить очікуваного patch видалення (kind: HealthCheckPolicy, metadata.name, $patch: delete) — див. k8s.mdc'
  )
}

/**
 * Чи порушує маніфест вимогу **`Deployment.spec.template.spec.containers[].resources`** (див. k8s.mdc).
 * @param {unknown} manifest корінь YAML-документа як об'єкт JavaScript
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
        return `контейнер "${label}": resources має бути об'єктом (наприклад порожній об'єкт у YAML: resources: {})`
      }
    }
  }

  return null
}

/**
 * Чи контейнери **Deployment** мають **`imagePullPolicy: Always`** (k8s.mdc).
 * @param {unknown} manifest корінь YAML-документа
 * @returns {string | null} текст порушення або null, якщо не Deployment / ок
 */
export function deploymentImagePullPolicyViolation(manifest) {
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
      if (cont.imagePullPolicy !== 'Always') {
        return `контейнер "${label}": imagePullPolicy має бути Always (див. k8s.mdc)`
      }
    }
  }

  return null
}

/**
 * У маніфестах ресурсів не має бути **metadata.namespace** — лише у **kustomization** (k8s.mdc).
 * @param {unknown} manifest корінь YAML-документа
 * @returns {string | null} текст порушення або null, якщо поля немає
 */
export function metadataNamespaceForbiddenViolation(manifest) {
  if (manifest === null || manifest === undefined || typeof manifest !== 'object' || Array.isArray(manifest))
    return null
  const rec = /** @type {Record<string, unknown>} */ (manifest)
  const meta = rec.metadata
  if (meta !== null && typeof meta === 'object' && !Array.isArray(meta) && 'namespace' in meta) {
    return 'metadata.namespace заборонено — задай namespace у kustomization.yaml (поле namespace) (див. k8s.mdc)'
  }
  return null
}

/**
 * Чи ім’я файлу — kustomization (дозволяє не застосовувати перевірку metadata.namespace до вмісту).
 * @param {string} baseLower basename у нижньому регістрі
 * @returns {boolean} true для `kustomization.yaml` / `kustomization.yml`
 */
function isKustomizationFileName(baseLower) {
  return baseLower === 'kustomization.yaml' || baseLower === 'kustomization.yml'
}

/**
 * Парсить усі YAML-документи: **metadata.namespace**, **Deployment.resources**, **imagePullPolicy**.
 * @param {string} rel відносний шлях
 * @param {string} baseLower basename файлу (нижній регістр)
 * @param {string} body вміст після modeline
 * @param {(msg: string) => void} fail реєстрація помилки
 */
function validateK8sYamlPolicyDocuments(rel, baseLower, body, fail) {
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

  for (const [di, doc] of docs.entries()) {
    if (doc.errors.length > 0) {
      fail(`${rel}: YAML (документ ${di + 1}): ${doc.errors.map(e => e.message).join('; ')}`)
    } else {
      const obj = doc.toJSON()
      if (!skipMetaNs) {
        const ns = metadataNamespaceForbiddenViolation(obj)
        if (ns !== null) {
          fail(`${rel}: документ ${di + 1}: ${ns}`)
        }
      }
      const resV = deploymentResourcesViolation(obj)
      if (resV !== null) {
        fail(`${rel}: Deployment (документ ${di + 1}): ${resV}`)
      }
      const pullV = deploymentImagePullPolicyViolation(obj)
      if (pullV !== null) {
        fail(`${rel}: Deployment (документ ${di + 1}): ${pullV}`)
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

  if (baseLower === 'kustomization.yaml' || baseLower === 'kustomization.yml') {
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
 * @param {string[]} healthCheckPolicyFiles накопичувач файлів із kind: HealthCheckPolicy
 * @returns {Promise<void>}
 */
async function checkK8sYamlFile(abs, root, fail, pass, healthCheckPolicyFiles) {
  const rel = relative(root, abs) || abs
  const base = basename(abs)
  const baseLower = base.toLowerCase()

  if (baseLower.endsWith('.yml') && baseLower !== 'kustomization.yml') {
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

  const m = lines[0].match(MODELINE_RE)
  if (!m) {
    fail(`${rel}: перший рядок має бути коментарем # yaml-language-server: $schema=<url> (без префіксів перед #)`)
    return
  }

  const schemaUrl = m[1]
  if (countSchemaModelines(lines) > 1) {
    fail(`${rel}: кілька рядків yaml-language-server $schema — лиш один modeline на файл (див. k8s.mdc)`)
    return
  }

  const body = yamlBodyAfterModeline(lines)

  scanIngressAndHealthCheckPolicy(rel, body, fail, healthCheckPolicyFiles)

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

  validateK8sYamlPolicyDocuments(rel, baseLower, body, fail)
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
 * Якщо є **`k8s/base/kustomization.yaml`**, у ньому має бути непорожній **`namespace`**.
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
  let exitCode = 0
  const fail = msg => {
    console.log(`  ❌ ${msg}`)
    exitCode = 1
  }

  const root = process.cwd()
  const yamlFiles = await findK8sYamlFiles(root)

  if (yamlFiles.length === 0) {
    pass('Немає yaml/yml під k8s — перевірку $schema пропущено')
    return 0
  }

  pass(`YAML у k8s: ${yamlFiles.length} файл(ів)`)

  assertNoForbiddenK8sDevPaths(yamlFiles, root, fail)

  /** @type {string[]} */
  const healthCheckPolicyFiles = []

  for (const abs of yamlFiles) {
    await checkK8sYamlFile(abs, root, fail, pass, healthCheckPolicyFiles)
  }

  await ensureRuKustomizationHealthCheckDelete(root, yamlFiles, healthCheckPolicyFiles, fail)

  await ensureBaseKustomizationHasNamespace(root, yamlFiles, fail)

  return exitCode
}

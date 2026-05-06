/**
 * Перевіряє відповідність проєкту правилу abie.mdc (проєкти AbInBev Efes).
 *
 * Застосовується лише якщо у **`.n-cursor.json`** у масиві **`rules`** є **`abie`** — інакше вихід **0**
 * без перевірок (щоб не суперечити типовому **ga.mdc** з **`ignore_branches: main,dev`**).
 *
 * **Гілки:** у **`.github/workflows/clean-merged-branch.yml`** у кроці з
 * **`phpdocker-io/github-actions-delete-abandoned-branches`** у **`with.ignore_branches`** мають бути
 * **dev**, **ua** та **ru** (разом з іншими гілками, якщо потрібно).
 *
 * **Firebase Hosting:** у **підкаталогах першого рівня** (безпосередні діти кореня репозиторію; `node_modules` / `.git` пропускаються) не має бути
 * **`.firebaserc`**, **`firebase.json`** та каталогу **`.firebase/`**; у **самому** корені репозиторію ці імена не перевіряються.
 *
 * **k8s:** якщо під деревом із сегментом **`k8s`** є YAML з **`kind: Deployment`**, у тій самій директорії
 * має існувати **`hc.yaml`** із **`HealthCheckPolicy`** (**`networking.gke.io/v1`**), modeline **`$schema`**
 * як у abie.mdc, **`requestPath`** — непорожній шлях від кореня (рядок, що починається з **`/`**: **`/healthz`**, **`/IsAlive`**, **`/api/live`** тощо), порт **8080**, **`targetRef`** на **headless Service** (ім'я з суфіксом **`-hl`**):
 * якщо **`metadata.name`** уже закінчується на **`-hl`**, **`targetRef.name`** має збігатися з ним; інакше **`targetRef.name`** = **`${metadata.name}-hl`**.
 * Загальні вимоги до **`# yaml-language-server: $schema`** для інших YAML під **`k8s`** — у **check-k8s.mjs** / **k8s.mdc** (наприклад **HttpBackendGroup** `alb.yc.io/v1alpha1` — **без** modeline).
 * Якщо в дереві **k8s** є **HealthCheckPolicy**, перевіряється **`ru/kustomization.yaml`** з patch **`$patch: delete`**
 * (логіка вмісту — **`ruKustomizationHasHealthCheckDeletePatch`** у **check-k8s.mjs**, узгоджено з **k8s.mdc**).
 *
 * **nodeSelector (base):** якщо **Deployment** лежить у шляху з сегментом **`base`** (наприклад **`…/k8s/base/deploy.yaml`**),
 * у **`spec.template.spec.nodeSelector`** має бути **`preem`** з булевим значенням **true** або рядком **`'true'`** — overlay **ua** та **ru** далі підміняють селектор.
 *
 * **nodeSelector (overlay):** якщо в дереві **k8s** пакета є **Deployment**, у **`ua`/`ru` kustomization** цього пакета — inline patch на **`kind: Deployment`**
 * з **`path: /spec/template/spec/nodeSelector`**: **ua** — **`preem: false`**; **ru** — **`yandex.cloud/preemptible: false`**.
 * Узагальнені вимоги **k8s.mdc** до JSON6902 (зокрема заборона **remove** + **add** на той самий **path**) перевіряє **check-k8s.mjs**; **check-abie** — лише abie-специфічний вміст (без дублювання цього правила).
 *
 * **HTTPRoute (overlay):** лише якщо в каталозі пакета (батько **`k8s`**) є **`vite.config.js`**, **`vite.config.mjs`** або **`vite.config.ts`**
 * — тоді в **`ua`/`ru` kustomization** потрібен patch на **`kind: HTTPRoute`**, **непорожній `target.name`**: **`/spec/hostnames`**
 * (домени abie.mdc), **`/spec/parentRefs/0/namespace`** (**ua** / **ru**); для **ru** — **`gwin.yandex.cloud/rules.http.upgradeTypes: websocket`**,
 * якщо в тому ж **`kustomization.yaml`** згадується **`HASURA_GRAPHQL_JWT_SECRET`** (Hasura + JWT).
 * **HTTPRoute (base / dev):** у маніфесті **HTTPRoute** у шляху з сегментом **`base`** (наприклад **`…/k8s/base/hr.yaml`**) у **`spec.hostnames`** дозволені лише **`aiml.live`**, **`*.aiml.live`** та інші піддомени **aiml.live** (канонічно порівняння без урахування регістру).
 * **Спільні бекенди (`auth-run-hl`, `file-link-hl`):** у **HTTPRoute** під **`k8s`** поза overlay **ua** та **ru** (шлях не містить **`k8s/ua/`** чи **`k8s/ru/`**) кожен такий **`backendRefs`** має **`namespace: dev`** і порт **8080**;
 * у patch overlay **ua** та **ru** — по одному **JSON6902** на **`/spec/rules/…/backendRefs/…/namespace`** з **`value`**: **ua** або **ru** (кількість patch-ів = кількість таких **`backendRefs`** у пакеті).
 * Вибір **`op`** — **k8s.mdc**.
 *
 * **Service (overlay ru):** для кожного **Service**, оголошеного в YAML під **`…/k8s/…`**, де шлях **не** проходить через **`k8s/ua/`** чи **`k8s/ru/`** (маніфести base / спільного шару, у т. ч. **headless** з **`clusterIP: None`** і **`-hl`**), якщо ще не **NodePort** / **LoadBalancer** / **ExternalName**,
 * у файлі **`k8s/ru/kustomization.yaml`** того ж пакета (overlay середовища **ru**) — inline **JSON6902** на **`kind: Service`** з тим самим **`target.name`**: **`path: /spec/type`**, **`value: NodePort`**; якщо в base було **`spec.clusterIP: None`** — **`op: remove`** для **`/spec/clusterIP`**; якщо в base **явно** задано **`spec.clusterIPs`** — також **`remove`** для **`/spec/clusterIPs`** (інакше **API** може залишити **`None`** для **NodePort**; без ключа **`clusterIPs`** у base **`remove`** на **`/spec/clusterIPs`** ламає **`kubectl kustomize`**).
 */
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'

import { parseAllDocuments } from 'yaml'

import { pathHasK8sSegment, ruKustomizationHasHealthCheckDeletePatch } from './check-k8s.mjs'
import { createCheckReporter } from './utils/check-reporter.mjs'
import { flattenWorkflowSteps, getStepUses, parseWorkflowYaml } from './utils/gha-workflow.mjs'
import { loadCursorIgnorePaths } from './utils/load-cursor-config.mjs'
import { walkDir } from './utils/walkDir.mjs'

const CONFIG_FILE = '.n-cursor.json'

/** Каталоги-діти в корені, які пропускаються при скануванні на артефакти Firebase Hosting (abie). */
const ABIE_FIREBASE_HOSTING_SCAN_SKIP_TOP_DIR_NAMES = new Set(['.git', 'node_modules'])

/** Маркер у kustomization.yaml: якщо зустрічається у файлі — для overlay ru у patch HTTPRoute потрібна анотація gwin…websocket. */
const HASURA_JWT_SECRET_IN_KUSTOMIZATION = 'HASURA_GRAPHQL_JWT_SECRET'

/**
 * Спільні **Service** (**`-hl`**) у **dev**: у base-**HTTPRoute** обов'язково **`namespace: dev`**, у overlay — patch **`…/backendRefs/…/namespace`** (abie.mdc).
 * Експорт для споживачів / тестів.
 */
export const ABIE_SHARED_CROSS_NS_BACKEND_NAMES = Object.freeze(['auth-run-hl', 'file-link-hl'])

const ABIE_SHARED_CROSS_NS_BACKEND_SET = new Set(ABIE_SHARED_CROSS_NS_BACKEND_NAMES)

/** Очікуваний URL **`$schema`** для **hc.yaml** (abie.mdc). */
export const ABIE_HC_SCHEMA_URL = 'https://datreeio.github.io/CRDs-catalog/networking.gke.io/healthcheckpolicy_v1.json'

/** Кореневий домен **`spec.hostnames`** для **HTTPRoute** у **`…/k8s/base/…`** (середовище dev, abie.mdc). */
export const ABIE_BASE_DEV_HTTPROUTE_HOST_ROOT = 'aiml.live'

const MODELINE_RE = /^#\s*yaml-language-server:\s*\$schema=(\S+)\s*$/
const LINE_SPLIT_RE = /\r?\n/u
const RU_KUSTOMIZATION_PATH_RE = /(^|\/)ru\/kustomization\.yaml$/u
const UA_KUSTOMIZATION_PATH_RE = /(^|\/)ua\/kustomization\.yaml$/u
const OVERLAY_PACKAGE_DIR_RE = /^(.+)\/k8s\/(?:ua|ru)\/kustomization\.yaml$/u
const BASE_SEGMENT_RE = /(^|\/)base\//u
const YAML_EXTENSION_RE = /\.ya?ml$/iu
const K8S_PACKAGE_DIR_RE = /^(.+)\/k8s\//u
const PATCH_PATH_TYPE_RE = /path:\s*\/spec\/type\b/u
const PATCH_VALUE_NODE_PORT_RE = /value:\s*['"]?NodePort['"]?(?:\s|$)/iu
const PATCH_NODE_SELECTOR_PATH_RE = /path:\s*\/spec\/template\/spec\/nodeSelector\b/u
const PATCH_PREEM_FALSE_RE = /\bpreem:\s*['"]?false['"]?\b/u
const PATCH_YANDEX_PREEMPTIBLE_FALSE_RE = /yandex\.cloud\/preemptible:\s*['"]?false['"]?/u
const TRAILING_SLASH_RE = /\/$/u
const PATCH_HOSTNAMES_PATH_RE = /path:\s*\/spec\/hostnames\b/mu
// Overlay namespaces: allow ua/ru and ua-*/ru-* (e.g. ua-b2b, ru-b2b).
const PATCH_PARENT_REF_NS_UA_RE =
  /path:\s*\/spec\/parentRefs\/0\/namespace\b[\s\S]{0,200}?value:\s*['"]?ua(?:-[a-z0-9][a-z0-9-]*)?['"]?(?:\s|$)/imu
const PATCH_PARENT_REF_NS_RU_RE =
  /path:\s*\/spec\/parentRefs\/0\/namespace\b[\s\S]{0,200}?value:\s*['"]?ru(?:-[a-z0-9][a-z0-9-]*)?['"]?(?:\s|$)/imu
const WEBSOCKET_ANNOTATION_RE = /gwin\.yandex\.cloud\/rules\.http\.upgradeTypes:\s*['"]?websocket['"]?/mu
const LEADING_EMPTY_LINE_RE = /^\s*\n/u
const REMOVE_CLUSTER_IP_AFTER_OP_RE = /op:\s*remove\b[\s\S]{0,200}?path:\s*\/spec\/clusterIP\b/mu
const REMOVE_CLUSTER_IP_BEFORE_OP_RE = /path:\s*\/spec\/clusterIP\b[\s\S]{0,200}?op:\s*remove\b/mu
const REMOVE_CLUSTER_IPS_AFTER_OP_RE = /op:\s*remove\b[\s\S]{0,200}?path:\s*\/spec\/clusterIPs\b/mu
const REMOVE_CLUSTER_IPS_BEFORE_OP_RE = /path:\s*\/spec\/clusterIPs\b[\s\S]{0,200}?op:\s*remove\b/mu

/** Підрядок образу Hasura у контейнері Deployment (abie.mdc nginx-sidecar). */
const HASURA_IMAGE_MARKER = 'hasura/graphql-engine'
/** Nginx-sidecar image (abie.mdc): nginx:*-alpine. */
const NGINX_SIDECAR_IMAGE_RE = /image:\s*nginx:\S*-alpine/u
/** containerPort: 8081 у patch Deployment (abie.mdc). */
const NGINX_SIDECAR_CONTAINER_PORT_RE = /containerPort:\s*8081\b/u
/** port: 8081 у patch Service -hl (proxy порт, abie.mdc). */
const PATCH_PROXY_PORT_8081_RE = /\bport:\s*8081\b/u
/** configmap-nginx.yaml у resources kustomization (abie.mdc). */
const RESOURCES_CONFIGMAP_NGINX_RE = /configmap-nginx\.yaml/u
/** path /spec/rules/{i}/backendRefs/{j}/port … value: 8081 у patch HTTPRoute (path→value, abie.mdc). */
const HTTPROUTE_BACKENDREF_PORT_8081_RE =
  /path:\s*\/spec\/rules\/\d+\/backendRefs\/\d+\/port\b[\s\S]{0,200}?value:\s*8081\b/mu
/** Те саме, value→path. */
const HTTPROUTE_BACKENDREF_PORT_8081_VALUE_FIRST_RE =
  /value:\s*8081\b[\s\S]{0,200}?path:\s*\/spec\/rules\/\d+\/backendRefs\/\d+\/port\b/mu

/** Гілки, які мають бути в **`ignore_branches`** за abie.mdc. */
export const ABIE_REQUIRED_IGNORE_BRANCHES = ['dev', 'ua', 'ru']

/**
 * Чи відносний шлях вказує на **`ru/kustomization.yaml`** (сегмент **`ru`** перед ім'ям файлу) — специфіка abie overlay.
 * @param {string} rel шлях від кореня репозиторію
 * @returns {boolean} true, якщо це `…/ru/kustomization.yaml`
 */
export function isRuKustomizationPath(rel) {
  const norm = rel.replaceAll('\\', '/')
  return RU_KUSTOMIZATION_PATH_RE.test(norm)
}

/**
 * Чи відносний шлях вказує на **`ua/kustomization.yaml`** (сегмент **`ua`** перед ім'ям файлу) — специфіка abie overlay.
 * @param {string} rel шлях від кореня репозиторію
 * @returns {boolean} true, якщо це `…/ua/kustomization.yaml`
 */
export function isUaKustomizationPath(rel) {
  const norm = rel.replaceAll('\\', '/')
  return UA_KUSTOMIZATION_PATH_RE.test(norm)
}

/**
 * Каталог пакета: шлях перед сегментом **`/k8s/`** для overlay **`…/k8s/(ua|ru)/kustomization.yaml`**.
 * @param {string} root корінь репозиторію
 * @param {string} kustomizationAbs абсолютний шлях до **ua** або **ru** kustomization.yaml
 * @returns {string | null} абсолютний шлях до каталогу пакета або null, якщо шлях не overlay ua чи ru
 */
export function abiePackageDirFromK8sOverlay(root, kustomizationAbs) {
  const rel = relative(root, kustomizationAbs).replaceAll('\\', '/') || kustomizationAbs
  const m = rel.match(OVERLAY_PACKAGE_DIR_RE)
  return m ? join(root, m[1]) : null
}

/**
 * Чи для цього overlay застосовувати вимоги **HTTPRoute** (лише Vite-пакети).
 * @param {string} root корінь репозиторію
 * @param {string} kustomizationAbs абсолютний шлях до **ua** або **ru** kustomization.yaml
 * @returns {boolean} **true**, якщо поруч із **k8s** є **vite.config** (**js** / **mjs** / **ts**)
 */
export function abieOverlayRequiresHttpRouteByVite(root, kustomizationAbs) {
  const pkg = abiePackageDirFromK8sOverlay(root, kustomizationAbs)
  if (!pkg) {
    return false
  }
  return (
    existsSync(join(pkg, 'vite.config.js')) ||
    existsSync(join(pkg, 'vite.config.mjs')) ||
    existsSync(join(pkg, 'vite.config.ts'))
  )
}

/**
 * Чи в дереві **k8s** того ж пакета, що й overlay **ua** або **ru**, є **Deployment** (за каталогами з **collectDeploymentDirs**).
 * @param {Set<string>} deploymentDirs абсолютні каталоги YAML-файлів із **Deployment**
 * @param {string} root корінь репозиторію
 * @param {string} kustomizationAbs абсолютний шлях до **ua** або **ru** kustomization.yaml
 * @returns {boolean} **true**, якщо хоч один каталог із **deploymentDirs** лежить під **`…/k8s/`** цього пакета
 */
export function abieOverlayK8sTreeHasDeployment(deploymentDirs, root, kustomizationAbs) {
  const pkg = abiePackageDirFromK8sOverlay(root, kustomizationAbs)
  if (!pkg) {
    return false
  }
  const k8sRoot = join(pkg, 'k8s').replaceAll('\\', '/')
  for (const dir of deploymentDirs) {
    const norm = dir.replaceAll('\\', '/')
    if (norm === k8sRoot || norm.startsWith(`${k8sRoot}/`)) {
      return true
    }
  }
  return false
}

/**
 * Чи відносний шлях до YAML під **k8s** вказує на файл у каталозі **`base`** (сегмент **`base`** у шляху), abie.mdc.
 * @param {string} rel шлях від кореня репозиторію
 * @returns {boolean} true, якщо в шляху є **`/base/`**
 */
export function isAbieK8sBaseYamlPath(rel) {
  const norm = rel.replaceAll('\\', '/')
  return BASE_SEGMENT_RE.test(norm)
}

/**
 * Чи **hostname** дозволений для **HTTPRoute** у **base** (dev): **aiml.live**, **\*.aiml.live** або **\*.…\.aiml.live** (без урахування регістру).
 * @param {string} hostname значення з **spec.hostnames**
 * @returns {boolean} **true**, якщо hostname відповідає abie.mdc
 */
export function isAllowedAbieBaseDevHostname(hostname) {
  if (typeof hostname !== 'string') {
    return false
  }
  const h = hostname.trim().toLowerCase()
  if (h === '') {
    return false
  }
  const root = ABIE_BASE_DEV_HTTPROUTE_HOST_ROOT
  if (h === root) {
    return true
  }
  if (h === `*.${root}`) {
    return true
  }
  if (h.endsWith(`.${root}`)) {
    return true
  }
  return false
}

/**
 * @param {unknown} hostnames значення поля spec.hostnames
 * @returns {string[]} непорожні рядки-хости
 */
function collectAbieHostnames(hostnames) {
  if (Array.isArray(hostnames)) {
    return hostnames.filter(h => typeof h === 'string' && h.trim() !== '')
  }
  if (typeof hostnames === 'string' && hostnames.trim() !== '') {
    return [hostnames]
  }
  return []
}

/**
 * Повідомлення про недопустимі **spec.hostnames** у **HTTPRoute** у шляху **…/base/…** (abie.mdc).
 * @param {unknown} obj корінь YAML-документа
 * @param {string} rel відносний шлях від кореня репозиторію
 * @returns {string[]} порожньо, якщо перевірка не застосовується або hostnames коректні
 */
export function abieBaseHttpRouteHostnamesErrors(obj, rel) {
  if (!isAbieK8sBaseYamlPath(rel)) return []
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return []
  const rec = /** @type {Record<string, unknown>} */ (obj)
  if (rec.kind !== 'HTTPRoute') return []
  const spec = rec.spec
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) return []
  const hostnames = /** @type {Record<string, unknown>} */ (spec).hostnames
  if (hostnames === undefined) return []
  const hosts = collectAbieHostnames(hostnames)
  if (hosts.length === 0) return []
  const root = ABIE_BASE_DEV_HTTPROUTE_HOST_ROOT
  return hosts
    .filter(h => !isAllowedAbieBaseDevHostname(h))
    .map(
      h =>
        `${rel}: HTTPRoute у base (dev): hostname "${h}" недопустимий — дозволені лише ${root} та піддомени, зокрема *.${root} (abie.mdc)`
    )
}

/**
 * Чи значення **`preem`** у base **Deployment** вважається «істинним» за abie.mdc (**true** або рядок **`true`** без урахування регістру).
 * @param {unknown} v значення з YAML
 * @returns {boolean} **true**, якщо значення вважається істинним за abie.mdc
 */
function isAbiePreemTruthy(v) {
  if (v === true) {
    return true
  }
  if (typeof v === 'string' && v.trim().toLowerCase() === 'true') {
    return true
  }
  return false
}

/**
 * Чи документ **Deployment** у **`…/base/…`** містить **`spec.template.spec.nodeSelector.preem`** зі значенням **true** (abie.mdc).
 * @param {unknown} obj корінь YAML-документа (**Deployment**)
 * @returns {boolean} true, якщо критерії виконано
 */
export function deploymentDocumentHasAbieBasePreemNodeSelector(obj) {
  if (!isDeploymentDoc(obj)) {
    return false
  }
  const rec = /** @type {Record<string, unknown>} */ (obj)
  const spec = rec.spec
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
    return false
  }
  const template = /** @type {Record<string, unknown>} */ (spec).template
  if (template === null || typeof template !== 'object' || Array.isArray(template)) {
    return false
  }
  const podSpec = /** @type {Record<string, unknown>} */ (template).spec
  if (podSpec === null || typeof podSpec !== 'object' || Array.isArray(podSpec)) {
    return false
  }
  const nodeSelector = /** @type {Record<string, unknown>} */ (podSpec).nodeSelector
  if (nodeSelector === null || typeof nodeSelector !== 'object' || Array.isArray(nodeSelector)) {
    return false
  }
  return isAbiePreemTruthy(nodeSelector.preem)
}

/**
 * Чи увімкнено правило **abie** у конфігу репозиторію.
 * @param {string} root корінь репозиторію (cwd)
 * @returns {Promise<boolean>} true, якщо **rules** містить **abie**
 */
export async function isAbieRuleEnabled(root) {
  const p = join(root, CONFIG_FILE)
  if (!existsSync(p)) {
    return false
  }
  let raw
  try {
    raw = await readFile(p, 'utf8')
  } catch {
    return false
  }
  let cfg
  try {
    cfg = JSON.parse(raw)
  } catch {
    return false
  }
  const rules = cfg?.rules
  if (!Array.isArray(rules)) {
    return false
  }
  return rules.some(r => String(r).trim().toLowerCase() === 'abie')
}

/**
 * Розбирає **`ignore_branches`** з workflow **clean-merged-branch** (крок delete-abandoned-branches).
 * @param {string} content вміст **.yml**
 * @returns {string | null} рядок **ignore_branches** або **null**
 */
export function parseCleanMergedIgnoreBranches(content) {
  const root = parseWorkflowYaml(content)
  if (!root) {
    return null
  }
  for (const { step } of flattenWorkflowSteps(root)) {
    const uses = getStepUses(step)
    if (uses.includes('phpdocker-io/github-actions-delete-abandoned-branches')) {
      const w = step.with
      if (w && typeof w === 'object' && !Array.isArray(w)) {
        const ib = /** @type {Record<string, unknown>} */ (w).ignore_branches
        if (typeof ib === 'string') {
          return ib
        }
      }
    }
  }
  return null
}

/**
 * Чи рядок **ignore_branches** містить усі гілки з **required** (для abie — dev, ua, ru).
 * @param {string} ignoreBranches значення **ignore_branches**
 * @param {string[]} required імена гілок (нижній регістр для порівняння)
 * @returns {boolean} true, якщо всі **required** присутні як окремі токени
 */
export function ignoreBranchesIncludesRequired(ignoreBranches, required) {
  const parts = new Set(
    ignoreBranches
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean)
  )
  return required.every(r => parts.has(r.toLowerCase()))
}

/**
 * Збирає абсолютні шляхи до **.yaml** / **.yml** під деревом, де є сегмент **k8s**.
 * @param {string} root корінь репозиторію
 * @param {string[]} [ignorePaths] абсолютні шляхи каталогів, повністю виключених з обходу
 * @returns {Promise<string[]>} відсортовані шляхи
 */
async function findK8sYamlFiles(root, ignorePaths = []) {
  /** @type {string[]} */
  const out = []
  await walkDir(
    root,
    p => {
      if (!pathHasK8sSegment(p)) {
        return
      }
      if (!YAML_EXTENSION_RE.test(p)) {
        return
      }
      out.push(p)
    },
    ignorePaths
  )
  return [...out].toSorted((a, b) => a.localeCompare(b))
}

/**
 * Чи документ — **Deployment**.
 * @param {unknown} obj корінь YAML-документа
 * @returns {boolean} true, якщо **kind** документа — **Deployment**
 */
function isDeploymentDoc(obj) {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    !Array.isArray(obj) &&
    /** @type {Record<string, unknown>} */ (obj).kind === 'Deployment'
  )
}

/**
 * Чи документ — **Service**.
 * @param {unknown} obj корінь YAML-документа
 * @returns {boolean} true, якщо **kind** — **Service**
 */
function isServiceDoc(obj) {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    !Array.isArray(obj) &&
    /** @type {Record<string, unknown>} */ (obj).kind === 'Service'
  )
}

/**
 * Чи відносний шлях до YAML під **`…/k8s/…`** не в каталозі overlay **`k8s/ua/`** чи **`k8s/ru/`** у репозиторії (після **`k8s/`** одразу не йде **`ua/`** чи **`ru/`**).
 * @param {string} relFromRoot шлях від кореня
 * @returns {boolean} true для base / спільних маніфестів; **false** для файлів усередині **`k8s/ua/…`** або **`k8s/ru/…`**
 */
function k8sYamlRelOutsideUaRuOverlays(relFromRoot) {
  const norm = relFromRoot.replaceAll('\\', '/')
  const idx = norm.indexOf('/k8s/')
  if (idx === -1) {
    return false
  }
  const after = norm.slice(idx + '/k8s/'.length)
  return after.length > 0 && !after.startsWith('ua/') && !after.startsWith('ru/')
}

/**
 * Каталог пакета з відносного шляху **`…/k8s/…`** (частина до **`/k8s/`**).
 * @param {string} root корінь репозиторію
 * @param {string} relFromRoot відносний шлях
 * @returns {string | null} абсолютний шлях до каталогу пакета або **null**
 */
function abiePackageDirFromK8sYamlRel(root, relFromRoot) {
  const norm = relFromRoot.replaceAll('\\', '/')
  const m = norm.match(K8S_PACKAGE_DIR_RE)
  return m ? join(root, m[1]) : null
}

/**
 * Чи **Service** у base-шарі abie потребує в **ru** patch **`spec.type: NodePort`** (у т. ч. **headless**; не вже **NodePort** / **LoadBalancer** / **ExternalName**).
 * @param {unknown} obj корінь YAML (**Service**)
 * @returns {boolean} true, якщо для overlay **ru** очікується **NodePort**
 */
export function serviceDocumentRequiresAbieRuNodePortOverlay(obj) {
  if (!isServiceDoc(obj)) {
    return false
  }
  const rec = /** @type {Record<string, unknown>} */ (obj)
  const meta = rec.metadata
  if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) {
    return false
  }
  const name = /** @type {Record<string, unknown>} */ (meta).name
  if (typeof name !== 'string' || name.trim() === '') {
    return false
  }
  const spec = rec.spec
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
    return true
  }
  const sp = /** @type {Record<string, unknown>} */ (spec)
  const t = sp.type
  if (t === 'NodePort' || t === 'LoadBalancer' || t === 'ExternalName') {
    return false
  }
  return true
}

/**
 * Чи в base-**Service** задано **headless** через **`spec.clusterIP: None`**, який треба прибрати в **ru** перед **NodePort**.
 * @param {unknown} obj корінь YAML (**Service**)
 * @returns {boolean} **true**, якщо **`spec.clusterIP === 'None'`**
 */
export function serviceDocumentRequiresRuClusterIPNoneRemoval(obj) {
  if (!isServiceDoc(obj)) {
    return false
  }
  const rec = /** @type {Record<string, unknown>} */ (obj)
  const spec = rec.spec
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
    return false
  }
  const sp = /** @type {Record<string, unknown>} */ (spec)
  return sp.clusterIP === 'None'
}

/**
 * Чи в base-**Service** у **`spec`** явно задано поле **`clusterIPs`** (тоді **`remove`** на **`/spec/clusterIPs`** безпечний для **`kubectl kustomize`**).
 * @param {unknown} obj корінь YAML (**Service**)
 * @returns {boolean} **true**, якщо **`Object.hasOwn(spec, 'clusterIPs')`**
 */
export function serviceDocumentBaseDeclaresClusterIPsField(obj) {
  if (!isServiceDoc(obj)) {
    return false
  }
  const rec = /** @type {Record<string, unknown>} */ (obj)
  const spec = rec.spec
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
    return false
  }
  const sp = /** @type {Record<string, unknown>} */ (spec)
  return Object.hasOwn(sp, 'clusterIPs')
}

/**
 * Чи **JSON6902**-текст містить **`op: remove`** для заданого **`path`** (порядок ключів **op** / **path** неважливий).
 * @param {string} patchText поле **patch** у kustomization
 * @param {string} posixPath **`/spec/clusterIP`** або **`/spec/clusterIPs`**
 * @returns {boolean} true, якщо знайдено пару **remove** + **path**
 */
export function jsonPatchRemovesPath(patchText, posixPath) {
  if (typeof patchText !== 'string' || patchText.trim() === '') {
    return false
  }
  if (posixPath !== '/spec/clusterIP' && posixPath !== '/spec/clusterIPs') {
    return false
  }
  if (posixPath === '/spec/clusterIP') {
    return REMOVE_CLUSTER_IP_AFTER_OP_RE.test(patchText) || REMOVE_CLUSTER_IP_BEFORE_OP_RE.test(patchText)
  }
  return REMOVE_CLUSTER_IPS_AFTER_OP_RE.test(patchText) || REMOVE_CLUSTER_IPS_BEFORE_OP_RE.test(patchText)
}

/**
 * Чи patch містить **`op: remove`** для **`/spec/clusterIP`**, щоб прибрати **headless** перед **NodePort**.
 * @param {string} patchText поле **patch** у kustomization
 * @returns {boolean} true, якщо є **remove** для **`/spec/clusterIP`**
 */
export function jsonPatchTextClearsHeadlessServiceClusterIPNone(patchText) {
  return jsonPatchRemovesPath(patchText, '/spec/clusterIP')
}

/**
 * Чи фрагмент **JSON6902** у **`patch`** задає **`/spec/type`** зі значенням **NodePort** (abie overlay **ru**).
 * @param {string} patchText поле **patch** у kustomization
 * @returns {boolean} true, якщо знайдено **path** і **value**
 */
export function jsonPatchTextSetsServiceTypeNodePort(patchText) {
  if (typeof patchText !== 'string' || patchText.trim() === '') {
    return false
  }
  if (!PATCH_PATH_TYPE_RE.test(patchText)) {
    return false
  }
  if (!PATCH_VALUE_NODE_PORT_RE.test(patchText)) {
    return false
  }
  return true
}

/**
 * Витягує ім'я та текст patch для Service з елемента patches.
 * @param {unknown} p елемент масиву patches
 * @returns {{ name: string, patchStr: string } | null} ім'я та текст patch або null
 */
function extractServicePatchEntry(p) {
  if (p === null || typeof p !== 'object' || Array.isArray(p)) return null
  const pr = /** @type {Record<string, unknown>} */ (p)
  const target = pr.target
  if (target === null || typeof target !== 'object' || Array.isArray(target)) return null
  const tg = /** @type {Record<string, unknown>} */ (target)
  if (tg.kind !== 'Service' || typeof tg.name !== 'string' || tg.name.trim() === '') return null
  const patchStr = pr.patch
  if (typeof patchStr !== 'string' || patchStr.trim() === '') return null
  return { name: tg.name, patchStr }
}

/**
 * З одного документа **Kustomization** збирає пари **Service name → patch text** для **inline patches** з **target.kind: Service**.
 * @param {import('yaml').Document} doc документ після **parseAllDocuments**
 * @returns {Map<string, string>} ім'я сервісу → текст **patch**
 */
function collectAbieServicePatchTextsByNameFromKustomizationDoc(doc) {
  /** @type {Map<string, string>} */
  const out = new Map()
  if (doc.errors.length > 0) return out
  const root = doc.toJSON()
  if (root === null || typeof root !== 'object' || Array.isArray(root)) return out
  const rec = /** @type {Record<string, unknown>} */ (root)
  if (rec.kind !== 'Kustomization' || !Array.isArray(rec.patches)) return out
  for (const p of rec.patches) {
    const entry = extractServicePatchEntry(p)
    if (entry) {
      const prev = out.get(entry.name)
      out.set(entry.name, prev === undefined ? entry.patchStr : `${prev}\n${entry.patchStr}`)
    }
  }
  return out
}

/**
 * Збирає тексти **patch** на **Service** з **kustomization.yaml** (усі документи).
 * @param {string} raw повний текст **kustomization.yaml**
 * @returns {Map<string, string>} **target.name** → об'єднаний текст **patch**
 */
function collectAbieRuServicePatchTextByTargetNameFromRaw(raw) {
  const body = stripBom(raw)
  const lines = body.split(LINE_SPLIT_RE)
  const first = lines[0] ?? ''
  const rest = MODELINE_RE.test(first.trim()) ? lines.slice(1).join('\n') : body
  /** @type {Map<string, string>} */
  const byName = new Map()
  /** @type {import('yaml').Document[]} */
  let docs
  try {
    docs = parseAllDocuments(rest)
  } catch {
    return byName
  }
  for (const doc of docs) {
    const chunk = collectAbieServicePatchTextsByNameFromKustomizationDoc(doc)
    for (const [k, v] of chunk) {
      const prev = byName.get(k)
      byName.set(k, prev === undefined ? v : `${prev}\n${v}`)
    }
  }
  return byName
}

/**
 * Збирає помилки patch для одного Service за ім'ям.
 * @param {string} name ім'я Service
 * @param {string | undefined} pt текст patch або undefined
 * @param {{ requiresClusterIPNoneClear: boolean, requiresClusterIPsRemove?: boolean } | undefined} flags прапорці
 * @param {string[]} errors масив для запису помилок
 */
function collectServicePatchErrors(name, pt, flags, errors) {
  if (pt === undefined || String(pt).trim() === '') {
    errors.push(`${name}: немає inline patch для kind: Service`)
    return
  }
  if (!jsonPatchTextSetsServiceTypeNodePort(pt)) {
    errors.push(`${name}: потрібен JSON6902 path /spec/type та value NodePort`)
  }
  if (flags?.requiresClusterIPNoneClear === true && !jsonPatchTextClearsHeadlessServiceClusterIPNone(pt)) {
    errors.push(
      `${name}: для spec.clusterIP: None додай у той самий patch op: remove для path /spec/clusterIP (abie.mdc)`
    )
  }
  if (flags?.requiresClusterIPsRemove === true && !jsonPatchRemovesPath(pt, '/spec/clusterIPs')) {
    errors.push(
      `${name}: у base задано spec.clusterIPs — додай op: remove для path /spec/clusterIPs (інакше NodePort з None у clusterIPs; abie.mdc)`
    )
  }
}

/**
 * Повідомлення про порушення patch **Service** у **ru/kustomization.yaml** (abie.mdc).
 * @param {string} raw повний текст **kustomization.yaml**
 * @param {Map<string, { requiresClusterIPNoneClear: boolean, requiresClusterIPsRemove?: boolean }>} targetsByName ім'я **Service** → прапорці patch
 * @returns {string[]} порожньо, якщо все OK
 */
export function getAbieRuServiceNodePortPatchErrors(raw, targetsByName) {
  if (targetsByName.size === 0) return []
  const byName = collectAbieRuServicePatchTextByTargetNameFromRaw(raw)
  /** @type {string[]} */
  const errors = []
  for (const name of [...targetsByName.keys()].toSorted((a, b) => a.localeCompare(b))) {
    collectServicePatchErrors(name, byName.get(name), targetsByName.get(name), errors)
  }
  return errors
}

/**
 * Для кожного пакета збирає **Service**, які в overlay **ru** мають стати **NodePort** (abie.mdc).
 * @param {string} root корінь репозиторію
 * @param {string[]} yamlAbs абсолютні шляхи yaml під **k8s**
 * @param {(msg: string) => void} fail реєстрація помилки читання/парсингу
 * @returns {Promise<Map<string, Map<string, { requiresClusterIPNoneClear: boolean, requiresClusterIPsRemove: boolean }>>>} **pkgAbs** → (**ім'я** → прапорці)
 */
/**
 * Обробляє один Service-документ для збору NodePort-патч цілей.
 * @param {unknown} obj YAML-документ (toJSON)
 * @param {string} pkgAbs абсолютний шлях до пакета
 * @param {Map<string, Map<string, { requiresClusterIPNoneClear: boolean, requiresClusterIPsRemove: boolean }>>} map результуючий Map
 */
function processServiceDocForNodePortTargets(obj, pkgAbs, map) {
  if (!serviceDocumentRequiresAbieRuNodePortOverlay(obj)) return
  const rec = /** @type {Record<string, unknown>} */ (obj)
  const meta = /** @type {Record<string, unknown>} */ (rec.metadata)
  const n = meta.name
  if (typeof n !== 'string' || n.trim() === '') return
  let inner = map.get(pkgAbs)
  if (!inner) {
    inner = new Map()
    map.set(pkgAbs, inner)
  }
  const needClear = serviceDocumentRequiresRuClusterIPNoneRemoval(obj)
  const needClusterIPsRemove = serviceDocumentBaseDeclaresClusterIPsField(obj)
  const prev = inner.get(n)
  inner.set(n, {
    requiresClusterIPNoneClear: prev?.requiresClusterIPNoneClear === true || needClear,
    requiresClusterIPsRemove: prev?.requiresClusterIPsRemove === true || needClusterIPsRemove
  })
}

/**
 * Обробляє YAML-документи з одного файлу для збору NodePort-патч цілей.
 * @param {import('yaml').Document[]} docs документи з файлу
 * @param {string} pkgAbs абсолютний шлях пакета
 * @param {Map<string, Map<string, { requiresClusterIPNoneClear: boolean, requiresClusterIPsRemove: boolean }>>} map результуючий Map
 */
function collectNodePortTargetsFromDocs(docs, pkgAbs, map) {
  for (const doc of docs) {
    if (doc.errors.length === 0) {
      processServiceDocForNodePortTargets(doc.toJSON(), pkgAbs, map)
    }
  }
}

/**
 * Для кожного пакета збирає **Service**, які в overlay **ru** мають стати **NodePort** (abie.mdc).
 * @param {string} root корінь репозиторію
 * @param {string[]} yamlAbs абсолютні шляхи yaml під **k8s**
 * @param {(msg: string) => void} fail реєстрація помилки читання/парсингу
 * @returns {Promise<Map<string, Map<string, { requiresClusterIPNoneClear: boolean, requiresClusterIPsRemove: boolean }>>>} пакет → назва сервісу → прапори NodePort
 */
async function collectAbieRuNodePortServiceTargetsByPackage(root, yamlAbs, fail) {
  /** @type {Map<string, Map<string, { requiresClusterIPNoneClear: boolean, requiresClusterIPsRemove: boolean }>>} */
  const map = new Map()
  for (const abs of yamlAbs) {
    const rel = relative(root, abs).replaceAll('\\', '/') || abs
    const pkgAbs = k8sYamlRelOutsideUaRuOverlays(rel) ? abiePackageDirFromK8sYamlRel(root, rel) : null
    if (pkgAbs) {
      const docs = await readAndParseYamlDocs(abs, rel, fail)
      if (docs) collectNodePortTargetsFromDocs(docs, pkgAbs, map)
    }
  }
  return map
}

/**
 * У **`k8s/ru/kustomization.yaml`** для кожного **Service** з YAML **`k8s`**, шлях якого без сегментів **`k8s/ua/`** та **`k8s/ru/`** (у т. ч. **headless** / **`-hl`**) — **JSON6902** **`/spec/type` → NodePort**; при **`clusterIP: None`** — **`op: remove`** на **`/spec/clusterIP`**; якщо в base є **`spec.clusterIPs`** — ще **`remove`** на **`/spec/clusterIPs`** (abie.mdc).
 * @param {string} root корінь
 * @param {string[]} yamlFilesAbs yaml під **k8s**
 * @param {(msg: string) => void} fail callback
 * @param {(msg: string) => void} passFn успішне повідомлення
 * @returns {Promise<void>}
 */
async function ensureRuAbieServiceNodePortPatches(root, yamlFilesAbs, fail, passFn) {
  const byPkg = await collectAbieRuNodePortServiceTargetsByPackage(root, yamlFilesAbs, fail)
  const entries = [...byPkg.entries()].filter(([, m]) => m.size > 0)
  if (entries.length === 0) {
    passFn('Немає Service у шарі k8s без k8s/ua/ та k8s/ru/ — patch NodePort у k8s/ru/ не вимагається (abie.mdc)')
    return
  }
  for (const [pkgAbs, targetsByName] of entries.toSorted((a, b) => a[0].localeCompare(b[0]))) {
    const relPkg = relative(root, pkgAbs).replaceAll('\\', '/') || pkgAbs
    const ruAbs = join(pkgAbs, 'k8s', 'ru', 'kustomization.yaml')
    const nameList = [...targetsByName.keys()].toSorted((a, b) => a.localeCompare(b))
    if (!existsSync(ruAbs)) {
      fail(
        `${relPkg}/k8s: є Service, для overlay ru потрібен patch Service (NodePort; для headless — ще remove /spec/clusterIP): ${nameList.join(', ')} — додай ru/kustomization.yaml (abie.mdc)`
      )
      return
    }
    const relRu = relative(root, ruAbs).replaceAll('\\', '/') || ruAbs
    let raw
    try {
      raw = await readFile(ruAbs, 'utf8')
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      fail(`${relRu}: не вдалося прочитати (${msg})`)
      return
    }
    const patchErrors = getAbieRuServiceNodePortPatchErrors(raw, targetsByName)
    if (patchErrors.length > 0) {
      fail(`${relRu}: ${patchErrors.join('; ')}`)
      return
    }
    passFn(`${relRu}: patch Service → NodePort (ru) відповідає abie.mdc`)
  }
}

/**
 * Директорії, де є хоча б один **Deployment** у файлах **k8s**.
 * @param {string} root корінь cwd
 * @param {string[]} yamlAbs абсолютні шляхи yaml під k8s
 * @param {(msg: string) => void} fail реєстрація помилки парсингу
 * @returns {Promise<Set<string>>} абсолютні шляхи директорій
 */
async function collectDeploymentDirs(root, yamlAbs, fail) {
  /** @type {Set<string>} */
  const dirs = new Set()
  for (const abs of yamlAbs) {
    const rel = relative(root, abs).replaceAll('\\', '/') || abs
    const docs = await readAndParseYamlDocs(abs, rel, fail)
    if (docs) {
      for (const doc of docs) {
        if (doc.errors.length === 0 && isDeploymentDoc(doc.toJSON())) {
          dirs.add(dirname(abs))
        }
      }
    }
  }
  return dirs
}

/**
 * Перевіряє документи з одного файлу на наявність Deployment з preem nodeSelector.
 * @param {import('yaml').Document[]} docs документи з файлу
 * @param {string} rel відносний шлях файлу
 * @param {(msg: string) => void} fail callback
 * @returns {'violation' | 'found' | 'none'} результат перевірки
 */
function checkBaseDeploymentDocsForPreem(docs, rel, fail) {
  for (const doc of docs) {
    if (doc.errors.length === 0) {
      const obj = doc.toJSON()
      if (isDeploymentDoc(obj)) {
        if (!deploymentDocumentHasAbieBasePreemNodeSelector(obj)) {
          fail(
            `${rel}: Deployment у base: потрібен spec.template.spec.nodeSelector.preem: true (або 'true') — abie.mdc`
          )
          return 'violation'
        }
        return 'found'
      }
    }
  }
  return 'none'
}

/**
 * Для кожного **Deployment** у YAML під **`k8s`** з шляхом **`…/base/…`** вимагає **`spec.template.spec.nodeSelector.preem: true`** (abie.mdc).
 * @param {string} root корінь репозиторію
 * @param {string[]} yamlFilesAbs yaml під k8s
 * @param {(msg: string) => void} fail callback
 * @param {(msg: string) => void} passFn успішне повідомлення
 * @returns {Promise<void>}
 */
async function ensureAbieBaseDeploymentPreemNodeSelector(root, yamlFilesAbs, fail, passFn) {
  const baseFiles = yamlFilesAbs.filter(abs => isAbieK8sBaseYamlPath(relative(root, abs).replaceAll('\\', '/') || abs))
  let anyBaseDeployment = false
  for (const abs of baseFiles) {
    const rel = relative(root, abs).replaceAll('\\', '/') || abs
    const docs = await readAndParseYamlDocs(abs, rel, fail)
    if (!docs) return
    const r = checkBaseDeploymentDocsForPreem(docs, rel, fail)
    if (r === 'violation') return
    if (r === 'found') anyBaseDeployment = true
  }
  if (anyBaseDeployment) {
    passFn('Deployment у …/base/…: nodeSelector.preem відповідає abie.mdc')
  } else {
    passFn('Немає Deployment у шляхах …/base/… — перевірку preem у base пропущено')
  }
}

/**
 * Прибирає BOM на початку файлу.
 * @param {string} s вміст
 * @returns {string} той самий рядок без BOM (U+FEFF) на початку
 */
function stripBom(s) {
  return s.startsWith('\uFEFF') ? s.slice(1) : s
}

/**
 * Зчитує та парсить YAML-документи з файлу.
 * При помилці читання викликає `failFn` і повертає `null`.
 * При помилці парсингу викликає `failFn` і повертає `null`.
 * Автоматично видаляє BOM та modeline (перший рядок з `$schema`).
 * @param {string} abs абсолютний шлях до файлу
 * @param {string} rel відносний шлях (для повідомлень)
 * @param {(msg: string) => void} failFn callback при помилці
 * @returns {Promise<import('yaml').Document[] | null>} масив документів або null при помилці
 */
async function readAndParseYamlDocs(abs, rel, failFn) {
  let raw
  try {
    raw = await readFile(abs, 'utf8')
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    failFn(`${rel}: не вдалося прочитати (${msg})`)
    return null
  }
  const body = stripBom(raw)
  const lines = body.split(LINE_SPLIT_RE)
  const first = lines[0] ?? ''
  const rest = MODELINE_RE.test(first.trim()) ? lines.slice(1).join('\n') : body
  try {
    return parseAllDocuments(rest)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    failFn(`${rel}: YAML (${msg})`)
    return null
  }
}

/**
 * No-op fail handler для функцій, що повертають null/порожній масив при помилці.
 * @param {string} _msg повідомлення ігнорується
 */
const silentFail = _msg => {
  /* silent — пошкоджені файли ловить check-k8s */
}

/**
 * Чи рядок inline JSON6902 patch містить очікуваний **ua** nodeSelector (**preem: false** на **`/spec/template/spec/nodeSelector`**).
 * Конкретний **`op`** не перевіряється — див. **k8s.mdc**.
 * @param {string} patchText поле **patch** у kustomization
 * @returns {boolean} true, якщо критерії abie.mdc виконано
 */
function jsonPatchTextHasUaDeploymentNodeSelector(patchText) {
  if (typeof patchText !== 'string' || patchText.trim() === '') {
    return false
  }
  if (!PATCH_NODE_SELECTOR_PATH_RE.test(patchText)) {
    return false
  }
  if (!PATCH_PREEM_FALSE_RE.test(patchText)) {
    return false
  }
  return true
}

/**
 * Чи рядок inline JSON6902 patch містить очікуваний **ru** nodeSelector (**yandex.cloud/preemptible: false** на **`/spec/template/spec/nodeSelector`**).
 * Конкретний **`op`** не перевіряється — див. **k8s.mdc**.
 * @param {string} patchText поле **patch** у kustomization
 * @returns {boolean} true, якщо критерії abie.mdc виконано
 */
function jsonPatchTextHasRuDeploymentNodeSelector(patchText) {
  if (typeof patchText !== 'string' || patchText.trim() === '') {
    return false
  }
  if (!PATCH_NODE_SELECTOR_PATH_RE.test(patchText)) {
    return false
  }
  if (!PATCH_YANDEX_PREEMPTIBLE_FALSE_RE.test(patchText)) {
    return false
  }
  return true
}

/**
 * Чи один елемент **patches** у kustomization відповідає abie nodeSelector для заданого **mode**.
 * @param {unknown} p елемент масиву **patches**
 * @param {'ua' | 'ru'} mode який overlay перевіряти
 * @returns {boolean} true, якщо patch відповідає abie для **mode**
 */
function inlineKustomizationPatchMatchesAbieMode(p, mode) {
  if (p === null || typeof p !== 'object' || Array.isArray(p)) {
    return false
  }
  const pr = /** @type {Record<string, unknown>} */ (p)
  const target = pr.target
  if (target === null || typeof target !== 'object' || Array.isArray(target)) {
    return false
  }
  const tg = /** @type {Record<string, unknown>} */ (target)
  if (tg.kind !== 'Deployment') {
    return false
  }
  const patchStr = pr.patch
  if (typeof patchStr !== 'string') {
    return false
  }
  if (mode === 'ua' && jsonPatchTextHasUaDeploymentNodeSelector(patchStr)) {
    return true
  }
  if (mode === 'ru' && jsonPatchTextHasRuDeploymentNodeSelector(patchStr)) {
    return true
  }
  return false
}

/**
 * Чи один YAML-документ kustomization містить відповідний inline patch на Deployment.
 * @param {import('yaml').Document} doc документ після **parseAllDocuments**
 * @param {'ua' | 'ru'} mode який overlay перевіряти
 * @returns {boolean} true, якщо знайдено відповідний patch
 */
function kustomizationDocumentHasAbieDeploymentNodeSelectorPatch(doc, mode) {
  if (doc.errors.length > 0) {
    return false
  }
  const root = doc.toJSON()
  if (root === null || typeof root !== 'object' || Array.isArray(root)) {
    return false
  }
  const rec = /** @type {Record<string, unknown>} */ (root)
  if (rec.kind !== 'Kustomization') {
    return false
  }
  const patches = rec.patches
  if (!Array.isArray(patches)) {
    return false
  }
  for (const p of patches) {
    if (inlineKustomizationPatchMatchesAbieMode(p, mode)) {
      return true
    }
  }
  return false
}

/**
 * Чи **kustomization.yaml** містить inline **patches** на **Deployment** з nodeSelector за abie.mdc (**ua** або **ru**).
 * @param {string} raw повний текст файлу
 * @param {'ua' | 'ru'} mode який overlay перевіряти
 * @returns {boolean} true, якщо знайдено відповідний patch
 */
export function kustomizationHasAbieDeploymentNodeSelectorPatch(raw, mode) {
  const body = stripBom(raw)
  const lines = body.split(LINE_SPLIT_RE)
  const first = lines[0] ?? ''
  const rest = MODELINE_RE.test(first.trim()) ? lines.slice(1).join('\n') : body
  /** @type {import('yaml').Document[]} */
  let docs
  try {
    docs = parseAllDocuments(rest)
  } catch {
    return false
  }
  for (const doc of docs) {
    if (kustomizationDocumentHasAbieDeploymentNodeSelectorPatch(doc, mode)) {
      return true
    }
  }
  return false
}

/**
 * Чи YAML відносно кореня належить до **`${pkgRel}/k8s/**`** поза піддеревами **`ua/`** та **`ru/`** (base-шар abie).
 * @param {string} relFromRoot відносний шлях від кореня
 * @param {string} pkgRelFromRoot каталог пакета відносно кореня (без завершального слеша після імені пакета)
 * @returns {boolean} `true`, якщо шлях належить до base-шару abie
 */
export function isK8sYamlInAbiePackageExcludingUaRuOverlays(relFromRoot, pkgRelFromRoot) {
  const normRel = relFromRoot.replaceAll('\\', '/')
  const pkg = pkgRelFromRoot.replaceAll('\\', '/').replace(TRAILING_SLASH_RE, '')
  const prefix = `${pkg}/k8s/`
  if (!normRel.startsWith(prefix)) {
    return false
  }
  const after = normRel.slice(prefix.length)
  return !after.startsWith('ua/') && !after.startsWith('ru/')
}

/**
 * Перевіряє один backendRef на відповідність abie.mdc.
 * @param {unknown} br параметр br
 * @param {string} rel відносний шлях (для повідомлень)
 * @param {string[]} errors масив для запису помилок
 * @returns {number} 1 якщо знайдено shared backend, 0 інакше
 */
function checkSharedBackendRef(br, rel, errors) {
  if (br === null || typeof br !== 'object' || Array.isArray(br)) return 0
  const brRec = /** @type {Record<string, unknown>} */ (br)
  const name = brRec.name
  if (typeof name !== 'string' || !ABIE_SHARED_CROSS_NS_BACKEND_SET.has(name)) return 0
  if (typeof brRec.namespace !== 'string' || brRec.namespace !== 'dev') {
    errors.push(`${rel}: HTTPRoute backendRefs до ${name} має містити namespace: dev (abie.mdc)`)
  }
  return 1
}

/**
 * З HTTPRoute-документа рахує **`backendRefs`** до **`auth-run-hl`** / **`file-link-hl`** і порушення **`namespace: dev`**.
 * @param {unknown} obj корінь YAML
 * @param {string} rel відносний шлях (повідомлення)
 * @returns {{ refCount: number, errors: string[] }} кількість посилань і список порушень
 */
function httpRouteDocSharedCrossNsBackendStats(obj, rel) {
  /** @type {string[]} */
  const errors = []
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return { refCount: 0, errors }
  const rec = /** @type {Record<string, unknown>} */ (obj)
  if (rec.kind !== 'HTTPRoute') return { refCount: 0, errors }
  const spec = rec.spec
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) return { refCount: 0, errors }
  const rules = /** @type {Record<string, unknown>} */ (spec).rules
  if (!Array.isArray(rules)) return { refCount: 0, errors }
  let refCount = 0
  for (const rule of rules) {
    if (rule !== null && typeof rule === 'object' && !Array.isArray(rule)) {
      const brs = /** @type {Record<string, unknown>} */ (rule).backendRefs
      if (Array.isArray(brs)) {
        for (const br of brs) {
          refCount += checkSharedBackendRef(br, rel, errors)
        }
      }
    }
  }
  return { refCount, errors }
}

/**
 * З YAML під **k8s** пакета (без overlay **ua** та **ru**) збирає кількість **`backendRefs`** до **`auth-run-hl`** і **`file-link-hl`** і порушення **`namespace: dev`**.
 * @param {string} root корінь репозиторію
 * @param {string} pkgAbs абсолютний шлях до каталогу пакета
 * @param {string[]} yamlFilesAbs усі **yaml** під **k8s** (як **findK8sYamlFiles**)
 * @returns {Promise<{ refCount: number, baseErrors: string[] }>} кількість посилань і базові помилки
 */
export async function analyzeAbieSharedBackendRefsInPackageK8s(root, pkgAbs, yamlFilesAbs) {
  const pkgRel = relative(root, pkgAbs).replaceAll('\\', '/') || pkgAbs
  let refCount = 0
  /** @type {string[]} */
  const baseErrors = []
  for (const abs of yamlFilesAbs) {
    const rel = relative(root, abs).replaceAll('\\', '/') || abs
    if (isK8sYamlInAbiePackageExcludingUaRuOverlays(rel, pkgRel)) {
      const docs = await readAndParseYamlDocs(abs, rel, silentFail)
      if (docs) {
        for (const doc of docs) {
          if (doc.errors.length === 0) {
            const json = doc.toJSON()
            const st = httpRouteDocSharedCrossNsBackendStats(json, rel)
            refCount += st.refCount
            baseErrors.push(...st.errors)
          }
        }
      }
    }
  }
  return { refCount, baseErrors }
}

/**
 * Рахує операції JSON6902 з **`path`**: **`/spec/rules/…/backendRefs/…/namespace`** та **`value`** overlay.
 * @param {string} combined сукупний текст patch **HTTPRoute**
 * @param {'ua' | 'ru'} mode overlay
 * @returns {number} кількість знайдених патчів namespace
 */
function countAbieHttpRouteBackendRefNamespacePatchesInCombined(combined, mode) {
  const re =
    mode === 'ua'
      ? /path:\s*\/spec\/rules\/\d+\/backendRefs\/\d+\/namespace\b[\s\S]{0,200}?value:\s*['"]?ua(?:-[a-z0-9][a-z0-9-]*)?['"]?(?:\s|$)/gimu
      : /path:\s*\/spec\/rules\/\d+\/backendRefs\/\d+\/namespace\b[\s\S]{0,200}?value:\s*['"]?ru(?:-[a-z0-9][a-z0-9-]*)?['"]?(?:\s|$)/gimu
  return [...combined.matchAll(re)].length
}

/** Домени **hostnames** для overlay **ua** (підрядки у JSON6902-тексті patch), abie.mdc. */
const ABIE_UA_HTTPROUTE_HOST_MARKERS = ['abie.app', 'vybeerai.com.ua', '*.abie.app', '*.vybeerai.com.ua']

/** Домени **hostnames** для overlay **ru** (підрядки), abie.mdc. */
const ABIE_RU_HTTPROUTE_HOST_MARKERS = [
  'napitkivmeste.tech',
  'выбирайонлайн.рф',
  '*.napitkivmeste.tech',
  '*.выбирайонлайн.рф'
]

/**
 * Витягує текст patch HTTPRoute з елемента patches.
 * @param {unknown} p елемент масиву patches
 * @returns {string | null} текст patch або null
 */
function extractHttpRoutePatchString(p) {
  if (p === null || typeof p !== 'object' || Array.isArray(p)) return null
  const pr = /** @type {Record<string, unknown>} */ (p)
  const target = pr.target
  if (target === null || typeof target !== 'object' || Array.isArray(target)) return null
  const tg = /** @type {Record<string, unknown>} */ (target)
  if (tg.kind !== 'HTTPRoute' || typeof tg.name !== 'string' || tg.name.trim() === '') return null
  const patchStr = pr.patch
  return typeof patchStr === 'string' && patchStr.trim() !== '' ? patchStr : null
}

/**
 * Збирає тексти inline **patch** для **HTTPRoute** (будь-який непорожній **target.name**) з одного документа **Kustomization**.
 * @param {import('yaml').Document} doc документ після **parseAllDocuments**
 * @returns {string[]} непорожні рядки **patch**
 */
function collectAbieHttpRoutePatchStringsFromKustomizationDoc(doc) {
  if (doc.errors.length > 0) return []
  const root = doc.toJSON()
  if (root === null || typeof root !== 'object' || Array.isArray(root)) return []
  const rec = /** @type {Record<string, unknown>} */ (root)
  if (rec.kind !== 'Kustomization' || !Array.isArray(rec.patches)) return []
  /** @type {string[]} */
  const out = []
  for (const p of rec.patches) {
    const s = extractHttpRoutePatchString(p)
    if (s !== null) out.push(s)
  }
  return out
}

/**
 * Збирає всі inline **JSON6902**-фрагменти для **HTTPRoute** (непорожній **target.name**) у **kustomization.yaml** (усі документи у файлі).
 * @param {string} raw повний текст файлу
 * @returns {string} текст для **`validateAbieNginxRunHttpRoutePatches`** (може бути порожнім)
 */
export function getCombinedNginxRunPatchTextFromKustomization(raw) {
  const body = stripBom(raw)
  const lines = body.split(LINE_SPLIT_RE)
  const first = lines[0] ?? ''
  const rest = MODELINE_RE.test(first.trim()) ? lines.slice(1).join('\n') : body
  /** @type {import('yaml').Document[]} */
  let docs
  try {
    docs = parseAllDocuments(rest)
  } catch {
    return ''
  }
  /** @type {string[]} */
  const chunks = []
  for (const doc of docs) {
    chunks.push(...collectAbieHttpRoutePatchStringsFromKustomizationDoc(doc))
  }
  return chunks.join('\n')
}

/**
 * Перевіряє сукупний текст patch(ів) **HTTPRoute** (будь-яке **target.name**) на відповідність abie.mdc.
 * @param {string} combined текст одного або кількох inline **patch**, розділених символом нового рядка
 * @param {'ua' | 'ru'} mode **ua** або **ru**
 * @param {string} [fullKustomizationRaw] повний текст **kustomization.yaml** — для **ru** визначає, чи потрібна анотація **gwin…websocket** (лише якщо є **`HASURA_GRAPHQL_JWT_SECRET`**)
 * @param {number} [sharedCrossNsBackendRefCount] скільки **`backendRefs`** до **`auth-run-hl`** і **`file-link-hl`** у base **HTTPRoute** пакета — стільки ж patch-ів **`…/backendRefs/…/namespace`** з **`value`** overlay
 * @returns {string | null} повідомлення про помилку або **null**
 */
export function validateAbieNginxRunHttpRoutePatches(
  combined,
  mode,
  fullKustomizationRaw,
  sharedCrossNsBackendRefCount = 0
) {
  if (typeof combined !== 'string' || combined.trim() === '') {
    return `очікується patch target kind HTTPRoute з непорожнім target.name (hostnames, parentRefs namespace ${mode}; для ru — gwin… websocket лише за наявності HASURA_GRAPHQL_JWT_SECRET у файлі) — abie.mdc`
  }
  if (!PATCH_HOSTNAMES_PATH_RE.test(combined)) {
    return 'HTTPRoute: потрібен path /spec/hostnames у patch (abie.mdc)'
  }
  const markers = mode === 'ua' ? ABIE_UA_HTTPROUTE_HOST_MARKERS : ABIE_RU_HTTPROUTE_HOST_MARKERS
  if (!markers.some(m => combined.includes(m))) {
    return `HTTPRoute: у value для /spec/hostnames має бути один із доменів abie (${markers.join(', ')}) — abie.mdc`
  }
  const namespaceOk =
    mode === 'ua' ? PATCH_PARENT_REF_NS_UA_RE.test(combined) : PATCH_PARENT_REF_NS_RU_RE.test(combined)
  if (!namespaceOk) {
    return `HTTPRoute: потрібен path /spec/parentRefs/0/namespace з value ${mode} (abie.mdc)`
  }
  const ruNeedsWebsocket =
    mode === 'ru' &&
    typeof fullKustomizationRaw === 'string' &&
    fullKustomizationRaw.includes(HASURA_JWT_SECRET_IN_KUSTOMIZATION)
  if (ruNeedsWebsocket && !WEBSOCKET_ANNOTATION_RE.test(combined)) {
    return 'HTTPRoute (ru): за наявності HASURA_GRAPHQL_JWT_SECRET у kustomization потрібна анотація gwin.yandex.cloud/rules.http.upgradeTypes: websocket (abie.mdc)'
  }
  const sharedCount =
    typeof sharedCrossNsBackendRefCount === 'number' && Number.isFinite(sharedCrossNsBackendRefCount)
      ? Math.max(0, Math.floor(sharedCrossNsBackendRefCount))
      : 0
  if (sharedCount > 0) {
    const patchHits = countAbieHttpRouteBackendRefNamespacePatchesInCombined(combined, mode)
    if (patchHits < sharedCount) {
      return `HTTPRoute: для backendRefs до спільних сервісів auth-run-hl, file-link-hl очікується ${sharedCount} JSON6902 patch(ів) з path /spec/rules/…/backendRefs/…/namespace та value ${mode} (зараз ${patchHits}) — abie.mdc`
    }
  }
  return null
}

/**
 * Чи **kustomization** містить валідні для abie **patch** для **HTTPRoute** з непорожнім **target.name** (**ua** або **ru**).
 * @param {string} raw повний текст **kustomization.yaml**
 * @param {'ua' | 'ru'} mode overlay
 * @returns {boolean} true, якщо **`validateAbieNginxRunHttpRoutePatches`** повертає **null**
 */
export function kustomizationHasAbieNginxRunHttpRoutePatch(raw, mode) {
  const combined = getCombinedNginxRunPatchTextFromKustomization(raw)
  return validateAbieNginxRunHttpRoutePatches(combined, mode, raw) === null
}

/**
 * Перевіряє об'єкт HealthCheckPolicy на відповідність abie.mdc.
 * @param {Record<string, unknown>} policy розібраний HealthCheckPolicy
 * @param {string} relPath відносний шлях (для повідомлень)
 * @returns {string | null} текст помилки або null якщо OK
 */
function validateAbieHcPolicy(policy, relPath) {
  if (policy.apiVersion !== 'networking.gke.io/v1') {
    return `${relPath}: apiVersion має бути networking.gke.io/v1 (abie.mdc)`
  }
  const meta = policy.metadata
  if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) {
    return `${relPath}: відсутній metadata (abie.mdc)`
  }
  const name = /** @type {Record<string, unknown>} */ (meta).name
  if (typeof name !== 'string' || name.trim() === '') {
    return `${relPath}: metadata.name має бути непорожнім рядком (abie.mdc)`
  }
  const spec = policy.spec
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
    return `${relPath}: відсутній spec (abie.mdc)`
  }
  const specRec = /** @type {Record<string, unknown>} */ (spec)
  const def = specRec.default
  if (def === null || typeof def !== 'object' || Array.isArray(def)) {
    return `${relPath}: відсутній spec.default (abie.mdc)`
  }
  const config = /** @type {Record<string, unknown>} */ (def).config
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    return `${relPath}: відсутній spec.default.config (abie.mdc)`
  }
  if (config.type !== 'HTTP') return `${relPath}: spec.default.config.type має бути HTTP (abie.mdc)`
  const httpHc = /** @type {Record<string, unknown>} */ (config).httpHealthCheck
  if (httpHc === null || typeof httpHc !== 'object' || Array.isArray(httpHc)) {
    return `${relPath}: відсутній httpHealthCheck (abie.mdc)`
  }
  const requestPath = typeof httpHc.requestPath === 'string' ? httpHc.requestPath.trim() : ''
  if (requestPath === '' || !requestPath.startsWith('/')) {
    return `${relPath}: httpHealthCheck.requestPath має бути непорожнім шляхом від кореня (рядок, що починається з /) (abie.mdc)`
  }
  if (httpHc.port !== 8080) return `${relPath}: httpHealthCheck.port має бути 8080 (abie.mdc)`
  const targetRef = specRec.targetRef
  if (targetRef === null || typeof targetRef !== 'object' || Array.isArray(targetRef)) {
    return `${relPath}: відсутній targetRef (abie.mdc)`
  }
  const tr = /** @type {Record<string, unknown>} */ (targetRef)
  if (tr.kind !== 'Service') return `${relPath}: targetRef.kind має бути Service (abie.mdc)`
  const expectedHl = name.endsWith('-hl') ? name : `${name}-hl`
  if (typeof tr.name !== 'string' || tr.name !== expectedHl) {
    return `${relPath}: targetRef.name має посилатися на headless Service (очікується ${expectedHl}, суфікс -hl) (abie.mdc)`
  }
  return null
}

/**
 * Шукає HealthCheckPolicy серед YAML-документів.
 * @param {import('yaml').Document[]} docs документи
 * @param {string} relPath відносний шлях для повідомлень
 * @returns {{ policy: Record<string, unknown> } | { error: string }} знайдений документ або помилка
 */
function findHealthCheckPolicyInDocs(docs, relPath) {
  for (const doc of docs) {
    if (doc.errors.length > 0) {
      return { error: `${relPath}: YAML: ${doc.errors.map(e => e.message).join('; ')}` }
    }
    const obj = doc.toJSON()
    if (obj !== null && typeof obj === 'object' && !Array.isArray(obj)) {
      const rec = /** @type {Record<string, unknown>} */ (obj)
      if (rec.kind === 'HealthCheckPolicy') {
        return { policy: rec }
      }
    }
  }
  return { policy: /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (null)) }
}

/**
 * Перевіряє hc.yaml на відповідність схемі та структурі HealthCheckPolicy (abie.mdc).
 * @param {string} raw вміст файлу
 * @param {string} relPath відносний шлях (для повідомлень)
 * @returns {string | null} null якщо OK, рядок з помилкою
 */
export function validateAbieHcYaml(raw, relPath) {
  const body = stripBom(raw)
  const lines = body.split(LINE_SPLIT_RE)
  if (lines.length === 0 || lines[0].trim() === '') {
    return `${relPath}: перший рядок порожній — потрібен # yaml-language-server: $schema=… (abie.mdc)`
  }
  const m = lines[0].match(MODELINE_RE)
  if (!m) return `${relPath}: перший рядок має бути modeline $schema (abie.mdc)`
  if (m[1] !== ABIE_HC_SCHEMA_URL) return `${relPath}: $schema має бути\n     ${ABIE_HC_SCHEMA_URL}\n     (abie.mdc)`

  const yamlBody = lines.slice(1).join('\n').replace(LEADING_EMPTY_LINE_RE, '')
  /** @type {import('yaml').Document[]} */
  let docs
  try {
    docs = parseAllDocuments(yamlBody)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return `${relPath}: не вдалося розібрати YAML (${msg})`
  }
  const result = findHealthCheckPolicyInDocs(docs, relPath)
  if ('error' in result) return result.error
  if (!result.policy) return `${relPath}: очікується документ kind: HealthCheckPolicy (abie.mdc)`
  return validateAbieHcPolicy(result.policy, relPath)
}

/**
 * Збирає відносний шлях із документів, що містять HealthCheckPolicy.
 * @param {import('yaml').Document[]} docs документи з файлу
 * @param {string} rel відносний шлях файлу
 * @param {string[]} out масив для запису шляхів
 */
function collectHealthCheckPolicyRelFromDocs(docs, rel, out) {
  for (const doc of docs) {
    if (doc.errors.length === 0) {
      const obj = doc.toJSON()
      if (obj !== null && typeof obj === 'object' && !Array.isArray(obj)) {
        const rec = /** @type {Record<string, unknown>} */ (obj)
        if (rec.kind === 'HealthCheckPolicy' && !out.includes(rel)) {
          out.push(rel)
        }
      }
    }
  }
}

/**
 * Збирає відносні шляхи файлів із **HealthCheckPolicy** у дереві k8s.
 * @param {string} root корінь
 * @param {string[]} yamlAbs абсолютні шляхи
 * @returns {Promise<string[]>} унікальні відносні шляхи yaml із **HealthCheckPolicy**
 */
async function collectHealthCheckPolicyRelPaths(root, yamlAbs) {
  /** @type {string[]} */
  const out = []
  for (const abs of yamlAbs) {
    const rel = relative(root, abs).replaceAll('\\', '/') || abs
    const docs = await readAndParseYamlDocs(abs, rel, silentFail)
    if (docs) collectHealthCheckPolicyRelFromDocs(docs, rel, out)
  }
  return out
}

/**
 * Якщо є **HealthCheckPolicy**, вимагає **ru/kustomization.yaml** з patch видалення (**ruKustomizationHasHealthCheckDeletePatch** у **check-k8s**).
 * @param {string} root корінь
 * @param {string[]} yamlFilesAbs абсолютні шляхи yaml k8s
 * @param {string[]} healthCheckPolicyRelativePaths відносні шляхи
 * @param {(msg: string) => void} fail callback
 * @returns {Promise<void>}
 */
async function ensureRuKustomizationHealthCheckDelete(root, yamlFilesAbs, healthCheckPolicyRelativePaths, fail) {
  if (healthCheckPolicyRelativePaths.length === 0) {
    return
  }
  const ruAbsList = yamlFilesAbs.filter(abs => isRuKustomizationPath(relative(root, abs).replaceAll('\\', '/') || abs))
  if (ruAbsList.length === 0) {
    fail(
      `Знайдено HealthCheckPolicy у ${healthCheckPolicyRelativePaths.join(', ')} — додай ru/kustomization.yaml з patch видалення (abie.mdc)`
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
    'Є HealthCheckPolicy, але жоден ru/kustomization.yaml не містить очікуваного patch видалення (kind: HealthCheckPolicy, metadata.name, $patch: delete) — abie.mdc'
  )
}

/**
 * Перевіряє одну kustomization.yaml на nodeSelector patch для заданого overlay.
 * @param {string} abs абсолютний шлях до файлу
 * @param {string} rel відносний шлях (для повідомлень)
 * @param {'ua' | 'ru'} mode параметр mode
 * @param {Set<string>} deploymentDirs директорії з Deployment (Set)
 * @param {string} root корінь репозиторію
 * @param {(msg: string) => void} fail callback при помилці
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @returns {Promise<boolean>} false якщо виявлено помилку і слід зупинитись
 */
async function checkNodeSelectorKustomization(abs, rel, mode, deploymentDirs, root, fail, passFn) {
  if (!abieOverlayK8sTreeHasDeployment(deploymentDirs, root, abs)) {
    passFn(`${rel}: nodeSelector patch (${mode}) не застосовується — немає Deployment у дереві k8s цього пакета (abie)`)
    return true
  }
  let raw
  try {
    raw = await readFile(abs, 'utf8')
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    fail(`${rel}: не вдалося прочитати (${msg})`)
    return false
  }
  if (!kustomizationHasAbieDeploymentNodeSelectorPatch(raw, mode)) {
    const detail = mode === 'ua' ? 'preem: false' : 'yandex.cloud/preemptible: false'
    fail(`${rel}: потрібен patch target kind Deployment: path /spec/template/spec/nodeSelector та ${detail} (abie.mdc)`)
    return false
  }
  passFn(`${rel}: nodeSelector patch (${mode}) відповідає abie.mdc`)
  return true
}

/**
 * Перевіряє наявність патчів nodeSelector для ua/ru overlay у k8s.
 * @param {string} root корінь репозиторію
 * @param {string[]} yamlFilesAbs абсолютні шляхи yaml-файлів під k8s
 * @param {Set<string>} deploymentDirs директорії з Deployment (Set)
 * @param {(msg: string) => void} fail callback при помилці
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 */
async function ensureUaRuAbieNodeSelectorPatches(root, yamlFilesAbs, deploymentDirs, fail, passFn) {
  const uaAbsList = yamlFilesAbs.filter(abs => isUaKustomizationPath(relative(root, abs).replaceAll('\\', '/') || abs))
  if (uaAbsList.length === 0) {
    fail(
      'Є Deployment у k8s — додай ua/kustomization.yaml з patch на Deployment: path /spec/template/spec/nodeSelector, preem false (abie.mdc)'
    )
    return
  }
  for (const abs of uaAbsList) {
    const rel = relative(root, abs).replaceAll('\\', '/') || abs
    const ok = await checkNodeSelectorKustomization(abs, rel, 'ua', deploymentDirs, root, fail, passFn)
    if (!ok) return
  }

  const ruAbsList = yamlFilesAbs.filter(abs => isRuKustomizationPath(relative(root, abs).replaceAll('\\', '/') || abs))
  if (ruAbsList.length === 0) {
    fail(
      'Є Deployment у k8s — додай ru/kustomization.yaml з patch на Deployment: path /spec/template/spec/nodeSelector, yandex.cloud/preemptible false (abie.mdc)'
    )
    return
  }
  for (const abs of ruAbsList) {
    const rel = relative(root, abs).replaceAll('\\', '/') || abs
    const ok = await checkNodeSelectorKustomization(abs, rel, 'ru', deploymentDirs, root, fail, passFn)
    if (!ok) return
  }
}

/**
 * Перевіряє HTTPRoute patch для одного overlay (ua/ru).
 * @param {string} abs абсолютний шлях до kustomization.yaml
 * @param {string} rel відносний шлях (для повідомлень)
 * @param {'ua' | 'ru'} mode overlay
 * @param {string} root корінь репозиторію
 * @param {string[]} yamlFilesAbs абсолютні шляхи yaml-файлів під k8s
 * @param {Map<string, Promise<{ refCount: number, baseErrors: string[] }>>} cache кеш аналізу shared backend refs
 * @param {(msg: string) => void} fail callback при помилці
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @returns {Promise<boolean>} false якщо виявлено помилку і слід зупинитись
 */
async function checkHttpRouteKustomization(abs, rel, mode, root, yamlFilesAbs, cache, fail, passFn) {
  if (!abieOverlayRequiresHttpRouteByVite(root, abs)) {
    passFn(`${rel}: HTTPRoute patch (${mode}) не застосовується — немає vite.config.{js,mjs,ts} у пакеті (abie)`)
    return true
  }
  const pkgAbs = abiePackageDirFromK8sOverlay(root, abs)
  if (!pkgAbs) {
    fail(`${rel}: внутрішня помилка abie overlay (немає каталогу пакета)`)
    return false
  }
  let p = cache.get(pkgAbs)
  if (!p) {
    p = analyzeAbieSharedBackendRefsInPackageK8s(root, pkgAbs, yamlFilesAbs)
    cache.set(pkgAbs, p)
  }
  const sharedAnalysis = await p
  for (const err of sharedAnalysis.baseErrors) {
    fail(err)
    return false
  }
  let raw
  try {
    raw = await readFile(abs, 'utf8')
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    fail(`${rel}: не вдалося прочитати (${msg})`)
    return false
  }
  const combined = getCombinedNginxRunPatchTextFromKustomization(raw)
  const v = validateAbieNginxRunHttpRoutePatches(combined, mode, raw, sharedAnalysis.refCount)
  if (v !== null) {
    fail(`${rel}: ${v}`)
    return false
  }
  passFn(`${rel}: HTTPRoute patch (${mode}) відповідає abie.mdc`)
  return true
}

/**
 * @param {unknown} json YAML-документ
 * @returns {boolean} true, якщо HTTPRoute має непорожні spec.hostnames
 */
function httpRouteHasNonEmptyHostnames(json) {
  if (json === null || typeof json !== 'object' || Array.isArray(json)) return false
  const rec = /** @type {Record<string, unknown>} */ (json)
  if (rec.kind !== 'HTTPRoute') return false
  const spec = rec.spec
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) return false
  const hostnames = /** @type {Record<string, unknown>} */ (spec).hostnames
  return collectAbieHostnames(hostnames).length > 0
}

/**
 * @param {import('yaml').Document} doc YAML-документ з файлу
 * @param {string} rel відносний шлях для повідомлень
 * @param {(msg: string) => void} fail callback при помилці
 * @returns {{ hasErrors: boolean, hasHostnames: boolean }} результат обробки документа
 */
function processBaseHttpRouteDoc(doc, rel, fail) {
  if (doc.errors.length !== 0) return { hasErrors: false, hasHostnames: false }
  const json = doc.toJSON()
  const errs = abieBaseHttpRouteHostnamesErrors(json, rel)
  if (errs.length > 0) {
    for (const e of errs) fail(e)
    return { hasErrors: true, hasHostnames: false }
  }
  return { hasErrors: false, hasHostnames: httpRouteHasNonEmptyHostnames(json) }
}

/**
 * Для кожного **HTTPRoute** у **`…/k8s/base/…`** з непорожніми **`spec.hostnames`** — лише **aiml.live** та піддомени (abie.mdc).
 * @param {string} root корінь репозиторію
 * @param {string[]} yamlFilesAbs yaml під k8s
 * @param {(msg: string) => void} fail callback при помилці
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @returns {Promise<void>}
 */
async function ensureAbieBaseHttpRouteHostnames(root, yamlFilesAbs, fail, passFn) {
  let baseHttpRoutesWithHostnames = 0
  const baseFiles = yamlFilesAbs.filter(abs => isAbieK8sBaseYamlPath(relative(root, abs).replaceAll('\\', '/') || abs))
  for (const abs of baseFiles) {
    const rel = relative(root, abs).replaceAll('\\', '/') || abs
    const docs = await readAndParseYamlDocs(abs, rel, fail)
    if (!docs) return
    for (const doc of docs) {
      const { hasErrors, hasHostnames } = processBaseHttpRouteDoc(doc, rel, fail)
      if (hasErrors) return
      if (hasHostnames) baseHttpRoutesWithHostnames++
    }
  }
  if (baseHttpRoutesWithHostnames > 0) {
    passFn(
      `HTTPRoute у …/k8s/base/…: spec.hostnames відповідають ${ABIE_BASE_DEV_HTTPROUTE_HOST_ROOT} та піддоменам (abie.mdc)`
    )
  } else {
    passFn('Немає HTTPRoute у …/k8s/base/… з непорожніми spec.hostnames — перевірку aiml.live пропущено')
  }
}

/**
 * Якщо є **Deployment** під **k8s**, вимагає в overlay **ua** та **ru** patch **HTTPRoute** (непорожній **target.name**) за abie.mdc
 * лише для пакетів з **vite.config.{js,mjs,ts}** у каталозі пакета (батько **k8s**).
 * @param {string} root корінь репозиторію
 * @param {string[]} yamlFilesAbs yaml під k8s
 * @param {(msg: string) => void} fail callback при помилці
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 */
async function ensureUaRuAbieHttpRoutePatches(root, yamlFilesAbs, fail, passFn) {
  /** @type {Map<string, Promise<{ refCount: number, baseErrors: string[] }>>} */
  const cache = new Map()

  const uaAbsList = yamlFilesAbs.filter(abs => isUaKustomizationPath(relative(root, abs).replaceAll('\\', '/') || abs))
  if (uaAbsList.length === 0) {
    passFn(
      'Немає ua/kustomization.yaml у дереві k8s — patch HTTPRoute (ua) не вимагається (abie.mdc, лише Vite-пакети)'
    )
  }
  for (const abs of uaAbsList) {
    const rel = relative(root, abs).replaceAll('\\', '/') || abs
    const ok = await checkHttpRouteKustomization(abs, rel, 'ua', root, yamlFilesAbs, cache, fail, passFn)
    if (!ok) return
  }

  const ruAbsList = yamlFilesAbs.filter(abs => isRuKustomizationPath(relative(root, abs).replaceAll('\\', '/') || abs))
  if (ruAbsList.length === 0) {
    passFn(
      'Немає ru/kustomization.yaml у дереві k8s — patch HTTPRoute (ru) не вимагається (abie.mdc, лише Vite-пакети)'
    )
  }
  for (const abs of ruAbsList) {
    const rel = relative(root, abs).replaceAll('\\', '/') || abs
    const ok = await checkHttpRouteKustomization(abs, rel, 'ru', root, yamlFilesAbs, cache, fail, passFn)
    if (!ok) return
  }
}

/**
 * Перевіряє відсутність артефактів Firebase Hosting у **кожному** **підкаталозі першого рівня** від кореня
 * (не в самому корені репозиторію) — abie.mdc. Каталоги **`.git`** і **`node_modules`** у скануванні пропускаються.
 * @param {string} root корінь репозиторію
 * @param {(msg: string) => void} passFn успішне повідомлення
 * @param {(msg: string) => void} failFn повідомлення про порушення
 * @returns {Promise<void>}
 */
async function ensureNoFirebaseHostingArtifacts(root, passFn, failFn) {
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    failFn(`Не вдалося прочитати ${root} для перевірки Firebase Hosting: ${msg} (abie.mdc)`)
    return
  }
  const topDirs = entries.filter(e => e.isDirectory() && !ABIE_FIREBASE_HOSTING_SCAN_SKIP_TOP_DIR_NAMES.has(e.name))
  let hasViolation = false
  for (const e of topDirs) {
    for (const name of ['.firebaserc', 'firebase.json']) {
      const rel = join(e.name, name).replaceAll('\\', '/')
      if (existsSync(join(root, e.name, name))) {
        failFn(`Знайдено заборонений файл Firebase Hosting: ${rel} — видали його (abie.mdc)`)
        hasViolation = true
      }
    }
    if (existsSync(join(root, e.name, '.firebase'))) {
      failFn(`Знайдено заборонену директорію: ${e.name}/.firebase/ — видали її (abie.mdc)`)
      hasViolation = true
    }
  }
  if (hasViolation) {
    return
  }
  passFn('Підкаталоги кореня (1-й рівень, без .git/node_modules): артефактів Firebase Hosting не знайдено (abie.mdc)')
}

/**
 * Перевіряє clean-merged-branch.yml на ignore_branches.
 * @param {string} root корінь репозиторію
 * @param {(msg: string) => void} pass callback при успішній перевірці
 * @param {(msg: string) => void} fail callback при помилці
 */
async function checkCleanMergedBranch(root, pass, fail) {
  const cleanMergedPath = join(root, '.github/workflows/clean-merged-branch.yml')
  if (!existsSync(cleanMergedPath)) {
    fail(`Відсутній ${cleanMergedPath} — потрібен для ignore_branches (abie.mdc)`)
    return
  }
  let wfRaw
  try {
    wfRaw = await readFile(cleanMergedPath, 'utf8')
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    fail(`Не вдалося прочитати clean-merged-branch.yml (${msg})`)
    return
  }
  const ib = parseCleanMergedIgnoreBranches(wfRaw)
  if (ib === null || ib.trim() === '') {
    fail(
      'clean-merged-branch.yml: не знайдено with.ignore_branches у кроці phpdocker-io/github-actions-delete-abandoned-branches (abie.mdc)'
    )
  } else if (ignoreBranchesIncludesRequired(ib, ABIE_REQUIRED_IGNORE_BRANCHES)) {
    pass('clean-merged-branch.yml: ignore_branches містить dev, ua, ru')
  } else {
    fail(`clean-merged-branch.yml: ignore_branches має містити dev, ua та ru (зараз: ${JSON.stringify(ib)}) — abie.mdc`)
  }
}

/**
 * Перевіряє один файл hc.yaml на відповідність abie.mdc.
 * @param {string} root корінь репозиторію
 * @param {string} dir директорія з Deployment
 * @param {(msg: string) => void} pass callback при успішній перевірці
 * @param {(msg: string) => void} fail callback при помилці
 */
async function checkHcYamlFile(root, dir, pass, fail) {
  const hcAbs = join(dir, 'hc.yaml')
  const relHc = relative(root, hcAbs).replaceAll('\\', '/') || 'hc.yaml'
  if (!existsSync(hcAbs)) {
    fail(`${relative(root, dir) || dir}: є Deployment, але немає hc.yaml поруч — додай HealthCheckPolicy (abie.mdc)`)
    return
  }
  let hcRaw
  try {
    hcRaw = await readFile(hcAbs, 'utf8')
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    fail(`${relHc}: не вдалося прочитати (${msg})`)
    return
  }
  const v = validateAbieHcYaml(hcRaw, relHc)
  if (v === null) {
    pass(`${relHc}: відповідає abie.mdc`)
  } else {
    fail(v)
  }
}

/**
 * Перевіряє hc.yaml у директоріях з Deployment.
 * @param {string} root корінь репозиторію
 * @param {Set<string>} deploymentDirs директорії з Deployment (Set)
 * @param {(msg: string) => void} pass callback при успішній перевірці
 * @param {(msg: string) => void} fail callback при помилці
 */
async function checkHcYamlFiles(root, deploymentDirs, pass, fail) {
  for (const dir of [...deploymentDirs].toSorted((a, b) => a.localeCompare(b))) {
    await checkHcYamlFile(root, dir, pass, fail)
  }
}

/**
 * Чи Deployment-документ містить контейнер із образом **`hasura/graphql-engine`** (abie.mdc nginx-sidecar).
 * @param {unknown} obj корінь YAML-документа
 * @returns {boolean} true якщо документ є Deployment із hasura/graphql-engine
 */
function deploymentDocHasHasuraImage(obj) {
  if (!isDeploymentDoc(obj)) return false
  const rec = /** @type {Record<string, unknown>} */ (obj)
  const spec = rec.spec
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) return false
  const template = /** @type {Record<string, unknown>} */ (spec).template
  if (template === null || typeof template !== 'object' || Array.isArray(template)) return false
  const podSpec = /** @type {Record<string, unknown>} */ (template).spec
  if (podSpec === null || typeof podSpec !== 'object' || Array.isArray(podSpec)) return false
  const containers = /** @type {Record<string, unknown>} */ (podSpec).containers
  if (!Array.isArray(containers)) return false
  for (const c of containers) {
    if (c !== null && typeof c === 'object' && !Array.isArray(c)) {
      const img = /** @type {Record<string, unknown>} */ (c).image
      if (typeof img === 'string' && img.includes(HASURA_IMAGE_MARKER)) return true
    }
  }
  return false
}

/**
 * Чи Kustomization-документ містить у **`images[*].newName`** рядок **`hasura/graphql-engine`** (abie.mdc nginx-sidecar).
 * @param {unknown} obj корінь YAML-документа
 * @returns {boolean} true якщо є images[*].newName із hasura/graphql-engine
 */
function kustomizationDocHasHasuraImageNewName(obj) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return false
  const rec = /** @type {Record<string, unknown>} */ (obj)
  if (!Array.isArray(rec.images)) return false
  for (const img of rec.images) {
    if (img !== null && typeof img === 'object' && !Array.isArray(img)) {
      const newName = /** @type {Record<string, unknown>} */ (img).newName
      if (typeof newName === 'string' && newName.includes(HASURA_IMAGE_MARKER)) return true
    }
  }
  return false
}

/**
 * Чи patch-запис у Kustomization має **target.kind === 'Deployment'**.
 * @param {unknown} patchEntry елемент масиву **patches**
 * @returns {boolean} true, якщо patch цілить на Deployment
 */
function isPatchTargetingDeployment(patchEntry) {
  if (patchEntry === null || typeof patchEntry !== 'object' || Array.isArray(patchEntry)) return false
  const pr = /** @type {Record<string, unknown>} */ (patchEntry)
  const target = pr.target
  if (target === null || typeof target !== 'object' || Array.isArray(target)) return false
  return /** @type {Record<string, unknown>} */ (target).kind === 'Deployment'
}

/**
 * Витягує текст **patch** із запису Kustomization, якщо він непорожній рядок.
 * @param {unknown} patchEntry елемент масиву **patches**
 * @returns {string | null} текст patch або null
 */
function extractPatchString(patchEntry) {
  const pr = /** @type {Record<string, unknown>} */ (patchEntry)
  const patchStr = pr.patch
  if (typeof patchStr === 'string' && patchStr.trim() !== '') return patchStr
  return null
}

/**
 * Збирає тексти inline **patch** для **Deployment** з одного YAML-документа Kustomization.
 * @param {import('yaml').Document} doc YAML-документ
 * @param {string[]} out масив для збору результатів
 */
function collectDeploymentPatchTextsFromDoc(doc, out) {
  if (doc.errors.length > 0) return
  const root = doc.toJSON()
  if (root === null || typeof root !== 'object' || Array.isArray(root)) return
  const rec = /** @type {Record<string, unknown>} */ (root)
  if (!Array.isArray(rec.patches)) return
  for (const p of rec.patches) {
    if (isPatchTargetingDeployment(p)) {
      const text = extractPatchString(p)
      if (text !== null) out.push(text)
    }
  }
}

/**
 * Збирає тексти inline **patch** для **Deployment** з **kustomization.yaml** (усі документи).
 * @param {string} raw повний текст файлу
 * @returns {string[]} рядки patch
 */
function collectDeploymentPatchTextsFromKustomization(raw) {
  const body = stripBom(raw)
  const lines = body.split(LINE_SPLIT_RE)
  const first = lines[0] ?? ''
  const rest = MODELINE_RE.test(first.trim()) ? lines.slice(1).join('\n') : body
  /** @type {import('yaml').Document[]} */
  let docs
  try {
    docs = parseAllDocuments(rest)
  } catch {
    return []
  }
  /** @type {string[]} */
  const out = []
  for (const doc of docs) {
    collectDeploymentPatchTextsFromDoc(doc, out)
  }
  return out
}

/**
 * Чи YAML-документ містить образ Hasura (Deployment або Kustomization images).
 * @param {import('yaml').Document} doc YAML-документ
 * @returns {boolean} true, якщо документ посилається на hasura/graphql-engine
 */
function yamlDocReferencesHasuraImage(doc) {
  if (doc.errors.length > 0) return false
  const obj = doc.toJSON()
  return deploymentDocHasHasuraImage(obj) || kustomizationDocHasHasuraImageNewName(obj)
}

/**
 * Каталоги пакетів, де в дереві **k8s** є **Deployment** з образом **`hasura/graphql-engine`** або
 * **Kustomization** з **`images[*].newName`** на нього (abie.mdc nginx-sidecar).
 * @param {string} root корінь репозиторію
 * @param {string[]} yamlAbs абсолютні шляхи yaml під k8s
 * @returns {Promise<Set<string>>} абсолютні шляхи каталогів пакетів
 */
async function collectHasuraK8sPackageDirs(root, yamlAbs) {
  /** @type {Set<string>} */
  const dirs = new Set()
  for (const abs of yamlAbs) {
    const rel = relative(root, abs).replaceAll('\\', '/') || abs
    const docs = await readAndParseYamlDocs(abs, rel, silentFail)
    if (docs && docs.some(doc => yamlDocReferencesHasuraImage(doc))) {
      const pkgDir = abiePackageDirFromK8sYamlRel(root, rel)
      if (pkgDir) dirs.add(pkgDir)
    }
  }
  return dirs
}

/**
 * Якщо в дереві **k8s** є Deployment з **`hasura/graphql-engine`** і **`ru/kustomization.yaml`** містить
 * **`HASURA_GRAPHQL_JWT_SECRET`** — вимагає **nginx-sidecar** (abie.mdc):
 * **`ru/configmap-nginx.yaml`**, **`resources`** у kustomization, patch **Service -hl** (port 8081),
 * patch **Deployment** (nginx-sidecar image + containerPort 8081), patch **HTTPRoute** (port 8081).
 * @param {string} root корінь репозиторію
 * @param {string[]} yamlFilesAbs yaml під k8s
 * @param {(msg: string) => void} fail callback при помилці
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @returns {Promise<void>}
 */
/**
 * Перевіряє nginx-sidecar вимоги у **ru/kustomization.yaml** для одного Hasura-пакета.
 * @param {string} relPkg відносний шлях пакета
 * @param {string} relRu відносний шлях до ru/kustomization.yaml
 * @param {string} pkgAbs абсолютний шлях до пакета
 * @param {string} ruRaw вміст ru/kustomization.yaml
 * @param {(msg: string) => void} fail callback при помилці
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 */
function validateNginxSidecarInRuKustomization(relPkg, relRu, pkgAbs, ruRaw, fail, passFn) {
  // configmap-nginx.yaml must exist
  const configmapNginxAbs = join(pkgAbs, 'k8s', 'ru', 'configmap-nginx.yaml')
  if (!existsSync(configmapNginxAbs)) {
    fail(`${relPkg}/k8s/ru: потрібен configmap-nginx.yaml з nginx.conf (nginx-sidecar для Hasura WebSocket, abie.mdc)`)
    return
  }
  passFn(`${relPkg}/k8s/ru/configmap-nginx.yaml: існує`)
  // kustomization resources must include configmap-nginx.yaml
  if (!RESOURCES_CONFIGMAP_NGINX_RE.test(ruRaw)) {
    fail(`${relRu}: у resources потрібен configmap-nginx.yaml (nginx-sidecar, abie.mdc)`)
    return
  }
  passFn(`${relRu}: resources містить configmap-nginx.yaml`)
  validateNginxSidecarPatches(relRu, ruRaw, fail, passFn)
}

/**
 * Перевіряє наявність nginx-sidecar patch (Service -hl, Deployment, HTTPRoute) у **ru/kustomization.yaml**.
 * @param {string} relRu відносний шлях до ru/kustomization.yaml
 * @param {string} ruRaw вміст ru/kustomization.yaml
 * @param {(msg: string) => void} fail callback при помилці
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 */
function validateNginxSidecarPatches(relRu, ruRaw, fail, passFn) {
  // Service -hl patch must include port: 8081 (proxy)
  const svcPatchByName = collectAbieRuServicePatchTextByTargetNameFromRaw(ruRaw)
  const hasHlWith8081 = [...svcPatchByName.entries()].some(
    ([name, pt]) => name.endsWith('-hl') && PATCH_PROXY_PORT_8081_RE.test(pt)
  )
  if (!hasHlWith8081) {
    fail(`${relRu}: у patch Service -hl потрібен port: 8081 (proxy) для nginx-sidecar (abie.mdc)`)
    return
  }
  passFn(`${relRu}: Service -hl patch містить port 8081 (nginx-sidecar)`)
  // Deployment patch must include nginx-sidecar (image nginx:*-alpine + containerPort: 8081)
  const deployPatches = collectDeploymentPatchTextsFromKustomization(ruRaw)
  const hasNginxSidecar = deployPatches.some(
    pt => NGINX_SIDECAR_IMAGE_RE.test(pt) && NGINX_SIDECAR_CONTAINER_PORT_RE.test(pt)
  )
  if (!hasNginxSidecar) {
    fail(`${relRu}: у patch Deployment потрібен nginx-sidecar (image nginx:…-alpine, containerPort: 8081) — abie.mdc`)
    return
  }
  passFn(`${relRu}: Deployment patch містить nginx-sidecar (image + containerPort 8081)`)
  // HTTPRoute patch must replace a backendRef port to 8081
  const combined = getCombinedNginxRunPatchTextFromKustomization(ruRaw)
  if (
    !HTTPROUTE_BACKENDREF_PORT_8081_RE.test(combined) &&
    !HTTPROUTE_BACKENDREF_PORT_8081_VALUE_FIRST_RE.test(combined)
  ) {
    fail(
      `${relRu}: у patch HTTPRoute потрібен JSON6902 з path /spec/rules/…/backendRefs/…/port та value: 8081 (nginx-sidecar, abie.mdc)`
    )
    return
  }
  passFn(`${relRu}: HTTPRoute patch замінює порт на 8081 (nginx-sidecar)`)
}

/**
 * Обробляє один Hasura-пакет: читає **ru/kustomization.yaml** та перевіряє nginx-sidecar вимоги.
 * @param {string} root корінь репозиторію
 * @param {string} pkgAbs абсолютний шлях до пакета
 * @param {(msg: string) => void} fail callback при помилці
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @returns {Promise<void>}
 */
async function checkNginxSidecarForHasuraPackage(root, pkgAbs, fail, passFn) {
  const relPkg = relative(root, pkgAbs).replaceAll('\\', '/') || pkgAbs
  const ruAbs = join(pkgAbs, 'k8s', 'ru', 'kustomization.yaml')
  if (!existsSync(ruAbs)) {
    passFn(`${relPkg}/k8s: є Hasura Deployment, але немає ru/kustomization.yaml — nginx-sidecar не перевіряється`)
    return
  }
  let ruRaw
  try {
    ruRaw = await readFile(ruAbs, 'utf8')
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    fail(`${relPkg}/k8s/ru/kustomization.yaml: не вдалося прочитати (${msg})`)
    return
  }
  if (!ruRaw.includes(HASURA_JWT_SECRET_IN_KUSTOMIZATION)) {
    passFn(
      `${relPkg}/k8s/ru/kustomization.yaml: немає ${HASURA_JWT_SECRET_IN_KUSTOMIZATION} — nginx-sidecar не вимагається (abie.mdc)`
    )
    return
  }
  const relRu = relative(root, ruAbs).replaceAll('\\', '/') || ruAbs
  validateNginxSidecarInRuKustomization(relPkg, relRu, pkgAbs, ruRaw, fail, passFn)
}

/**
 * Якщо в дереві **k8s** є Deployment з **`hasura/graphql-engine`** і **`ru/kustomization.yaml`** містить
 * **`HASURA_GRAPHQL_JWT_SECRET`** — вимагає **nginx-sidecar** (abie.mdc):
 * **`ru/configmap-nginx.yaml`**, **`resources`** у kustomization, patch **Service -hl** (port 8081),
 * patch **Deployment** (nginx-sidecar image + containerPort 8081), patch **HTTPRoute** (port 8081).
 * @param {string} root корінь репозиторію
 * @param {string[]} yamlFilesAbs yaml під k8s
 * @param {(msg: string) => void} fail callback при помилці
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @returns {Promise<void>}
 */
async function ensureAbieNginxSidecarForHasura(root, yamlFilesAbs, fail, passFn) {
  const hasuraPkgDirs = await collectHasuraK8sPackageDirs(root, yamlFilesAbs)
  if (hasuraPkgDirs.size === 0) {
    passFn('Немає Deployment із hasura/graphql-engine у дереві k8s — nginx-sidecar не вимагається (abie.mdc)')
    return
  }
  for (const pkgAbs of [...hasuraPkgDirs].toSorted((a, b) => a.localeCompare(b))) {
    await checkNginxSidecarForHasuraPackage(root, pkgAbs, fail, passFn)
  }
}

/**
 * Перевіряє відповідність проєкту правилам abie.mdc.
 * @returns {Promise<number>} 0 — все OK, 1 — є проблеми
 */
export async function check() {
  const reporter = createCheckReporter()
  const { pass, fail } = reporter

  const root = process.cwd()
  const enabled = await isAbieRuleEnabled(root)
  if (!enabled) {
    pass(`Правило abie не увімкнено в ${CONFIG_FILE} (rules) — перевірку пропущено`)
    return reporter.getExitCode()
  }

  pass('Правило abie увімкнено — виконуємо перевірки')
  await ensureNoFirebaseHostingArtifacts(root, pass, fail)
  await checkCleanMergedBranch(root, pass, fail)

  const ignorePaths = await loadCursorIgnorePaths(root)
  const yamlFiles = await findK8sYamlFiles(root, ignorePaths)
  const deploymentDirs = await collectDeploymentDirs(root, yamlFiles, fail)

  if (deploymentDirs.size > 0) {
    pass(`Знайдено Deployment у ${deploymentDirs.size} директорія(ї/й) k8s — перевіряємо hc.yaml`)
    await checkHcYamlFiles(root, deploymentDirs, pass, fail)
    pass('Є Deployment — перевіряємо base: spec.template.spec.nodeSelector.preem (abie.mdc)')
    await ensureAbieBaseDeploymentPreemNodeSelector(root, yamlFiles, fail, pass)
  } else {
    pass('Немає Deployment у дереві k8s — перевірку hc.yaml пропущено')
  }

  const healthCheckPolicyRelativePaths = await collectHealthCheckPolicyRelPaths(root, yamlFiles)
  await ensureRuKustomizationHealthCheckDelete(root, yamlFiles, healthCheckPolicyRelativePaths, fail)

  pass('Перевіряємо Service → NodePort у ru/kustomization (abie.mdc)')
  await ensureRuAbieServiceNodePortPatches(root, yamlFiles, fail, pass)

  pass('Перевіряємо HTTPRoute spec.hostnames у …/k8s/base/… (aiml.live, abie.mdc)')
  await ensureAbieBaseHttpRouteHostnames(root, yamlFiles, fail, pass)

  if (deploymentDirs.size > 0) {
    pass('Є Deployment — перевіряємо nodeSelector у ua/ru kustomization (abie.mdc)')
    await ensureUaRuAbieNodeSelectorPatches(root, yamlFiles, deploymentDirs, fail, pass)
    pass('Є Deployment — перевіряємо HTTPRoute у ua/ru kustomization (abie.mdc)')
    await ensureUaRuAbieHttpRoutePatches(root, yamlFiles, fail, pass)
  }

  pass('Перевіряємо nginx-sidecar для Hasura WebSocket у ru (abie.mdc)')
  await ensureAbieNginxSidecarForHasura(root, yamlFiles, fail, pass)

  return reporter.getExitCode()
}

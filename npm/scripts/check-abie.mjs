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
 * **Firebase Hosting:** у корені репозиторію не має бути **`.firebaserc`**, **`firebase.json`** та каталогу **`.firebase/`**.
 *
 * **k8s:** якщо під деревом із сегментом **`k8s`** є YAML з **`kind: Deployment`**, у тій самій директорії
 * має існувати **`hc.yaml`** із **`HealthCheckPolicy`** (**`networking.gke.io/v1`**), modeline **`$schema`**
 * як у abie.mdc, **`/healthz`**, порт **8080**, **`targetRef`** на **Service** з тим самим **`metadata.name`**.
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
 * Вибір **`op`** — **k8s.mdc**.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'

import { parseAllDocuments } from 'yaml'

import { pathHasK8sSegment, ruKustomizationHasHealthCheckDeletePatch } from './check-k8s.mjs'
import { createCheckReporter } from './utils/check-reporter.mjs'
import { flattenWorkflowSteps, getStepUses, parseWorkflowYaml } from './utils/gha-workflow.mjs'
import { walkDir } from './utils/walkDir.mjs'

const CONFIG_FILE = '.n-cursor.json'

/** Маркер у kustomization.yaml: якщо зустрічається у файлі — для overlay ru у patch HTTPRoute потрібна анотація gwin…websocket. */
const HASURA_JWT_SECRET_IN_KUSTOMIZATION = 'HASURA_GRAPHQL_JWT_SECRET'

/** Очікуваний URL **`$schema`** для **hc.yaml** (abie.mdc). */
export const ABIE_HC_SCHEMA_URL = 'https://datreeio.github.io/CRDs-catalog/networking.gke.io/healthcheckpolicy_v1.json'

const MODELINE_RE = /^#\s*yaml-language-server:\s*\$schema=(\S+)\s*$/

/** Гілки, які мають бути в **`ignore_branches`** за abie.mdc. */
export const ABIE_REQUIRED_IGNORE_BRANCHES = ['dev', 'ua', 'ru']

/**
 * Чи відносний шлях вказує на **`ru/kustomization.yaml`** (сегмент **`ru`** перед ім’ям файлу) — специфіка abie overlay.
 * @param {string} rel шлях від кореня репозиторію
 * @returns {boolean} true, якщо це `…/ru/kustomization.yaml`
 */
export function isRuKustomizationPath(rel) {
  const norm = rel.replaceAll('\\', '/')
  return /(^|\/)ru\/kustomization\.yaml$/u.test(norm)
}

/**
 * Чи відносний шлях вказує на **`ua/kustomization.yaml`** (сегмент **`ua`** перед ім’ям файлу) — специфіка abie overlay.
 * @param {string} rel шлях від кореня репозиторію
 * @returns {boolean} true, якщо це `…/ua/kustomization.yaml`
 */
export function isUaKustomizationPath(rel) {
  const norm = rel.replaceAll('\\', '/')
  return /(^|\/)ua\/kustomization\.yaml$/u.test(norm)
}

/**
 * Каталог пакета: шлях перед сегментом **`/k8s/`** для overlay **`…/k8s/(ua|ru)/kustomization.yaml`**.
 * @param {string} root корінь репозиторію
 * @param {string} kustomizationAbs абсолютний шлях до **ua** або **ru** kustomization.yaml
 * @returns {string | null} абсолютний шлях до каталогу пакета або null, якщо шлях не overlay ua чи ru
 */
export function abiePackageDirFromK8sOverlay(root, kustomizationAbs) {
  const rel = relative(root, kustomizationAbs).replaceAll('\\', '/') || kustomizationAbs
  const m = rel.match(/^(.+)\/k8s\/(?:ua|ru)\/kustomization\.yaml$/u)
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
  return /(^|\/)base\//u.test(norm)
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
 * @returns {Promise<string[]>} відсортовані шляхи
 */
async function findK8sYamlFiles(root) {
  /** @type {string[]} */
  const out = []
  await walkDir(root, p => {
    if (!pathHasK8sSegment(p)) {
      return
    }
    if (!/\.ya?ml$/iu.test(p)) {
      return
    }
    out.push(p)
  })
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
    let raw
    let readOk = false
    try {
      raw = await readFile(abs, 'utf8')
      readOk = true
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      fail(`${relative(root, abs) || abs}: не вдалося прочитати (${msg})`)
    }
    if (readOk) {
      const body = stripBom(raw)
      const lines = body.split(/\r?\n/u)
      const first = lines[0] ?? ''
      const rest = MODELINE_RE.test(first.trim()) ? lines.slice(1).join('\n') : body
      /** @type {import('yaml').Document[]} */
      let docs
      let parseOk = false
      try {
        docs = parseAllDocuments(rest)
        parseOk = true
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        fail(`${relative(root, abs) || abs}: YAML (${msg})`)
      }
      if (parseOk) {
        for (const doc of docs) {
          if (doc.errors.length === 0) {
            const obj = doc.toJSON()
            if (isDeploymentDoc(obj)) {
              dirs.add(dirname(abs))
            }
          }
        }
      }
    }
  }
  return dirs
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
  const baseFiles = yamlFilesAbs.filter(abs => {
    const rel = relative(root, abs).replaceAll('\\', '/') || abs
    return isAbieK8sBaseYamlPath(rel)
  })
  let anyBaseDeployment = false
  for (const abs of baseFiles) {
    const rel = relative(root, abs).replaceAll('\\', '/') || abs
    let raw
    try {
      raw = await readFile(abs, 'utf8')
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      fail(`${rel}: не вдалося прочитати (${msg})`)
      return
    }
    const body = stripBom(raw)
    const lines = body.split(/\r?\n/u)
    const first = lines[0] ?? ''
    const rest = MODELINE_RE.test(first.trim()) ? lines.slice(1).join('\n') : body
    /** @type {import('yaml').Document[]} */
    let docs
    try {
      docs = parseAllDocuments(rest)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      fail(`${rel}: YAML (${msg})`)
      return
    }
    for (const doc of docs) {
      if (doc.errors.length === 0) {
        const obj = doc.toJSON()
        if (isDeploymentDoc(obj)) {
          anyBaseDeployment = true
          if (!deploymentDocumentHasAbieBasePreemNodeSelector(obj)) {
            fail(
              `${rel}: Deployment у base: потрібен spec.template.spec.nodeSelector.preem: true (або 'true') — abie.mdc`
            )
            return
          }
        }
      }
    }
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
 * Чи рядок inline JSON6902 patch містить очікуваний **ua** nodeSelector (**preem: false** на **`/spec/template/spec/nodeSelector`**).
 * Конкретний **`op`** не перевіряється — див. **k8s.mdc**.
 * @param {string} patchText поле **patch** у kustomization
 * @returns {boolean} true, якщо критерії abie.mdc виконано
 */
function jsonPatchTextHasUaDeploymentNodeSelector(patchText) {
  if (typeof patchText !== 'string' || patchText.trim() === '') {
    return false
  }
  if (!/path:\s*\/spec\/template\/spec\/nodeSelector\b/u.test(patchText)) {
    return false
  }
  if (!/\bpreem:\s*['"]?false['"]?\b/u.test(patchText)) {
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
  if (!/path:\s*\/spec\/template\/spec\/nodeSelector\b/u.test(patchText)) {
    return false
  }
  if (!/yandex\.cloud\/preemptible:\s*['"]?false['"]?/u.test(patchText)) {
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
  const lines = body.split(/\r?\n/u)
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
 * Збирає тексти inline **patch** для **HTTPRoute** (будь-який непорожній **target.name**) з одного документа **Kustomization**.
 * @param {import('yaml').Document} doc документ після **parseAllDocuments**
 * @returns {string[]} непорожні рядки **patch**
 */
function collectAbieHttpRoutePatchStringsFromKustomizationDoc(doc) {
  if (doc.errors.length > 0) {
    return []
  }
  const root = doc.toJSON()
  if (root === null || typeof root !== 'object' || Array.isArray(root)) {
    return []
  }
  const rec = /** @type {Record<string, unknown>} */ (root)
  if (rec.kind !== 'Kustomization') {
    return []
  }
  const patches = rec.patches
  if (!Array.isArray(patches)) {
    return []
  }
  /** @type {string[]} */
  const out = []
  for (const p of patches) {
    if (p !== null && typeof p === 'object' && !Array.isArray(p)) {
      const pr = /** @type {Record<string, unknown>} */ (p)
      const target = pr.target
      if (target !== null && typeof target === 'object' && !Array.isArray(target)) {
        const tg = /** @type {Record<string, unknown>} */ (target)
        if (tg.kind === 'HTTPRoute' && typeof tg.name === 'string' && tg.name.trim() !== '') {
          const patchStr = pr.patch
          if (typeof patchStr === 'string' && patchStr.trim() !== '') {
            out.push(patchStr)
          }
        }
      }
    }
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
  const lines = body.split(/\r?\n/u)
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
 * @returns {string | null} повідомлення про помилку або **null**
 */
export function validateAbieNginxRunHttpRoutePatches(combined, mode, fullKustomizationRaw) {
  if (typeof combined !== 'string' || combined.trim() === '') {
    return `очікується patch target kind HTTPRoute з непорожнім target.name (hostnames, parentRefs namespace ${mode}; для ru — gwin… websocket лише за наявності HASURA_GRAPHQL_JWT_SECRET у файлі) — abie.mdc`
  }
  if (!/path:\s*\/spec\/hostnames\b/m.test(combined)) {
    return 'HTTPRoute: потрібен path /spec/hostnames у patch (abie.mdc)'
  }
  const markers = mode === 'ua' ? ABIE_UA_HTTPROUTE_HOST_MARKERS : ABIE_RU_HTTPROUTE_HOST_MARKERS
  if (!markers.some(m => combined.includes(m))) {
    return `HTTPRoute: у value для /spec/hostnames має бути один із доменів abie (${markers.join(', ')}) — abie.mdc`
  }
  const namespaceOk =
    mode === 'ua'
      ? /path:\s*\/spec\/parentRefs\/0\/namespace\b[\s\S]{0,200}?value:\s*['"]?ua['"]?(?:\s|$)/mu.test(combined)
      : /path:\s*\/spec\/parentRefs\/0\/namespace\b[\s\S]{0,200}?value:\s*['"]?ru['"]?(?:\s|$)/mu.test(combined)
  if (!namespaceOk) {
    return `HTTPRoute: потрібен path /spec/parentRefs/0/namespace з value ${mode} (abie.mdc)`
  }
  const ruNeedsWebsocket =
    mode === 'ru' &&
    typeof fullKustomizationRaw === 'string' &&
    fullKustomizationRaw.includes(HASURA_JWT_SECRET_IN_KUSTOMIZATION)
  if (ruNeedsWebsocket && !/gwin\.yandex\.cloud\/rules\.http\.upgradeTypes:\s*['"]?websocket['"]?/m.test(combined)) {
    return 'HTTPRoute (ru): за наявності HASURA_GRAPHQL_JWT_SECRET у kustomization потрібна анотація gwin.yandex.cloud/rules.http.upgradeTypes: websocket (abie.mdc)'
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
 * Перевіряє **hc.yaml** на відповідність abie.mdc.
 * @param {string} raw повний текст файлу
 * @param {string} relPath відносний шлях для повідомлень
 * @returns {string | null} текст помилки або **null**
 */
export function validateAbieHcYaml(raw, relPath) {
  const body = stripBom(raw)
  const lines = body.split(/\r?\n/u)
  if (lines.length === 0 || lines[0].trim() === '') {
    return `${relPath}: перший рядок порожній — потрібен # yaml-language-server: $schema=… (abie.mdc)`
  }
  const m = lines[0].match(MODELINE_RE)
  if (!m) {
    return `${relPath}: перший рядок має бути modeline $schema (abie.mdc)`
  }
  if (m[1] !== ABIE_HC_SCHEMA_URL) {
    return `${relPath}: $schema має бути\n     ${ABIE_HC_SCHEMA_URL}\n     (abie.mdc)`
  }
  const yamlBody = lines
    .slice(1)
    .join('\n')
    .replace(/^\s*\n/u, '')
  /** @type {import('yaml').Document[]} */
  let docs
  try {
    docs = parseAllDocuments(yamlBody)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return `${relPath}: не вдалося розібрати YAML (${msg})`
  }
  /** @type {Record<string, unknown> | null} */
  let policy = null
  for (const doc of docs) {
    if (doc.errors.length > 0) {
      return `${relPath}: YAML: ${doc.errors.map(e => e.message).join('; ')}`
    }
    const obj = doc.toJSON()
    if (obj !== null && typeof obj === 'object' && !Array.isArray(obj)) {
      const rec = /** @type {Record<string, unknown>} */ (obj)
      if (rec.kind === 'HealthCheckPolicy') {
        policy = rec
        break
      }
    }
  }
  if (!policy) {
    return `${relPath}: очікується документ kind: HealthCheckPolicy (abie.mdc)`
  }
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
  const def = /** @type {Record<string, unknown>} */ (spec).default
  if (def === null || typeof def !== 'object' || Array.isArray(def)) {
    return `${relPath}: відсутній spec.default (abie.mdc)`
  }
  const config = /** @type {Record<string, unknown>} */ (def).config
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    return `${relPath}: відсутній spec.default.config (abie.mdc)`
  }
  if (config.type !== 'HTTP') {
    return `${relPath}: spec.default.config.type має бути HTTP (abie.mdc)`
  }
  const httpHc = /** @type {Record<string, unknown>} */ (config).httpHealthCheck
  if (httpHc === null || typeof httpHc !== 'object' || Array.isArray(httpHc)) {
    return `${relPath}: відсутній httpHealthCheck (abie.mdc)`
  }
  if (httpHc.requestPath !== '/healthz') {
    return `${relPath}: httpHealthCheck.requestPath має бути /healthz (abie.mdc)`
  }
  if (httpHc.port !== 8080) {
    return `${relPath}: httpHealthCheck.port має бути 8080 (abie.mdc)`
  }
  const targetRef = /** @type {Record<string, unknown>} */ (spec).targetRef
  if (targetRef === null || typeof targetRef !== 'object' || Array.isArray(targetRef)) {
    return `${relPath}: відсутній targetRef (abie.mdc)`
  }
  if (targetRef.kind !== 'Service') {
    return `${relPath}: targetRef.kind має бути Service (abie.mdc)`
  }
  const svcName = targetRef.name
  if (typeof svcName !== 'string' || svcName !== name) {
    return `${relPath}: targetRef.name має збігатися з metadata.name (${name}) (abie.mdc)`
  }
  return null
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
    let raw
    try {
      raw = await readFile(abs, 'utf8')
    } catch {
      raw = null
    }
    if (raw !== null) {
      const body = stripBom(raw)
      const lines = body.split(/\r?\n/u)
      const first = lines[0] ?? ''
      const rest = MODELINE_RE.test(first.trim()) ? lines.slice(1).join('\n') : body
      try {
        const docs = parseAllDocuments(rest)
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
      } catch {
        /* пропускаємо пошкоджені файли — їх ловить check-k8s */
      }
    }
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
 * Якщо є **Deployment** під **k8s**, вимагає в overlay **ua** та **ru** (**kustomization.yaml**) JSON6902 patch nodeSelector (abie.mdc)
 * лише для kustomization того пакета, у дереві **k8s** якого є **Deployment**.
 * @param {string} root корінь репозиторію
 * @param {string[]} yamlFilesAbs yaml під k8s
 * @param {Set<string>} deploymentDirs абсолютні каталоги YAML-файлів із **Deployment**
 * @param {(msg: string) => void} fail callback
 * @param {(msg: string) => void} passFn успішне повідомлення
 * @returns {Promise<void>}
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
    if (abieOverlayK8sTreeHasDeployment(deploymentDirs, root, abs)) {
      let raw
      try {
        raw = await readFile(abs, 'utf8')
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        fail(`${rel}: не вдалося прочитати (${msg})`)
        return
      }
      if (!kustomizationHasAbieDeploymentNodeSelectorPatch(raw, 'ua')) {
        fail(
          `${rel}: потрібен patch target kind Deployment: path /spec/template/spec/nodeSelector та preem: false (abie.mdc)`
        )
        return
      }
      passFn(`${rel}: nodeSelector patch (ua) відповідає abie.mdc`)
    } else {
      passFn(`${rel}: nodeSelector patch (ua) не застосовується — немає Deployment у дереві k8s цього пакета (abie)`)
    }
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
    if (abieOverlayK8sTreeHasDeployment(deploymentDirs, root, abs)) {
      let raw
      try {
        raw = await readFile(abs, 'utf8')
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        fail(`${rel}: не вдалося прочитати (${msg})`)
        return
      }
      if (!kustomizationHasAbieDeploymentNodeSelectorPatch(raw, 'ru')) {
        fail(
          `${rel}: потрібен patch target kind Deployment: path /spec/template/spec/nodeSelector та yandex.cloud/preemptible: false (abie.mdc)`
        )
        return
      }
      passFn(`${rel}: nodeSelector patch (ru) відповідає abie.mdc`)
    } else {
      passFn(`${rel}: nodeSelector patch (ru) не застосовується — немає Deployment у дереві k8s цього пакета (abie)`)
    }
  }
}

/**
 * Якщо є **Deployment** під **k8s**, вимагає в overlay **ua** та **ru** patch **HTTPRoute** (непорожній **target.name**) за abie.mdc
 * лише для пакетів з **vite.config.{js,mjs,ts}** у каталозі пакета (батько **k8s**).
 * @param {string} root корінь репозиторію
 * @param {string[]} yamlFilesAbs yaml під k8s
 * @param {(msg: string) => void} fail callback
 * @param {(msg: string) => void} passFn успішне повідомлення
 * @returns {Promise<void>}
 */
async function ensureUaRuAbieHttpRoutePatches(root, yamlFilesAbs, fail, passFn) {
  const uaAbsList = yamlFilesAbs.filter(abs => isUaKustomizationPath(relative(root, abs).replaceAll('\\', '/') || abs))
  if (uaAbsList.length === 0) {
    passFn(
      'Немає ua/kustomization.yaml у дереві k8s — patch HTTPRoute (ua) не вимагається (abie.mdc, лише Vite-пакети)'
    )
  }
  for (const abs of uaAbsList) {
    const rel = relative(root, abs).replaceAll('\\', '/') || abs
    if (abieOverlayRequiresHttpRouteByVite(root, abs)) {
      let raw
      try {
        raw = await readFile(abs, 'utf8')
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        fail(`${rel}: не вдалося прочитати (${msg})`)
        return
      }
      const combined = getCombinedNginxRunPatchTextFromKustomization(raw)
      const v = validateAbieNginxRunHttpRoutePatches(combined, 'ua')
      if (v !== null) {
        fail(`${rel}: ${v}`)
        return
      }
      passFn(`${rel}: HTTPRoute patch (ua) відповідає abie.mdc`)
    } else {
      passFn(`${rel}: HTTPRoute patch (ua) не застосовується — немає vite.config.{js,mjs,ts} у пакеті (abie)`)
    }
  }

  const ruAbsList = yamlFilesAbs.filter(abs => isRuKustomizationPath(relative(root, abs).replaceAll('\\', '/') || abs))
  if (ruAbsList.length === 0) {
    passFn(
      'Немає ru/kustomization.yaml у дереві k8s — patch HTTPRoute (ru) не вимагається (abie.mdc, лише Vite-пакети)'
    )
  }
  for (const abs of ruAbsList) {
    const rel = relative(root, abs).replaceAll('\\', '/') || abs
    if (abieOverlayRequiresHttpRouteByVite(root, abs)) {
      let raw
      try {
        raw = await readFile(abs, 'utf8')
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        fail(`${rel}: не вдалося прочитати (${msg})`)
        return
      }
      const combined = getCombinedNginxRunPatchTextFromKustomization(raw)
      const v = validateAbieNginxRunHttpRoutePatches(combined, 'ru', raw)
      if (v !== null) {
        fail(`${rel}: ${v}`)
        return
      }
      passFn(`${rel}: HTTPRoute patch (ru) відповідає abie.mdc`)
    } else {
      passFn(`${rel}: HTTPRoute patch (ru) не застосовується — немає vite.config.{js,mjs,ts} у пакеті (abie)`)
    }
  }
}

/**
 * Перевіряє відсутність артефактів Firebase Hosting у корені репозиторію (abie.mdc).
 * @param {string} root корінь репозиторію
 * @param {(msg: string) => void} passFn успішне повідомлення
 * @param {(msg: string) => void} failFn повідомлення про порушення
 * @returns {void}
 */
function ensureNoFirebaseHostingArtifacts(root, passFn, failFn) {
  for (const name of ['.firebaserc', 'firebase.json']) {
    const abs = join(root, name)
    if (existsSync(abs)) {
      failFn(`Знайдено заборонений файл Firebase Hosting: ${name} — видали його (abie.mdc)`)
    } else {
      passFn(`Немає ${name}`)
    }
  }
  const firebaseDir = join(root, '.firebase')
  if (existsSync(firebaseDir)) {
    failFn('Знайдено директорію .firebase — видали її (abie.mdc)')
  } else {
    passFn('Немає .firebase/')
  }
}

/**
 * Перевіряє відповідність проєкту правилам abie.mdc.
 * @returns {Promise<number>} 0 — OK, 1 — є порушення
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
  ensureNoFirebaseHostingArtifacts(root, pass, fail)

  const cleanMergedPath = join(root, '.github/workflows/clean-merged-branch.yml')
  if (existsSync(cleanMergedPath)) {
    /** @type {string | undefined} */
    let wfRaw
    try {
      wfRaw = await readFile(cleanMergedPath, 'utf8')
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      fail(`Не вдалося прочитати clean-merged-branch.yml (${msg})`)
    }
    if (wfRaw !== undefined) {
      const ib = parseCleanMergedIgnoreBranches(wfRaw)
      if (ib === null || ib.trim() === '') {
        fail(
          'clean-merged-branch.yml: не знайдено with.ignore_branches у кроці phpdocker-io/github-actions-delete-abandoned-branches (abie.mdc)'
        )
      } else if (ignoreBranchesIncludesRequired(ib, ABIE_REQUIRED_IGNORE_BRANCHES)) {
        pass('clean-merged-branch.yml: ignore_branches містить dev, ua, ru')
      } else {
        fail(
          `clean-merged-branch.yml: ignore_branches має містити dev, ua та ru (зараз: ${JSON.stringify(ib)}) — abie.mdc`
        )
      }
    }
  } else {
    fail(`Відсутній ${cleanMergedPath} — потрібен для ignore_branches (abie.mdc)`)
  }

  const yamlFiles = await findK8sYamlFiles(root)
  const deploymentDirs = await collectDeploymentDirs(root, yamlFiles, fail)

  if (deploymentDirs.size > 0) {
    pass(`Знайдено Deployment у ${deploymentDirs.size} директорія(ї/й) k8s — перевіряємо hc.yaml`)
    for (const dir of [...deploymentDirs].toSorted((a, b) => a.localeCompare(b))) {
      const hcAbs = join(dir, 'hc.yaml')
      const relHc = relative(root, hcAbs).replaceAll('\\', '/') || 'hc.yaml'
      if (existsSync(hcAbs)) {
        let hcRaw
        let hcReadOk = false
        try {
          hcRaw = await readFile(hcAbs, 'utf8')
          hcReadOk = true
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error)
          fail(`${relHc}: не вдалося прочитати (${msg})`)
        }
        if (hcReadOk) {
          const v = validateAbieHcYaml(hcRaw, relHc)
          if (v === null) {
            pass(`${relHc}: відповідає abie.mdc`)
          } else {
            fail(v)
          }
        }
      } else {
        fail(
          `${relative(root, dir) || dir}: є Deployment, але немає hc.yaml поруч — додай HealthCheckPolicy (abie.mdc)`
        )
      }
    }
    pass('Є Deployment — перевіряємо base: spec.template.spec.nodeSelector.preem (abie.mdc)')
    await ensureAbieBaseDeploymentPreemNodeSelector(root, yamlFiles, fail, pass)
  } else {
    pass('Немає Deployment у дереві k8s — перевірку hc.yaml пропущено')
  }

  const healthCheckPolicyRelativePaths = await collectHealthCheckPolicyRelPaths(root, yamlFiles)
  await ensureRuKustomizationHealthCheckDelete(root, yamlFiles, healthCheckPolicyRelativePaths, fail)

  if (deploymentDirs.size > 0) {
    pass('Є Deployment — перевіряємо nodeSelector у ua/ru kustomization (abie.mdc)')
    await ensureUaRuAbieNodeSelectorPatches(root, yamlFiles, deploymentDirs, fail, pass)
    pass('Є Deployment — перевіряємо HTTPRoute у ua/ru kustomization (abie.mdc)')
    await ensureUaRuAbieHttpRoutePatches(root, yamlFiles, fail, pass)
  }

  return reporter.getExitCode()
}

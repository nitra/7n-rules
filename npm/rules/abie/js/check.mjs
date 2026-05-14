/**
 * Перевіряє відповідність проєкту правилу abie.mdc (проєкти AbInBev Efes).
 *
 * Застосовується лише якщо у **`.n-cursor.json`** у масиві **`rules`** є **`abie`** — інакше вихід **0**
 * без перевірок (щоб не суперечити типовому **ga.mdc** з **`ignore_branches: main,dev`**).
 *
 * **Гілки:** у **`.github/workflows/clean-merged-branch.yml`** у кроці з
 * **`phpdocker-io/github-actions-delete-abandoned-branches`** у **`with.ignore_branches`** мають бути
 * **dev** та **ua** (разом з іншими гілками, якщо потрібно).
 *
 * **Firebase Hosting:** у **підкаталогах першого рівня** (безпосередні діти кореня репозиторію; `node_modules` / `.git` пропускаються) не має бути
 * **`.firebaserc`**, **`firebase.json`** та каталогу **`.firebase/`**; у **самому** корені репозиторію ці імена не перевіряються.
 *
 * **k8s:** якщо під деревом із сегментом **`k8s`** є YAML з **`kind: Deployment`**, у тій самій директорії
 * має існувати **`hc.yaml`** із **`HealthCheckPolicy`** (**`networking.gke.io/v1`**), modeline **`$schema`**
 * як у abie.mdc, **`requestPath`** — непорожній шлях від кореня (рядок, що починається з **`/`**: **`/healthz`**, **`/IsAlive`**, **`/api/live`** тощо), порт **8080**, **`targetRef`** на **headless Service** (ім'я з суфіксом **`-hl`**):
 * якщо **`metadata.name`** уже закінчується на **`-hl`**, **`targetRef.name`** має збігатися з ним; інакше **`targetRef.name`** = **`${metadata.name}-hl`**.
 * Загальні вимоги до **`# yaml-language-server: $schema`** для інших YAML під **`k8s`** — у **check-k8s.mjs** / **k8s.mdc**.
 *
 * **nodeSelector (base):** якщо **Deployment** лежить у шляху з сегментом **`base`** (наприклад **`…/k8s/base/deploy.yaml`**),
 * у **`spec.template.spec.nodeSelector`** має бути **`preem`** з булевим значенням **true** або рядком **`'true'`** — overlay **ua** далі підміняє селектор.
 *
 * **nodeSelector (overlay ua):** якщо в дереві **k8s** пакета є **Deployment**, у **`ua/kustomization.yaml`** цього пакета — inline patch на **`kind: Deployment`**
 * з **`path: /spec/template/spec/nodeSelector`** та **`preem: false`**.
 * Узагальнені вимоги **k8s.mdc** до JSON6902 (зокрема заборона **remove** + **add** на той самий **path**) перевіряє **check-k8s.mjs**; **check-abie** — лише abie-специфічний вміст (без дублювання цього правила).
 *
 * **HTTPRoute (overlay ua):** лише якщо в каталозі пакета (батько **`k8s`**) є **`vite.config.js`**, **`vite.config.mjs`** або **`vite.config.ts`**
 * — тоді в **`ua/kustomization.yaml`** потрібен patch на **`kind: HTTPRoute`**, **непорожній `target.name`**: **`/spec/hostnames`**
 * (домени abie.mdc), **`/spec/parentRefs/0/namespace`** (**ua**, також дозволені префікси **`ua-*`**).
 * **HTTPRoute (base / dev):** у маніфесті **HTTPRoute** у шляху з сегментом **`base`** (наприклад **`…/k8s/base/hr.yaml`**) у **`spec.hostnames`** дозволені лише **`aiml.live`**, **`*.aiml.live`** та інші піддомени **aiml.live** (канонічно порівняння без урахування регістру).
 * **Спільні бекенди (`auth-run-hl`, `file-link-hl`):** у **HTTPRoute** під **`k8s`** поза overlay **ua** (шлях не містить **`k8s/ua/`**) кожен такий **`backendRefs`** має **`namespace: dev`** і порт **8080**;
 * у patch overlay **ua** — по одному **JSON6902** на **`/spec/rules/…/backendRefs/…/namespace`** з **`value`**: **ua** (кількість patch-ів = кількість таких **`backendRefs`** у пакеті).
 * Вибір **`op`** — **k8s.mdc**.
 *
 * **env→cluster DNS:** abie живе у двох GKE-кластерах (dev / ua), тож DNS-суфікс і namespace-префікс у будь-якому
 * **внутрішньокластерному** URL виду `http://<svc>.<ns>.svc.<dns>` мають відповідати імені env-файла. Скануються всі `*.env` файли,
 * basename яких збігається з `dev.env` / `ua.env` (опційно з провідною крапкою — `.dev.env` тощо). Для кожного знайденого
 * internal URL у файлі (не лише `HASURA_GRAPHQL_ENDPOINT`, а й KVCMS, auth-run, file-link тощо) валідатор `validateAbieEnvInternalUrls`
 * вимагає: для `dev.env` — DNS `abie-dev.internal` і namespace починається з `dev-`; для `ua.env` — `abie-ua.internal` + `ua-`.
 * Файл `.env` без імені (локальний для розробника) виключено зі сканування — як і у `check-hasura.mjs`.
 */
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { basename, dirname, join, relative } from 'node:path'

import { parseAllDocuments } from 'yaml'

import { pathHasK8sSegment } from '../../k8s/js/check.mjs'
import { createCheckReporter } from '../../../scripts/utils/check-reporter.mjs'
import { loadCursorIgnorePaths } from '../../../scripts/utils/load-cursor-config.mjs'
import { runConftestBatch } from '../../../scripts/utils/run-conftest-batch.mjs'
import { walkDir } from '../../../scripts/utils/walkDir.mjs'

const CONFIG_FILE = '.n-cursor.json'

/** Каталоги-діти в корені, які пропускаються при скануванні на артефакти Firebase Hosting (abie). */
const ABIE_FIREBASE_HOSTING_SCAN_SKIP_TOP_DIR_NAMES = new Set(['.git', 'node_modules'])

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
const UA_KUSTOMIZATION_PATH_RE = /(^|\/)ua\/kustomization\.yaml$/u
const OVERLAY_PACKAGE_DIR_RE = /^(.+)\/k8s\/ua\/kustomization\.yaml$/u
const BASE_SEGMENT_RE = /(^|\/)base\//u
const YAML_EXTENSION_RE = /\.ya?ml$/iu
const PATCH_NODE_SELECTOR_PATH_RE = /path:\s*\/spec\/template\/spec\/nodeSelector\b/u
const PATCH_PREEM_FALSE_RE = /\bpreem:\s*['"]?false['"]?\b/u
const TRAILING_SLASH_RE = /\/$/u
const PATCH_HOSTNAMES_PATH_RE = /path:\s*\/spec\/hostnames\b/mu
// Overlay namespaces: allow `ua` and `ua-*` (e.g. ua-b2b).
const PATCH_PARENT_REF_NS_UA_RE =
  /path:\s*\/spec\/parentRefs\/0\/namespace\b[\s\S]{0,200}?value:\s*['"]?ua(?:-[a-z0-9][a-z0-9-]*)?['"]?(?:\s|$)/imu

/**
 * Регекс basename env-файлу abie: `dev.env` / `ua.env`, опційно з провідною крапкою (`.dev.env` тощо).
 * Файл рівно `.env` (без імені) — виключення з правила: локальний файл розробника, `check-abie` його не сканує
 * (так само як `check-hasura`, див. `isEnvFile`).
 */
const ABIE_ENV_FILE_BASENAME_RE = /^\.?(dev|ua)\.env$/u

/**
 * Глобальний регекс кластерного internal URL у тексті env-файлу.
 * Використовується з `String.prototype.matchAll`, тому має флаг `g`.
 * Допустимий DNS-формат — `<cluster>.internal` (GKE).
 * Порт необов'язковий — у KVCMS-конфігах інколи лежить URL без порту (8080 додається сервісом за замовчуванням).
 */
const ABIE_INTERNAL_URL_GLOBAL_RE =
  /\bhttp:\/\/([a-z0-9][a-z0-9-]*)\.([a-z0-9][a-z0-9-]*)\.svc\.([a-z0-9][a-z0-9-]*\.internal)(?::\d+)?(?:\/[^\s"'`]*)?/giu

/**
 * Очікуваний кластерний DNS-суфікс і namespace-префікс для кожного env-файлу abie.
 * `dev` / `ua` живуть у двох GKE-кластерах з власним `<cluster>.internal`.
 */
const ABIE_ENV_CLUSTER_DNS_MAP = Object.freeze({
  dev: Object.freeze({ clusterDns: 'abie-dev.internal', namespacePrefix: 'dev-' }),
  ua: Object.freeze({ clusterDns: 'abie-ua.internal', namespacePrefix: 'ua-' })
})

/**
 * Дістає ім'я env (`dev` / `ua`) з basename env-файлу abie.
 * Для не-abie env-файлів (наприклад `production.env`, `.env` без імені) повертає `null`.
 * @param {string} basenameOfEnvFile basename файла (без шляху)
 * @returns {('dev' | 'ua') | null} ім'я env або `null`
 */
export function abieEnvNameFromBasename(basenameOfEnvFile) {
  const m = basenameOfEnvFile.match(ABIE_ENV_FILE_BASENAME_RE)
  return m ? /** @type {'dev' | 'ua'} */ (m[1]) : null
}

/**
 * Сканує вміст env-файлу abie і повертає помилки невідповідності кластерного DNS / namespace
 * для кожного знайденого internal URL. URL шукається глобально (`matchAll`), тож одне й те саме
 * порушення в кількох змінних дасть стільки ж окремих помилок.
 * @param {string} content вміст env-файлу (UTF-8)
 * @param {'dev' | 'ua'} envName ім'я env, отримане з `abieEnvNameFromBasename`
 * @returns {string[]} порожній масив, якщо все OK; інакше — список повідомлень про порушення
 */
export function validateAbieEnvInternalUrls(content, envName) {
  const expected = ABIE_ENV_CLUSTER_DNS_MAP[envName]
  if (!expected) return []
  /** @type {string[]} */
  const errors = []
  for (const match of content.matchAll(ABIE_INTERNAL_URL_GLOBAL_RE)) {
    const [fullUrl, , namespace, clusterDns] = match
    if (clusterDns !== expected.clusterDns) {
      errors.push(
        `${fullUrl}: кластерний DNS "${clusterDns}" не відповідає env "${envName}" (очікується "${expected.clusterDns}")`
      )
    }
    if (!namespace.startsWith(expected.namespacePrefix)) {
      errors.push(
        `${fullUrl}: namespace "${namespace}" не починається з "${expected.namespacePrefix}" (env "${envName}")`
      )
    }
  }
  return errors
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
 * Каталог пакета: шлях перед сегментом **`/k8s/`** для overlay **`…/k8s/ua/kustomization.yaml`**.
 * @param {string} root корінь репозиторію
 * @param {string} kustomizationAbs абсолютний шлях до **ua** kustomization.yaml
 * @returns {string | null} абсолютний шлях до каталогу пакета або null, якщо шлях не overlay ua
 */
export function abiePackageDirFromK8sOverlay(root, kustomizationAbs) {
  const rel = relative(root, kustomizationAbs).replaceAll('\\', '/') || kustomizationAbs
  const m = rel.match(OVERLAY_PACKAGE_DIR_RE)
  return m ? join(root, m[1]) : null
}

/**
 * Чи для цього overlay застосовувати вимоги **HTTPRoute** (лише Vite-пакети).
 * @param {string} root корінь репозиторію
 * @param {string} kustomizationAbs абсолютний шлях до **ua** kustomization.yaml
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
 * Чи в дереві **k8s** того ж пакета, що й overlay **ua**, є **Deployment** (за каталогами з **collectDeploymentDirs**).
 * @param {Set<string>} deploymentDirs абсолютні каталоги YAML-файлів із **Deployment**
 * @param {string} root корінь репозиторію
 * @param {string} kustomizationAbs абсолютний шлях до **ua** kustomization.yaml
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

// Per-document валідація hostnames у `…/k8s/.../base/.../*.yaml` HTTPRoute
// (Plan B: Rego-authoritative) — повністю в `npm/policy/abie/http_route_base/`.
// Per-document валідація `nodeSelector.preem` для Deployment у base — у
// `npm/policy/abie/base_deployment_preem/`. JS у `check-abie.mjs` робить лише
// path-фільтрацію + батч-виклик conftest через `runConftestBatch`.

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

// Per-document валідація `clean-merged-branch.yml` (with.ignore_branches з
// dev/ua) делегована rego-пакету `abie.clean_merged_ignore_branches`
// (`npm/policy/abie/clean_merged_ignore_branches/`). JS викликає
// `runConftestBatch` у `checkCleanMergedBranch`.

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
      const rel = relative(root, p).replaceAll('\\', '/')
      // `.github/` належить `ga.mdc`; check-abie не зачіпає workflow-файли.
      if (rel.startsWith('.github/')) {
        return
      }
      if (!pathHasK8sSegment(p, root)) {
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
 * Для кожного **Deployment** у YAML під **`k8s`** з шляхом **`…/base/…`** вимагає **`spec.template.spec.nodeSelector.preem: true`** (abie.mdc).
 *
 * Per-document валідація делегована у rego-пакет **`abie.base_deployment_preem`**
 * (`npm/policy/abie/base_deployment_preem/`) — JS лише фільтрує файли за path-патерном `base/` і батчем спавнить conftest.
 * @param {string} root корінь репозиторію
 * @param {string[]} yamlFilesAbs yaml під k8s
 * @param {(msg: string) => void} fail callback
 * @param {(msg: string) => void} passFn успішне повідомлення
 * @returns {void}
 */
function ensureAbieBaseDeploymentPreemNodeSelector(root, yamlFilesAbs, fail, passFn) {
  const baseFiles = yamlFilesAbs.filter(abs => isAbieK8sBaseYamlPath(relative(root, abs).replaceAll('\\', '/') || abs))
  if (baseFiles.length === 0) {
    passFn('Немає файлів у шляхах …/base/… — перевірку preem у base пропущено')
    return
  }
  const violations = runConftestBatch({
    policyDirRel: 'abie/base_deployment_preem',
    namespace: 'abie.base_deployment_preem',
    files: baseFiles
  })
  for (const v of violations) {
    const rel = relative(root, v.filename).replaceAll('\\', '/') || v.filename
    fail(`${rel}: ${v.message}`)
  }
  if (violations.length === 0) {
    passFn('Deployment у …/base/…: nodeSelector.preem відповідає abie.mdc (rego)')
  }
}

/**
 * Прибирає BOM на початку файлу.
 * @param {string} s вміст
 * @returns {string} той самий рядок без BOM (U+FEFF) на початку
 */
function stripBom(s) {
  return s.startsWith('﻿') ? s.slice(1) : s
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
 * Чи один елемент **patches** у kustomization відповідає abie nodeSelector для заданого **mode**.
 * @param {unknown} p елемент масиву **patches**
 * @param {'ua'} mode який overlay перевіряти
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
  return false
}

/**
 * Чи один YAML-документ kustomization містить відповідний inline patch на Deployment.
 * @param {import('yaml').Document} doc документ після **parseAllDocuments**
 * @param {'ua'} mode який overlay перевіряти
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
 * Чи **kustomization.yaml** містить inline **patches** на **Deployment** з nodeSelector за abie.mdc (overlay **ua**).
 * @param {string} raw повний текст файлу
 * @param {'ua'} mode який overlay перевіряти
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
 * Чи YAML відносно кореня належить до **`${pkgRel}/k8s/**`** поза піддеревом **`ua/`** (base-шар abie).
 * @param {string} relFromRoot відносний шлях від кореня
 * @param {string} pkgRelFromRoot каталог пакета відносно кореня (без завершального слеша після імені пакета)
 * @returns {boolean} `true`, якщо шлях належить до base-шару abie
 */
export function isK8sYamlInAbiePackageExcludingUaOverlay(relFromRoot, pkgRelFromRoot) {
  const normRel = relFromRoot.replaceAll('\\', '/')
  const pkg = pkgRelFromRoot.replaceAll('\\', '/').replace(TRAILING_SLASH_RE, '')
  const prefix = `${pkg}/k8s/`
  if (!normRel.startsWith(prefix)) {
    return false
  }
  const after = normRel.slice(prefix.length)
  return !after.startsWith('ua/')
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
 * З YAML під **k8s** пакета (без overlay **ua**) збирає кількість **`backendRefs`** до **`auth-run-hl`** і **`file-link-hl`** і порушення **`namespace: dev`**.
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
    if (isK8sYamlInAbiePackageExcludingUaOverlay(rel, pkgRel)) {
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
 * @param {'ua'} mode overlay
 * @returns {number} кількість знайдених патчів namespace
 */
function countAbieHttpRouteBackendRefNamespacePatchesInCombined(combined, mode) {
  if (mode !== 'ua') return 0
  const re =
    /path:\s*\/spec\/rules\/\d+\/backendRefs\/\d+\/namespace\b[\s\S]{0,200}?value:\s*['"]?ua(?:-[a-z0-9][a-z0-9-]*)?['"]?(?:\s|$)/gimu
  return [...combined.matchAll(re)].length
}

/** Домени **hostnames** для overlay **ua** (підрядки у JSON6902-тексті patch), abie.mdc. */
const ABIE_UA_HTTPROUTE_HOST_MARKERS = ['abie.app', 'vybeerai.com.ua', '*.abie.app', '*.vybeerai.com.ua']

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
 * @param {'ua'} mode overlay (наразі лише **ua**)
 * @param {string} [_fullKustomizationRaw] збережено для зворотної сумісності API (не використовується)
 * @param {number} [sharedCrossNsBackendRefCount] скільки **`backendRefs`** до **`auth-run-hl`** і **`file-link-hl`** у base **HTTPRoute** пакета — стільки ж patch-ів **`…/backendRefs/…/namespace`** з **`value`** overlay
 * @returns {string | null} повідомлення про помилку або **null**
 */
export function validateAbieNginxRunHttpRoutePatches(
  combined,
  mode,
  _fullKustomizationRaw,
  sharedCrossNsBackendRefCount = 0
) {
  if (typeof combined !== 'string' || combined.trim() === '') {
    return `очікується patch target kind HTTPRoute з непорожнім target.name (hostnames, parentRefs namespace ${mode}) — abie.mdc`
  }
  if (!PATCH_HOSTNAMES_PATH_RE.test(combined)) {
    return 'HTTPRoute: потрібен path /spec/hostnames у patch (abie.mdc)'
  }
  const markers = ABIE_UA_HTTPROUTE_HOST_MARKERS
  if (!markers.some(m => combined.includes(m))) {
    return `HTTPRoute: у value для /spec/hostnames має бути один із доменів abie (${markers.join(', ')}) — abie.mdc`
  }
  if (!PATCH_PARENT_REF_NS_UA_RE.test(combined)) {
    return `HTTPRoute: потрібен path /spec/parentRefs/0/namespace з value ${mode} (abie.mdc)`
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
 * Чи **kustomization** містить валідні для abie **patch** для **HTTPRoute** з непорожнім **target.name** (**ua**).
 * @param {string} raw повний текст **kustomization.yaml**
 * @param {'ua'} mode overlay
 * @returns {boolean} true, якщо **`validateAbieNginxRunHttpRoutePatches`** повертає **null**
 */
export function kustomizationHasAbieNginxRunHttpRoutePatch(raw, mode) {
  const combined = getCombinedNginxRunPatchTextFromKustomization(raw)
  return validateAbieNginxRunHttpRoutePatches(combined, mode, raw) === null
}

// Per-document валідація HealthCheckPolicy (apiVersion / spec.default.config /
// httpHealthCheck / targetRef з суфіксом `-hl` exact match) делегована
// rego-пакету `abie.health_check_policy` (`npm/policy/abie/health_check_policy/`).
// JS у `checkHcYamlFiles` робить лише modeline-перевірку (`validateAbieHcModeline`)
// і батч-виклик conftest.

/**
 * JS-частина перевірки hc.yaml — лише modeline (`# yaml-language-server: $schema=…`).
 * Парсинг YAML і структурна валідація HealthCheckPolicy делеговано в rego-пакет
 * **`abie.health_check_policy`** (`npm/policy/abie/health_check_policy/`),
 * викликається з `checkHcYamlFile` через `runConftestBatch`.
 * @param {string} raw вміст файлу
 * @param {string} relPath відносний шлях (для повідомлень)
 * @returns {string | null} null якщо OK, рядок з помилкою
 */
export function validateAbieHcModeline(raw, relPath) {
  const body = stripBom(raw)
  const lines = body.split(LINE_SPLIT_RE)
  if (lines.length === 0 || lines[0].trim() === '') {
    return `${relPath}: перший рядок порожній — потрібен # yaml-language-server: $schema=… (abie.mdc)`
  }
  const m = lines[0].match(MODELINE_RE)
  if (!m) return `${relPath}: перший рядок має бути modeline $schema (abie.mdc)`
  if (m[1] !== ABIE_HC_SCHEMA_URL) return `${relPath}: $schema має бути\n     ${ABIE_HC_SCHEMA_URL}\n     (abie.mdc)`
  return null
}

/**
 * Перевіряє одну kustomization.yaml на nodeSelector patch для заданого overlay.
 * @param {string} abs абсолютний шлях до файлу
 * @param {string} rel відносний шлях (для повідомлень)
 * @param {'ua'} mode параметр mode
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
    fail(`${rel}: потрібен patch target kind Deployment: path /spec/template/spec/nodeSelector та preem: false (abie.mdc)`)
    return false
  }
  passFn(`${rel}: nodeSelector patch (${mode}) відповідає abie.mdc`)
  return true
}

/**
 * Перевіряє наявність патчів nodeSelector для ua overlay у k8s.
 * @param {string} root корінь репозиторію
 * @param {string[]} yamlFilesAbs абсолютні шляхи yaml-файлів під k8s
 * @param {Set<string>} deploymentDirs директорії з Deployment (Set)
 * @param {(msg: string) => void} fail callback при помилці
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 */
async function ensureUaAbieNodeSelectorPatches(root, yamlFilesAbs, deploymentDirs, fail, passFn) {
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
}

/**
 * Перевіряє HTTPRoute patch для одного overlay (ua).
 * @param {string} abs абсолютний шлях до kustomization.yaml
 * @param {string} rel відносний шлях (для повідомлень)
 * @param {'ua'} mode overlay
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
 * Для кожного **HTTPRoute** у **`…/k8s/base/…`** з непорожніми **`spec.hostnames`** — лише **aiml.live** та піддомени (abie.mdc).
 * @param {string} root корінь репозиторію
 * @param {string[]} yamlFilesAbs yaml під k8s
 * @param {(msg: string) => void} fail callback при помилці
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @returns {void}
 */
function ensureAbieBaseHttpRouteHostnames(root, yamlFilesAbs, fail, passFn) {
  const baseFiles = yamlFilesAbs.filter(abs => isAbieK8sBaseYamlPath(relative(root, abs).replaceAll('\\', '/') || abs))
  if (baseFiles.length === 0) {
    passFn('Немає файлів у шляхах …/k8s/base/… — перевірку HTTPRoute hostnames пропущено')
    return
  }
  // Per-document валідація делегована rego-пакету `abie.http_route_base`
  // (`npm/policy/abie/http_route_base/`) — rego гейтує по `kind == "HTTPRoute"`.
  const violations = runConftestBatch({
    policyDirRel: 'abie/http_route_base',
    namespace: 'abie.http_route_base',
    files: baseFiles
  })
  for (const v of violations) {
    const rel = relative(root, v.filename).replaceAll('\\', '/') || v.filename
    fail(`${rel}: ${v.message}`)
  }
  if (violations.length === 0) {
    passFn(
      `HTTPRoute у …/k8s/base/…: spec.hostnames відповідають ${ABIE_BASE_DEV_HTTPROUTE_HOST_ROOT} та піддоменам (rego)`
    )
  }
}

/**
 * Якщо є **Deployment** під **k8s**, вимагає в overlay **ua** patch **HTTPRoute** (непорожній **target.name**) за abie.mdc
 * лише для пакетів з **vite.config.{js,mjs,ts}** у каталозі пакета (батько **k8s**).
 * @param {string} root корінь репозиторію
 * @param {string[]} yamlFilesAbs yaml під k8s
 * @param {(msg: string) => void} fail callback при помилці
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 */
async function ensureUaAbieHttpRoutePatches(root, yamlFilesAbs, fail, passFn) {
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
 * @returns {void}
 */
function checkCleanMergedBranch(root, pass, fail) {
  const cleanMergedPath = join(root, '.github/workflows/clean-merged-branch.yml')
  if (!existsSync(cleanMergedPath)) {
    fail(`Відсутній ${cleanMergedPath} — потрібен для ignore_branches (abie.mdc)`)
    return
  }
  // Per-document валідація делегована у rego-пакет `abie.clean_merged_ignore_branches`
  // (`npm/policy/abie/clean_merged_ignore_branches/`). conftest сам читає та парсить YAML.
  const violations = runConftestBatch({
    policyDirRel: 'abie/clean_merged_ignore_branches',
    namespace: 'abie.clean_merged_ignore_branches',
    files: [cleanMergedPath]
  })
  for (const v of violations) fail(v.message)
  if (violations.length === 0) {
    pass('clean-merged-branch.yml: ignore_branches містить dev, ua (rego)')
  }
}

/**
 * Перевіряє hc.yaml у директоріях з Deployment. JS перевіряє modeline, далі
 * один батч conftest для усіх знайдених hc.yaml — структурна валідація HCP
 * делегується rego (`abie.health_check_policy`).
 * @param {string} root корінь репозиторію
 * @param {Set<string>} deploymentDirs директорії з Deployment (Set)
 * @param {(msg: string) => void} pass callback при успішній перевірці
 * @param {(msg: string) => void} fail callback при помилці
 */
async function checkHcYamlFiles(root, deploymentDirs, pass, fail) {
  /** @type {string[]} файли, які пройшли modeline-check і йдуть у conftest */
  const hcFilesForRego = []
  for (const dir of [...deploymentDirs].toSorted((a, b) => a.localeCompare(b))) {
    const hcAbs = join(dir, 'hc.yaml')
    const relHc = relative(root, hcAbs).replaceAll('\\', '/') || 'hc.yaml'
    if (!existsSync(hcAbs)) {
      fail(`${relative(root, dir) || dir}: є Deployment, але немає hc.yaml поруч — додай HealthCheckPolicy (abie.mdc)`)
      continue
    }
    let hcRaw
    try {
      hcRaw = await readFile(hcAbs, 'utf8')
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      fail(`${relHc}: не вдалося прочитати (${msg})`)
      continue
    }
    const modelineErr = validateAbieHcModeline(hcRaw, relHc)
    if (modelineErr !== null) {
      fail(modelineErr)
      continue
    }
    hcFilesForRego.push(hcAbs)
  }
  if (hcFilesForRego.length === 0) return
  const violations = runConftestBatch({
    policyDirRel: 'abie/health_check_policy',
    namespace: 'abie.health_check_policy',
    files: hcFilesForRego
  })
  for (const v of violations) {
    const rel = relative(root, v.filename).replaceAll('\\', '/') || v.filename
    fail(`${rel}: ${v.message}`)
  }
  if (violations.length === 0 && hcFilesForRego.length > 0) {
    pass(`HealthCheckPolicy: ${hcFilesForRego.length} файл(ів) hc.yaml відповідають abie.mdc (rego)`)
  }
}

/**
 * Збирає всі `*.env` файли в дереві (за виключенням `node_modules`, `.git` та інших службових каталогів),
 * basename яких — abie env-файл (`dev.env` / `ua.env` опційно з провідною крапкою). Файл `.env`
 * без імені виключається — як і у `check-hasura.mjs`.
 * @param {string} root корінь репозиторію
 * @param {string[]} ignorePaths абсолютні шляхи каталогів, повністю виключених з обходу
 * @returns {Promise<string[]>} відсортовані абсолютні шляхи env-файлів abie
 */
async function collectAbieEnvFiles(root, ignorePaths) {
  /** @type {string[]} */
  const out = []
  await walkDir(
    root,
    absPath => {
      if (abieEnvNameFromBasename(basename(absPath)) !== null) {
        out.push(absPath)
      }
    },
    ignorePaths
  )
  return out.toSorted((a, b) => a.localeCompare(b))
}

/**
 * Сканує всі `*.env` файли abie (`.dev.env` / `.ua.env`) і для кожного знайденого
 * **внутрішньокластерного** URL (`http://<svc>.<ns>.svc.<dns>`) перевіряє, що DNS-суфікс і namespace-префікс
 * відповідають середовищу env-файла. Не лише `HASURA_GRAPHQL_ENDPOINT`, а й будь-який сервіс у env (KVCMS,
 * `auth-run-hl`, `file-link-hl` тощо) мусить мати кластер, що відповідає env: dev → `abie-dev.internal`,
 * ua → `abie-ua.internal`.
 * @param {string} root корінь репозиторію
 * @param {string[]} ignorePaths абсолютні шляхи каталогів, повністю виключених з обходу
 * @param {(msg: string) => void} pass успішне повідомлення
 * @param {(msg: string) => void} fail повідомлення про порушення
 * @returns {Promise<void>}
 */
async function ensureAbieEnvFilesMatchClusterDns(root, ignorePaths, pass, fail) {
  const envFiles = await collectAbieEnvFiles(root, ignorePaths)
  if (envFiles.length === 0) {
    pass('Не знайдено dev.env / ua.env у репозиторії — перевірку env→cluster DNS пропущено (abie.mdc)')
    return
  }
  for (const abs of envFiles) {
    const rel = relative(root, abs).replaceAll('\\', '/') || abs
    const envName = abieEnvNameFromBasename(basename(abs))
    if (envName === null) continue
    let raw
    try {
      raw = await readFile(abs, 'utf8')
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      fail(`${rel}: не вдалося прочитати (${msg})`)
      continue
    }
    const errors = validateAbieEnvInternalUrls(raw, envName)
    if (errors.length === 0) {
      pass(`${rel}: усі внутрішні URL відповідають env "${envName}" (abie.mdc)`)
    } else {
      for (const err of errors) {
        fail(`${rel}: ${err} (abie.mdc)`)
      }
    }
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

  pass('Перевіряємо HTTPRoute spec.hostnames у …/k8s/base/… (aiml.live, abie.mdc)')
  await ensureAbieBaseHttpRouteHostnames(root, yamlFiles, fail, pass)

  if (deploymentDirs.size > 0) {
    pass('Є Deployment — перевіряємо nodeSelector у ua/kustomization (abie.mdc)')
    await ensureUaAbieNodeSelectorPatches(root, yamlFiles, deploymentDirs, fail, pass)
    pass('Є Deployment — перевіряємо HTTPRoute у ua/kustomization (abie.mdc)')
    await ensureUaAbieHttpRoutePatches(root, yamlFiles, fail, pass)
  }

  pass('Перевіряємо env→cluster DNS у dev.env / ua.env (abie.mdc)')
  await ensureAbieEnvFilesMatchClusterDns(root, ignorePaths, pass, fail)

  return reporter.getExitCode()
}

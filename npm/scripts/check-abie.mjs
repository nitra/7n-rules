/**
 * Перевіряє відповідність проєкту правилу abie.mdc (проєкти abinbevefes).
 *
 * Застосовується лише якщо у **`.n-cursor.json`** у масиві **`rules`** є **`abie`** — інакше вихід **0**
 * без перевірок (щоб не суперечити типовому **ga.mdc** з **`ignore_branches: main,dev`**).
 *
 * **Гілки:** у **`.github/workflows/clean-merged-branch.yml`** у кроці з
 * **`phpdocker-io/github-actions-delete-abandoned-branches`** у **`with.ignore_branches`** мають бути
 * **dev**, **ua** та **ru** (разом з іншими гілками, якщо потрібно).
 *
 * **k8s:** якщо під деревом із сегментом **`k8s`** є YAML з **`kind: Deployment`**, у тій самій директорії
 * має існувати **`hc.yaml`** із **`HealthCheckPolicy`** (**`networking.gke.io/v1`**), modeline **`$schema`**
 * як у abie.mdc, **`/healthz`**, порт **8080**, **`targetRef`** на **Service** з тим самим **`metadata.name`**.
 * Якщо в дереві **k8s** є **HealthCheckPolicy**, перевіряється **`ru/kustomization.yaml`** з patch **`$patch: delete`**
 * (узгоджено з **k8s.mdc** / **check-k8s.mjs**).
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'

import { parseAllDocuments } from 'yaml'

import { isRuKustomizationPath, pathHasK8sSegment, ruKustomizationHasHealthCheckDeletePatch } from './check-k8s.mjs'
import { pass } from './utils/pass.mjs'
import { flattenWorkflowSteps, getStepUses, parseWorkflowYaml } from './utils/gha-workflow.mjs'
import { walkDir } from './utils/walkDir.mjs'

const CONFIG_FILE = '.n-cursor.json'

/** Очікуваний URL **`$schema`** для **hc.yaml** (abie.mdc). */
export const ABIE_HC_SCHEMA_URL = 'https://datreeio.github.io/CRDs-catalog/networking.gke.io/healthcheckpolicy_v1.json'

const MODELINE_RE = /^#\s*yaml-language-server:\s*\$schema=(\S+)\s*$/

/** Гілки, які мають бути в **`ignore_branches`** за abie.mdc. */
export const ABIE_REQUIRED_IGNORE_BRANCHES = ['dev', 'ua', 'ru']

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
 * Прибирає BOM на початку файлу.
 * @param {string} s вміст
 * @returns {string} той самий рядок без BOM (U+FEFF) на початку
 */
function stripBom(s) {
  return s.startsWith('\uFEFF') ? s.slice(1) : s
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
 * Якщо є **HealthCheckPolicy**, вимагає **ru/kustomization.yaml** з patch видалення (як **check-k8s**).
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
 * Перевіряє відповідність проєкту правилам abie.mdc.
 * @returns {Promise<number>} 0 — OK, 1 — є порушення
 */
export async function check() {
  let exitCode = 0
  const fail = msg => {
    console.log(`  ❌ ${msg}`)
    exitCode = 1
  }

  const root = process.cwd()
  const enabled = await isAbieRuleEnabled(root)
  if (!enabled) {
    pass(`Правило abie не увімкнено в ${CONFIG_FILE} (rules) — перевірку пропущено`)
    return 0
  }

  pass('Правило abie увімкнено — виконуємо перевірки')

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
  } else {
    pass('Немає Deployment у дереві k8s — перевірку hc.yaml пропущено')
  }

  const healthCheckPolicyRelativePaths = await collectHealthCheckPolicyRelPaths(root, yamlFiles)
  await ensureRuKustomizationHealthCheckDelete(root, yamlFiles, healthCheckPolicyRelativePaths, fail)

  return exitCode
}

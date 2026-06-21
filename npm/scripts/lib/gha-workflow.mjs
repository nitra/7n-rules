/**
 * Допоміжні функції для аналізу GitHub Actions workflow (`.yml`) після структурного розбору YAML.
 *
 * Використовується в check-ga, check-js-lint, check-text, check-style-lint, check-npm-module замість
 * пошуку підрядків у сирому тексті там, де важливі лише значення `uses:` та `run:` кроків.
 *
 * Для `run:` також виявляється shell-продовження рядка через `\\` перед переносом (антипатерн у ga.mdc).
 */
import { parse } from 'yaml'

const CHECKOUT_V6_USES = 'actions/checkout@v6'
const LOCAL_SETUP_BUN_DEPS_MARKER = './.github/actions/setup-bun-deps'
const BUNX_OXLINT_FIX_RE = /bunx\s+oxlint[^\n]*--fix/u

/**
 * Парсить workflow YAML у звичайний об’єкт; при синтаксичній помилці — `null`.
 * @param {string} content вміст файлу
 * @returns {Record<string, unknown> | null} корінь документа або `null`
 */
export function parseWorkflowYaml(content) {
  try {
    const root = parse(content)
    return root && typeof root === 'object' ? /** @type {Record<string, unknown>} */ (root) : null
  } catch {
    return null
  }
}

/**
 * Збирає всі кроки з усіх jobs.
 * @param {Record<string, unknown>} root корінь workflow
 * @returns {{ jobId: string, stepIndex: number, step: Record<string, unknown> }[]} плоский список кроків з метаданими
 */
export function flattenWorkflowSteps(root) {
  /** @type {{ jobId: string, stepIndex: number, step: Record<string, unknown> }[]} */
  const out = []
  for (const [jobId, job] of workflowJobsEntries(root)) {
    const steps = workflowJobSteps(job)
    for (const [stepIndex, step] of steps.entries()) {
      out.push({ jobId, stepIndex, step })
    }
  }
  return out
}

/**
 * Значення `uses:` кроку.
 * @param {Record<string, unknown>} step об’єкт одного елемента `steps`
 * @returns {string} рядок `uses` або порожній рядок
 */
export function getStepUses(step) {
  return typeof step.uses === 'string' ? step.uses : ''
}

/**
 * Значення `run:` кроку (багаторядковий рядок або масив рядків у YAML).
 * @param {Record<string, unknown>} step об’єкт одного елемента `steps`
 * @returns {string} текст команди
 */
export function getStepRun(step) {
  const r = step.run
  if (typeof r === 'string') {
    return r
  }
  if (Array.isArray(r)) {
    return r.map(String).join('\n')
  }
  return ''
}

/**
 * Чи є в `on.push.paths` (або `on.pull_request.paths`) елемент з точним значенням.
 * @param {Record<string, unknown>} root корінь workflow
 * @param {'push' | 'pull_request'} event ім’я ключа в `on`
 * @param {string} exact очікуваний glob
 * @returns {boolean} `true`, якщо шлях присутній у масиві `paths`
 */
export function eventPathsIncludeExact(root, event, exact) {
  const on = root?.on
  if (!on || typeof on !== 'object') {
    return false
  }
  const ev = /** @type {Record<string, unknown>} */ (on)[event]
  if (!ev || typeof ev !== 'object') {
    return false
  }
  const paths = /** @type {Record<string, unknown>} */ (ev).paths
  if (!Array.isArray(paths)) {
    return false
  }
  return paths.includes(exact)
}

/**
 * Перевірки для `lint-js.yml`: checkout@v6, persist-credentials, setup-bun-deps, run-команди.
 * @param {Record<string, unknown> | null} root корінь workflow або `null` якщо parse не вдався
 * @returns {{ ok: boolean, failures: string[] }} результат перевірки та список причин відмови
 */
export function verifyLintJsWorkflowStructure(root) {
  /** @type {string[]} */
  const failures = []
  if (!root) {
    return { ok: false, failures: ['YAML не вдалося розібрати — перевір синтаксис workflow'] }
  }

  const steps = flattenWorkflowSteps(root)
  const usesList = steps.map(s => getStepUses(s.step))
  const runBlob = steps.map(s => getStepRun(s.step)).join('\n')

  if (!usesList.some(u => u.includes(CHECKOUT_V6_USES))) {
    failures.push('немає кроку uses: actions/checkout@v6')
  }

  if (!hasCheckoutWithPersistCredentialsFalse(steps)) {
    failures.push('checkout@v6 без with.persist-credentials: false')
  }

  if (!usesList.some(u => u.includes(LOCAL_SETUP_BUN_DEPS_MARKER))) {
    failures.push('немає uses: ./.github/actions/setup-bun-deps')
  }

  if (!runBlob.includes('bunx oxlint')) {
    failures.push('у run немає bunx oxlint')
  }
  if (!runBlob.includes('bunx eslint .')) {
    failures.push('у run немає bunx eslint .')
  }
  if (!runBlob.includes('bunx jscpd .')) {
    failures.push('у run немає bunx jscpd .')
  }

  appendCiFixFlagFailures(failures, steps)

  return failures.length === 0 ? { ok: true, failures: [] } : { ok: false, failures }
}

/**
 * Чи є в будь-якому `run` кроку підрядок (наприклад `n-cursor lint text --read-only`).
 * @param {Record<string, unknown>} root корінь workflow
 * @param {string} needle підрядок для пошуку
 * @returns {boolean} `true`, якщо хоча б один `run` містить `needle`
 */
export function anyRunStepIncludes(root, needle) {
  for (const { step } of flattenWorkflowSteps(root)) {
    if (getStepRun(step).includes(needle)) {
      return true
    }
  }
  return false
}

/**
 * Повертає jobs як список пар [jobId, job], якщо структура валідна.
 * @param {Record<string, unknown>} root корінь workflow
 * @returns {[string, Record<string, unknown>][]} список jobs
 */
function workflowJobsEntries(root) {
  const jobs = root?.jobs
  if (!jobs || typeof jobs !== 'object') {
    return []
  }
  return Object.entries(jobs).flatMap(([jobId, job]) =>
    job && typeof job === 'object' ? [[jobId, /** @type {Record<string, unknown>} */ (job)]] : []
  )
}

/**
 * Повертає валідні кроки job.
 * @param {Record<string, unknown>} job job-об’єкт
 * @returns {Record<string, unknown>[]} кроки job
 */
function workflowJobSteps(job) {
  const steps = /** @type {{ steps?: unknown }} */ (job).steps
  if (!Array.isArray(steps)) {
    return []
  }
  return steps.flatMap(step =>
    step && typeof step === 'object' ? [/** @type {Record<string, unknown>} */ (step)] : []
  )
}

/**
 * Чи є checkout@v6 з `persist-credentials: false`.
 * @param {{ step: Record<string, unknown> }[]} steps кроки flattenWorkflowSteps
 * @returns {boolean} true, якщо знайдено очікуваний checkout
 */
function hasCheckoutWithPersistCredentialsFalse(steps) {
  for (const { step } of steps) {
    const uses = getStepUses(step)
    if (uses.includes(CHECKOUT_V6_USES)) {
      const withObj = step.with
      if (
        withObj &&
        typeof withObj === 'object' &&
        /** @type {Record<string, unknown>} */ (withObj)['persist-credentials'] === false
      ) {
        return true
      }
    }
  }
  return false
}

/**
 * Додає порушення для `--fix` у CI-кроках lint-js workflow.
 * @param {string[]} failures акумулятор порушень
 * @param {{ step: Record<string, unknown> }[]} steps кроки flattenWorkflowSteps
 * @returns {void}
 */
function appendCiFixFlagFailures(failures, steps) {
  for (const { step } of steps) {
    const run = getStepRun(step)
    if (BUNX_OXLINT_FIX_RE.test(run)) {
      failures.push('у run є oxlint з --fix (у CI заборонено)')
    }
    if (run.includes('eslint --fix')) {
      failures.push('у run є eslint --fix (у CI заборонено)')
    }
  }
}

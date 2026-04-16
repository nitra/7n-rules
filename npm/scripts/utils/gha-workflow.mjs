/**
 * Допоміжні функції для аналізу GitHub Actions workflow (`.yml`) після структурного розбору YAML.
 *
 * Використовується в check-ga, check-js-lint, check-text, check-style-lint, check-npm-module замість
 * пошуку підрядків у сирому тексті там, де важливі лише значення `uses:` та `run:` кроків.
 */
import { parse } from 'yaml'

const CHECKOUT_USES_MARKER = 'actions/checkout@'
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
 * Чи є крок, у якого `uses` містить будь-який з підрядків.
 * @param {Record<string, unknown>} root корінь workflow
 * @param {string[]} substrings підрядки для пошуку в `uses`
 * @returns {boolean} `true`, якщо знайдено хоча б один збіг
 */
export function hasAnyStepUsesContaining(root, substrings) {
  for (const { step } of flattenWorkflowSteps(root)) {
    const uses = getStepUses(step)
    if (substrings.some(s => uses.includes(s))) {
      return true
    }
  }
  return false
}

/**
 * Чи перед першим кроком з локальним `setup-bun-deps` у кожному job є `actions/checkout@`.
 * Якщо `setup-bun-deps` у файлі немає — `true`.
 * @param {Record<string, unknown>} root корінь workflow
 * @param {string[]} setupPathSubstrings підрядки `uses`, що означають локальний composite (наприклад `./.github/actions/setup-bun-deps`)
 * @returns {boolean} `false`, якщо є setup без попереднього checkout
 */
export function hasCheckoutBeforeLocalSetupBunDeps(root, setupPathSubstrings) {
  for (const [, job] of workflowJobsEntries(root)) {
    let hasCheckoutStep = false
    for (const step of workflowJobSteps(job)) {
      const uses = getStepUses(step)
      if (uses.includes(CHECKOUT_USES_MARKER)) {
        hasCheckoutStep = true
      }
      if (setupPathSubstrings.some(s => uses.includes(s)) && !hasCheckoutStep) {
        return false
      }
    }
  }
  return true
}

/**
 * Шукає заборонені підрядки лише в `uses` та `run` кроків (не в коментарях YAML поза кроками).
 * @param {Record<string, unknown>} root корінь workflow
 * @param {{ pattern: string, msg: string }[]} forbidden список заборонених фрагментів і повідомлень
 * @returns {{ jobId: string, stepIndex: number, pattern: string, msg: string }[]} знайдені збіги
 */
export function findForbiddenUsesOrRunPatterns(root, forbidden) {
  /** @type {{ jobId: string, stepIndex: number, pattern: string, msg: string }[]} */
  const hits = []
  for (const { jobId, stepIndex, step } of flattenWorkflowSteps(root)) {
    const uses = getStepUses(step)
    const run = getStepRun(step)
    const blob = `${uses}\n${run}`
    for (const { pattern, msg } of forbidden) {
      if (blob.includes(pattern)) {
        hits.push({ jobId, stepIndex, pattern, msg })
      }
    }
  }
  return hits
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
 * Чи містить `on.push.paths` підрядок `npm/**` (npm-module).
 * @param {Record<string, unknown>} root корінь workflow
 * @returns {boolean} `true`, якщо серед `paths` є рядок з `npm/**`
 */
export function pushPathsIncludeNpmGlob(root) {
  const on = root?.on
  if (!on || typeof on !== 'object') {
    return false
  }
  const push = /** @type {Record<string, unknown>} */ (on).push
  if (!push || typeof push !== 'object') {
    return false
  }
  const paths = push.paths
  if (!Array.isArray(paths)) {
    return false
  }
  return paths.some(p => typeof p === 'string' && p.includes('npm/**'))
}

/**
 * Перевіряє наявність `branches` з `main` у `on.push`.
 * @param {Record<string, unknown>} root корінь workflow
 * @returns {boolean} `true`, якщо `main` є в `on.push.branches`
 */
export function pushHasMainBranch(root) {
  const on = root?.on
  if (!on || typeof on !== 'object') {
    return false
  }
  const push = /** @type {Record<string, unknown>} */ (on).push
  if (!push || typeof push !== 'object') {
    return false
  }
  const branches = push.branches
  if (!Array.isArray(branches)) {
    return false
  }
  return branches.includes('main')
}

/**
 * Чи є крок з `uses: JS-DevTools/npm-publish` та `with.package` для npm-пакета.
 * @param {Record<string, unknown>} root корінь workflow
 * @returns {boolean} `true`, якщо знайдено крок publish з `package: npm/package.json`
 */
export function hasNpmPublishStepWithPackage(root) {
  for (const { step } of flattenWorkflowSteps(root)) {
    const uses = getStepUses(step)
    if (uses.includes('JS-DevTools/npm-publish')) {
      const w = step.with
      if (w && typeof w === 'object' && /** @type {Record<string, unknown>} */ (w).package === 'npm/package.json') {
        return true
      }
    }
  }
  return false
}

/**
 * Чи є у job `permissions.id-token: write`.
 * @param {Record<string, unknown>} root корінь workflow
 * @returns {boolean} `true`, якщо OIDC-дозвіл для npm publish налаштований
 */
export function hasIdTokenWritePermission(root) {
  const jobs = root?.jobs
  if (!jobs || typeof jobs !== 'object') {
    return false
  }
  for (const job of Object.values(jobs)) {
    if (job && typeof job === 'object') {
      const perm = /** @type {Record<string, unknown>} */ (job).permissions
      if (perm && typeof perm === 'object' && /** @type {Record<string, unknown>} */ (perm)['id-token'] === 'write') {
        return true
      }
    }
  }
  return false
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
 * Чи є в будь-якому `run` кроку підрядок (наприклад `bun run lint-text`).
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
 * Чи викликається stylelint у workflow через `npx stylelint` у кроці `run` (вимога для CI).
 * @param {Record<string, unknown>} root корінь workflow
 * @returns {boolean} `true`, якщо умова виконана
 */
export function anyRunStepIncludesStylelint(root) {
  return anyRunStepIncludes(root, 'npx stylelint')
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
  return steps.flatMap(step => (step && typeof step === 'object' ? [/** @type {Record<string, unknown>} */ (step)] : []))
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

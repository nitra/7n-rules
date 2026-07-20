/**
 * T0-автоміграція GA deploy-workflow до сервіс-канону (ADR 260718-0835) —
 * дзеркало fix-service_deploy_pipeline (ci-azure) для GitHub Actions.
 *
 * Детермінований переписувач `.github/workflows/deploy-*.yml`, що НЕ
 * відповідають формі plan → lint-<domain> → deploy (порушення rego-концерну
 * service_deploy_workflow):
 *
 * - додає job `plan` (checkout fetch-depth: 0 + prep + `bunx n-rules ci plan
 *   --path <svc> --github` з `id: plan`) і **outputs-мапінг** доменів + `any`
 *   (без нього гейти `needs.plan.outputs.*` порожні в runtime);
 * - легасі job із `n-rules lint --path <svc>` (без домену) замінюється на
 *   per-domain джоби lint-<domain> — домени по файлах піддерева сервісу, ті
 *   самі glob-и, що `ci plan` (computeActiveDomains/domainKey);
 * - domain-style lint-джоби добираються wiring-ом (needs: plan, if по outputs,
 *   `--no-fix`, fetch-depth: 0, prep);
 * - `needs` інших джоб перешивається з легасі-імені; джоби з прямими needs на
 *   умовні lint-джоби без власного `if` отримують Skipped-толерантний канон
 *   (`!cancelled()` + `!contains(needs.*.result, 'failure')`).
 *
 * `bootstrap: true` (окремий опт-ін, НЕ частина звичайного fix-режиму) —
 * для deploy-workflow без жодної lint-джоби створює lint-<domain> джоби з
 * нуля (за `relevantDomains` піддерева сервісу) і підключає безумовну
 * вхідну джобу (без `needs`) до plan + усіх нових lint-джоб. Концерн явно
 * не вимагає цього автоматично (публікація без лінту валідна as-is) — це
 * механічне виконання свідомого рішення перейти на гейт.
 *
 * Мутації — через `yaml` Document API (jobs у GA — мапа, не послідовність):
 * коментарі та форматування незачеплених частин зберігаються. Наявний
 * нетривіальний `if` не перезаписується (deny лишається — ручне рішення).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

import { parseDocument } from 'yaml'

import { domainKey, parseNRulesCmd, relevantDomains } from '@7n/rules/scripts/lib/lint-surface/ci-plan.mjs'

const GLOB_SUFFIX_RE = /\/\*+$/u

const CANONICAL_DEPLOY_IF = `\${{ !cancelled() && needs.plan.result == 'success' && !contains(needs.*.result, 'failure') && !contains(needs.*.result, 'cancelled') }}`

/** Канонічні prep-кроки нової джоби (checkout повної глибини + bun-залежності). */
const CANONICAL_PREP = [
  { uses: 'actions/checkout@v6', with: { 'persist-credentials': false, 'fetch-depth': 0 } },
  { uses: './.github/actions/setup-bun-deps' }
]

/**
 * Текст run-кроку ('' якщо крок не run).
 * @param {unknown} step крок джоби (plain JS)
 * @returns {string} команда або ''
 */
function stepRun(step) {
  if (!step || typeof step !== 'object') return ''
  const r = /** @type {Record<string, unknown>} */ (step).run
  return typeof r === 'string' ? r : ''
}

/**
 * needs джоби як масив імен.
 * @param {Record<string, unknown>} job джоба (plain JS)
 * @returns {string[]} імена залежностей
 */
function needsOf(job) {
  const n = job.needs
  if (typeof n === 'string') return [n]
  if (Array.isArray(n)) return n.filter(x => typeof x === 'string')
  return []
}

/**
 * Розбір lint-кроку джоби.
 * @param {Array<Record<string, unknown>>} steps кроки джоби (plain JS)
 * @returns {{ legacy: boolean, domain: string|null, path: string|null, stepIndex: number }|null} розбір
 */
function findLintStep(steps) {
  for (const [i, step] of steps.entries()) {
    const parsed = parseNRulesCmd(stepRun(step), 'n-rules lint')
    if (!parsed || parsed.path === null) continue
    return { legacy: parsed.domain === null, domain: parsed.domain, path: parsed.path, stepIndex: i }
  }
  return null
}

/**
 * Prep-кроки для нових джоб: зразок із наявної джоби з `setup-bun-deps`
 * (кроки до нього включно, checkout → fetch-depth: 0), інакше — канонічні.
 * @param {Array<Record<string, unknown>>} jobs джоби (plain JS)
 * @returns {Array<Record<string, unknown>>} prep-кроки (глибока копія)
 */
function derivePrepSteps(jobs) {
  for (const job of jobs) {
    const steps = Array.isArray(job.steps) ? job.steps : []
    const idx = steps.findIndex(s => s && typeof s === 'object' && s.uses === './.github/actions/setup-bun-deps')
    if (idx === -1) continue
    const prep = structuredClone(steps.slice(0, idx + 1))
    const checkout = prep.find(s => typeof s.uses === 'string' && s.uses.startsWith('actions/checkout@'))
    if (checkout) {
      checkout.with = { ...checkout.with, 'fetch-depth': 0 }
    } else {
      prep.unshift(structuredClone(CANONICAL_PREP[0]))
    }
    return prep
  }
  return structuredClone(CANONICAL_PREP)
}

/**
 * Джоби документа як [name, job] (plain JS); GA jobs — мапа.
 * @param {import('yaml').Document} doc YAML-документ
 * @returns {Array<[string, Record<string, unknown>]>} пари імʼя→джоба
 */
function jobEntries(doc) {
  const js = doc.toJS() ?? {}
  const jobs = js.jobs
  if (!jobs || typeof jobs !== 'object' || Array.isArray(jobs)) return []
  return Object.entries(jobs).filter(([, j]) => j && typeof j === 'object')
}

/**
 * Сервісний каталог workflow: із plan-джоби → з легасі lint-джоби →
 * з `on.push.paths` (glob-суфікс зрізається).
 * @param {import('yaml').Document} doc YAML-документ
 * @param {Array<[string, Record<string, unknown>]>} entries пари імʼя→джоба
 * @returns {string|null} каталог сервісу або null
 */
function resolveServicePath(doc, entries) {
  for (const [, job] of entries) {
    for (const step of Array.isArray(job.steps) ? job.steps : []) {
      const p = parseNRulesCmd(stepRun(step), 'n-rules ci plan')?.path
      if (p) return p
    }
  }
  for (const [, job] of entries) {
    const found = findLintStep(Array.isArray(job.steps) ? job.steps : [])
    if (found?.path) return found.path
  }
  const js = doc.toJS() ?? {}
  const on = js.on ?? js.true ?? {}
  const paths = on?.push?.paths
  if (!Array.isArray(paths)) return null
  return (
    paths
      .filter(p => typeof p === 'string')
      .map(p => p.replace(GLOB_SUFFIX_RE, ''))
      .find(p => p !== '' && !p.includes('*')) ?? null
  )
}

/**
 * Крок 1: вставляє job `plan` (з outputs-мапінгом доменів + any) першим у jobs.
 * @param {import('yaml').Document} doc документ (мутується)
 * @param {string[]} domains релевантні домени
 * @param {Array<Record<string, unknown>>} prep prep-кроки
 * @param {string} servicePath каталог сервісу
 * @returns {void}
 */
function insertPlanJob(doc, domains, prep, servicePath) {
  /** @type {Record<string, string>} */
  const outputs = {}
  for (const d of domains) outputs[domainKey(d)] = `\${{ steps.plan.outputs.${domainKey(d)} }}`
  outputs.any = `\${{ steps.plan.outputs.any }}`
  const planJob = {
    'runs-on': 'ubuntu-latest',
    permissions: { contents: 'read' },
    outputs,
    steps: [...structuredClone(prep), { id: 'plan', run: `bunx n-rules ci plan --path ${servicePath} --github` }]
  }
  const jobsMap = doc.getIn(['jobs'])
  jobsMap.items.unshift(doc.createNode({ plan: planJob }).items[0])
}

/**
 * Нова per-domain lint-джоба канону (пара [імʼя, джоба]).
 * @param {string} domain rule-id домену
 * @param {string} servicePath каталог сервісу
 * @param {Array<Record<string, unknown>>} prep prep-кроки
 * @returns {[string, Record<string, unknown>]} пара для jobs-мапи
 */
function buildLintJob(domain, servicePath, prep) {
  const key = domainKey(domain)
  return [
    `lint-${key}`,
    {
      needs: 'plan',
      if: `needs.plan.outputs.${key} == 'true'`,
      'runs-on': 'ubuntu-latest',
      permissions: { contents: 'read' },
      steps: [...structuredClone(prep), { run: `bunx n-rules lint ${domain} --path ${servicePath} --no-fix` }]
    }
  ]
}

/**
 * Крок 2: замінює легасі lint-джоби на per-domain джоби (in-place у мапі jobs).
 * @param {import('yaml').Document} doc документ (мутується)
 * @param {string[]} legacyNames імена легасі-джоб
 * @param {string[]} domains релевантні домени
 * @param {string} servicePath каталог сервісу
 * @param {Array<Record<string, unknown>>} prep prep-кроки
 * @returns {Map<string, string[]>} легасі-імʼя → нові імена
 */
function replaceLegacyJobs(doc, legacyNames, domains, servicePath, prep) {
  /** @type {Map<string, string[]>} */
  const renames = new Map()
  const jobsMap = doc.getIn(['jobs'])
  for (const legacyName of legacyNames) {
    const idx = jobsMap.items.findIndex(pair => pair?.key?.toString?.() === legacyName)
    if (idx === -1) continue
    const newPairs = domains.map(d => buildLintJob(d, servicePath, prep))
    const nodes = newPairs.map(([name, job]) => doc.createNode({ [name]: job }).items[0])
    jobsMap.items.splice(idx, 1, ...nodes)
    renames.set(
      legacyName,
      newPairs.map(([name]) => name)
    )
  }
  return renames
}

/**
 * Крок 3 (одна джоба): wiring domain-style lint-джоби (needs/if/--no-fix/fetch-depth/prep).
 * @param {import('yaml').Document} doc документ (мутується)
 * @param {string} name імʼя джоби
 * @param {Record<string, unknown>} j джоба (plain JS)
 * @param {{ domain: string|null, stepIndex: number }} found розбір lint-кроку
 * @returns {boolean} чи були зміни
 */
function patchDomainLintJob(doc, name, j, found) {
  let changed = false
  const base = ['jobs', name]
  const steps = Array.isArray(j.steps) ? j.steps : []
  if (needsOf(j).length === 0) {
    doc.setIn([...base, 'needs'], 'plan')
    changed = true
  }
  if (typeof j.if !== 'string' && found.domain) {
    doc.setIn([...base, 'if'], `needs.plan.outputs.${domainKey(found.domain)} == 'true'`)
    changed = true
  }
  const cmd = stepRun(steps[found.stepIndex])
  if (!cmd.includes('--no-fix')) {
    doc.setIn([...base, 'steps', found.stepIndex, 'run'], `${cmd.trimEnd()} --no-fix`)
    changed = true
  }
  const checkoutIdx = steps.findIndex(s => typeof s?.uses === 'string' && s.uses.startsWith('actions/checkout@'))
  if (checkoutIdx !== -1 && steps[checkoutIdx]?.with?.['fetch-depth'] !== 0) {
    doc.setIn([...base, 'steps', checkoutIdx, 'with', 'fetch-depth'], 0)
    changed = true
  }
  return changed
}

/**
 * Вставляє нові lint-<domain> джоби одразу після `plan` у мапі jobs.
 * @param {import('yaml').Document} doc документ (мутується)
 * @param {Array<[string, Record<string, unknown>]>} newPairs пари [імʼя, джоба]
 * @returns {void}
 */
function insertLintJobsAfterPlan(doc, newPairs) {
  const jobsMap = doc.getIn(['jobs'])
  const nodes = newPairs.map(([name, job]) => doc.createNode({ [name]: job }).items[0])
  const planIdx = jobsMap.items.findIndex(pair => pair?.key?.toString?.() === 'plan')
  jobsMap.items.splice(planIdx === -1 ? 0 : planIdx + 1, 0, ...nodes)
}

/**
 * Bootstrap-крок (лише коли `bootstrap: true`): джоба без жодного `needs` —
 * кандидат «вхідної/термінальної» джоби деплою без вбудованого лінту (напр.
 * `run-auth.yml`, де один job одразу збирає образ і виконує деплой). Підключає її до
 * plan + усіх lint-джоб зі Skipped-толерантним `if` (свідомий перехід на
 * гейт — концерн НЕ вимагає цього автоматично, bootstrap лише виконує рішення,
 * вже ухвалене людиною командою запуску).
 * @param {import('yaml').Document} doc документ (мутується)
 * @param {string} name імʼя джоби
 * @param {Record<string, unknown>} j джоба (plain JS)
 * @param {Set<string>} lintJobNames множина всіх lint-джоб
 * @returns {boolean} чи були зміни
 */
function wireEntryJob(doc, name, j, lintJobNames) {
  if (needsOf(j).length > 0) return false
  if (lintJobNames.size === 0) return false
  const base = ['jobs', name]
  const deps = ['plan', ...[...lintJobNames].toSorted()]
  doc.setIn([...base, 'needs'], doc.createNode(deps))
  doc.setIn([...base, 'if'], CANONICAL_DEPLOY_IF)
  return true
}

/**
 * Bootstrap-крок: домени сервісу, для яких ще немає per-domain lint-джоби,
 * отримують нову джобу з нуля (одразу після `plan`).
 * @param {import('yaml').Document} doc документ (мутується)
 * @param {string[]} domains релевантні домени сервісу
 * @param {string} servicePath каталог сервісу
 * @param {Array<Record<string, unknown>>} prep prep-кроки
 * @returns {boolean} чи були зміни
 */
function bootstrapMissingLintJobs(doc, domains, servicePath, prep) {
  const covered = new Set()
  for (const [name, j] of jobEntries(doc)) {
    if (name === 'plan') continue
    const found = findLintStep(Array.isArray(j.steps) ? j.steps : [])
    if (found && !found.legacy && found.domain) covered.add(found.domain)
  }
  const missing = domains.filter(d => !covered.has(d))
  if (missing.length === 0) return false
  insertLintJobsAfterPlan(
    doc,
    missing.map(d => buildLintJob(d, servicePath, prep))
  )
  return true
}

/**
 * Дописує wiring для всіх наявних domain-style lint-джоб (needs/if/no-fix/fetch-depth)
 * і збирає повну множину імен lint-джоб (renames + вже канонічні + bootstrap-нові).
 * @param {import('yaml').Document} doc документ (мутується)
 * @param {Map<string, string[]>} renames легасі-імʼя → нові lint-джоби
 * @returns {{ lintJobNames: Set<string>, changed: boolean }} множина lint-джоб і прапорець змін
 */
function patchAllDomainLintJobs(doc, renames) {
  const lintJobNames = new Set(renames.values().toArray().flat())
  let changed = false
  for (const [name, j] of jobEntries(doc)) {
    if (name === 'plan') continue
    const found = findLintStep(Array.isArray(j.steps) ? j.steps : [])
    if (!found || found.legacy) continue
    lintJobNames.add(name)
    if (patchDomainLintJob(doc, name, j, found)) changed = true
  }
  return { lintJobNames, changed }
}

/**
 * Перешиває needs/if усіх джоб, що не є lint: легасі-перейменування (завжди) і,
 * за bootstrap, підключення безумовних вхідних джоб до plan + lint.
 * @param {import('yaml').Document} doc документ (мутується)
 * @param {Map<string, string[]>} renames легасі-імʼя → нові lint-джоби
 * @param {Set<string>} lintJobNames множина всіх lint-джоб
 * @param {boolean} bootstrap чи дозволено підключати безумовні вхідні джоби
 * @returns {boolean} чи були зміни
 */
function rewireAllJobs(doc, renames, lintJobNames, bootstrap) {
  let changed = false
  for (const [name, j] of jobEntries(doc)) {
    if (name === 'plan' || lintJobNames.has(name)) continue
    const rewired = rewireOneJob(doc, name, j, renames, lintJobNames)
    const bootstrapped = !rewired && bootstrap && wireEntryJob(doc, name, j, lintJobNames)
    if (rewired || bootstrapped) changed = true
  }
  return changed
}

/**
 * Крок 4 (одна джоба): перешивка needs (легасі → нові) + Skipped-толерантний if.
 * @param {import('yaml').Document} doc документ (мутується)
 * @param {string} name імʼя джоби
 * @param {Record<string, unknown>} j джоба (plain JS)
 * @param {Map<string, string[]>} renames легасі-імʼя → нові lint-джоби
 * @param {Set<string>} lintJobNames множина всіх lint-джоб
 * @returns {boolean} чи були зміни
 */
function rewireOneJob(doc, name, j, renames, lintJobNames) {
  let deps = needsOf(j)
  if (deps.length === 0) return false
  let changed = false
  const base = ['jobs', name]
  const expanded = deps.flatMap(d => renames.get(d) ?? [d])
  if (JSON.stringify(expanded) !== JSON.stringify(deps)) {
    doc.setIn([...base, 'needs'], doc.createNode(expanded))
    deps = expanded
    changed = true
  }
  const touchesLint = deps.some(d => lintJobNames.has(d))
  if (touchesLint && typeof j.if !== 'string') {
    const withPlan = deps.includes('plan') ? deps : ['plan', ...deps]
    if (!deps.includes('plan')) doc.setIn([...base, 'needs'], doc.createNode(withPlan))
    doc.setIn([...base, 'if'], CANONICAL_DEPLOY_IF)
    changed = true
  }
  return changed
}

/**
 * Мігрує один deploy-workflow до канону. Повертає true, якщо файл змінено.
 *
 * `bootstrap: true` — свідоме розширення поза звичайним fix-режимом: для
 * deploy-workflow БЕЗ жодної lint-джоби (валідний as-is за рего-концерном,
 * деталі — service_deploy_workflow.rego) створює lint-<domain> джоби з нуля
 * (за `relevantDomains` піддерева сервісу) і підключає вхідну/термінальну
 * джобу без `needs` до plan + усіх lint-джоб. Це саме «свідоме рішення
 * перейти на гейт», про яке говорить коментар концерну — bootstrap лише
 * виконує його механічно, а не ухвалює автоматично (звичайний
 * `n-rules lint --fix` bootstrap не викликає: patterns[0].apply завжди
 * викликається без bootstrap).
 * @param {string} absPath абсолютний шлях workflow-файлу
 * @param {string} cwd корінь consumer-репо
 * @param {{ bootstrap?: boolean }} [opts] `bootstrap: true` — додати lint-джоби з нуля
 * @returns {Promise<boolean>} чи були зміни
 */
export async function migrateWorkflowFile(absPath, cwd, opts = {}) {
  const { bootstrap = false } = opts
  const prevText = readFileSync(absPath, 'utf8')
  let doc
  try {
    doc = parseDocument(prevText)
  } catch {
    return false
  }
  const entries = jobEntries(doc)
  if (entries.length === 0) return false
  const servicePath = resolveServicePath(doc, entries)
  if (servicePath === null) return false

  const hasPlan = entries.some(([name]) => name === 'plan')
  const legacyNames = entries
    .filter(([name, j]) => name !== 'plan' && findLintStep(Array.isArray(j.steps) ? j.steps : [])?.legacy)
    .map(([name]) => name)
  const hasAnyLintStep = entries.some(
    ([name, j]) => name !== 'plan' && findLintStep(Array.isArray(j.steps) ? j.steps : []) !== null
  )
  // Workflow без plan і без жодного lint-кроку — концерн вважає його valid
  // as-is (публікація без гейта — свідоме рішення). Чіпати лише за bootstrap.
  if (!hasPlan && !hasAnyLintStep && !bootstrap) return false

  const jobsPlain = entries.map(([, j]) => j)
  const prep = derivePrepSteps(jobsPlain)
  const domains = await relevantDomains(cwd, servicePath)
  let changed = false

  if (!hasPlan) {
    insertPlanJob(doc, domains, prep, servicePath)
    changed = true
  }
  const renames = replaceLegacyJobs(doc, legacyNames, domains, servicePath, prep)
  if (renames.size > 0) changed = true

  if (bootstrap && bootstrapMissingLintJobs(doc, domains, servicePath, prep)) changed = true

  const { lintJobNames, changed: patched } = patchAllDomainLintJobs(doc, renames)
  if (patched) changed = true
  if (rewireAllJobs(doc, renames, lintJobNames, bootstrap)) changed = true

  if (!changed) return false
  writeFileSync(absPath, doc.toString())
  return true
}

export const patterns = [
  {
    id: 'ga-service-workflow-canon-migrate',
    test: violations => violations.length > 0,
    async apply(violations, ctx) {
      const files = [...new Set(violations.map(v => v.file).filter(Boolean))]
      const touched = []
      for (const rel of files) {
        const abs = join(ctx.cwd, rel)
        if (!existsSync(abs)) continue
        try {
          if (await migrateWorkflowFile(abs, ctx.cwd)) touched.push(abs)
        } catch {
          // міграція конкретного файлу не вдалася — лишаємо deny детектору (fail-open до ручного фіксу)
        }
      }
      return {
        touchedFiles: touched,
        message: touched.length > 0 ? `мігровано до сервіс-канону: ${touched.length} workflow(ів)` : null
      }
    }
  }
]

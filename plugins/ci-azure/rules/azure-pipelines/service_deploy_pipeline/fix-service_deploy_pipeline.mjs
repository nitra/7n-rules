/**
 * T0-автоміграція легасі сервіс-pipeline-ів до сервіс-канону (ADR 260718-0835).
 *
 * Детермінований переписувач `.azurepipelines/**.yml` із `trigger.paths.include`,
 * що НЕ відповідають формі plan → lint_<domain> → deploy (порушення rego-концерну
 * service_deploy_pipeline). Семантика `lint --path` змінилась у `@7n/rules` 1.17
 * (перетин із git-дельтою) без major-бампа — замість ручної міграції консюмерів
 * (efes: 18 пайплайнів) фікс переводить pipeline одразу в новий канон:
 *
 * - додає job `plan` (prep + `bunx n-rules ci plan --path <svc> --azure`, name: plan);
 * - легасі job із `n-rules lint --path <svc>` (без домену) замінюється на
 *   per-domain джоби lint_<key> — домени визначаються по ФАЙЛАХ піддерева сервісу
 *   тими самими glob-ами, що й `ci plan` (computeActiveDomains/domainKey);
 * - domain-style lint-джоби добираються wiring-ом (dependsOn: plan, condition по
 *   outputs, `--no-fix`, fetchDepth: 0);
 * - dependsOn інших джоб перешивається з легасі-імені на нові lint-джоби; джоби
 *   з прямими deps на умовні lint-джоби без власного condition отримують
 *   Skipped-толерантний канон (`not(canceled())` + `in(…, 'Succeeded', 'Skipped')`).
 *
 * Мутації — через `yaml` Document API (setIn/splice item-ів), щоб зберегти
 * коментарі та форматування незачеплених частин. Наявний нетривіальний
 * `condition` НЕ перезаписується (rego лишає deny → ручне рішення автора).
 * Template-розкладка (`- template:`) не мігрується — фіксеру не видно
 * розгорнутих джоб.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

import { parseDocument } from 'yaml'

import { domainKey, parseNRulesCmd, relevantDomains } from '@7n/rules/scripts/lib/lint-surface/ci-plan.mjs'

const GLOB_SUFFIX_RE = /\/\*+$/u

/** Канонічні prep-кроки, якщо в pipeline немає власного зразка. */
const CANONICAL_PREP = [
  { checkout: 'self', fetchDepth: 0 },
  {
    script: 'curl -fsSL https://bun.sh/install | bash\necho "##vso[task.prependpath]$HOME/.bun/bin"\n',
    displayName: 'Install bun'
  },
  { script: 'bun install --frozen-lockfile', displayName: 'Install deps' }
]

/**
 * Текст команди кроку (`script:`, `bash:` або task-форма `inputs.script`),
 * '' якщо крок не командний.
 * @param {unknown} step крок джоби (plain JS)
 * @returns {string} команда або ''
 */
function stepCmd(step) {
  if (!step || typeof step !== 'object') return ''
  const s = /** @type {Record<string, unknown>} */ (step)
  if (typeof s.script === 'string') return s.script
  if (typeof s.bash === 'string') return s.bash
  const inputs = s.inputs
  if (
    inputs &&
    typeof inputs === 'object' &&
    typeof (/** @type {Record<string, unknown>} */ (inputs).script) === 'string'
  ) {
    return /** @type {string} */ (/** @type {Record<string, unknown>} */ (inputs).script)
  }
  return ''
}

/**
 * Шлях-суфікс до тексту команди всередині кроку (для `setIn`): `['script']`,
 * `['bash']` або `['inputs', 'script']` (task-форма).
 * @param {Record<string, unknown>} step крок джоби (plain JS)
 * @returns {string[]} суфікс шляху
 */
function stepCmdPath(step) {
  if (typeof step.script === 'string') return ['script']
  if (typeof step.bash === 'string') return ['bash']
  return ['inputs', 'script']
}

/**
 * Prep-кроки для нових джоб: зразок із першої джоби, що робить
 * `bun install` (кроки від початку до нього включно, checkout → fetchDepth: 0),
 * інакше — канонічний блок.
 * @param {Array<Record<string, unknown>>} jobs всі джоби pipeline (plain JS)
 * @returns {Array<Record<string, unknown>>} prep-кроки (plain JS, глибока копія)
 */
function derivePrepSteps(jobs) {
  for (const job of jobs) {
    const steps = Array.isArray(job.steps) ? job.steps : []
    const idx = steps.findIndex(s => stepCmd(s).includes('bun install'))
    if (idx === -1) continue
    const prep = structuredClone(steps.slice(0, idx + 1))
    const checkout = prep.find(s => s && typeof s === 'object' && 'checkout' in s)
    if (checkout) checkout.fetchDepth = 0
    else prep.unshift({ checkout: 'self', fetchDepth: 0 })
    return prep
  }
  return structuredClone(CANONICAL_PREP)
}

/**
 * Збирає всі jobs-послідовності документа: корінь `jobs` і `stages[i].jobs`.
 * @param {import('yaml').Document} doc YAML-документ
 * @returns {Array<{ path: Array<string|number>, items: unknown[] }>} шляхи та plain-JS елементи
 */
function collectJobSeqs(doc) {
  const out = []
  const js = doc.toJS() ?? {}
  if (Array.isArray(js.jobs)) out.push({ path: ['jobs'], items: js.jobs })
  if (Array.isArray(js.stages)) {
    for (const [i, stage] of js.stages.entries()) {
      if (stage && Array.isArray(stage.jobs)) out.push({ path: ['stages', i, 'jobs'], items: stage.jobs })
    }
  }
  return out
}

/**
 * dependsOn джоби як масив імен.
 * @param {Record<string, unknown>} job джоба (plain JS)
 * @returns {string[]} імена залежностей
 */
function dependsOf(job) {
  const d = job.dependsOn
  if (typeof d === 'string') return [d]
  if (Array.isArray(d)) return d.filter(x => typeof x === 'string')
  return []
}

/**
 * Канонічний Skipped-толерантний condition для джоби з прямими deps.
 * @param {string[]} deps імена прямих залежностей
 * @returns {string} вираз condition
 */
function skipTolerantCondition(deps) {
  const parts = ['not(canceled())']
  for (const d of deps) {
    if (d === 'plan') parts.push("eq(dependencies.plan.result, 'Succeeded')")
    else parts.push(`in(dependencies.${d}.result, 'Succeeded', 'Skipped')`)
  }
  return `and(${parts.join(', ')})`
}

/**
 * Нова per-domain lint-джоба канону.
 * @param {string} domain rule-id домену
 * @param {string} servicePath каталог сервісу
 * @param {Array<Record<string, unknown>>} prep prep-кроки
 * @returns {Record<string, unknown>} джоба (plain JS)
 */
function buildLintJob(domain, servicePath, prep) {
  const key = domainKey(domain)
  return {
    job: `lint_${key}`,
    dependsOn: 'plan',
    condition: `eq(dependencies.plan.outputs['plan.${key}'], 'true')`,
    steps: [
      ...structuredClone(prep),
      { script: `bunx n-rules lint ${domain} --path ${servicePath} --no-fix`, displayName: `Lint ${domain}` }
    ]
  }
}

/**
 * Розбір lint-команди джоби: `{ legacy, domain, path, stepIndex }` або null.
 * @param {Array<Record<string, unknown>>} steps кроки джоби (plain JS)
 * @returns {{ legacy: boolean, domain: string|null, path: string|null, stepIndex: number }|null} розбір
 */
function findLintStep(steps) {
  for (const [i, step] of steps.entries()) {
    const cmd = stepCmd(step)
    const parsed = parseNRulesCmd(cmd, 'n-rules lint')
    if (!parsed || parsed.path === null) continue
    return { legacy: parsed.domain === null, domain: parsed.domain, path: parsed.path, stepIndex: i }
  }
  return null
}

/**
 * Крок 1: вставляє job `plan` на початок першої jobs-послідовності (якщо немає).
 * @param {import('yaml').Document} doc документ (мутується)
 * @param {Array<{ path: Array<string|number> }>} seqs jobs-послідовності
 * @param {Array<Record<string, unknown>>} prep prep-кроки
 * @param {string} servicePath каталог сервісу
 * @returns {boolean} чи були зміни
 */
function ensurePlanJob(doc, seqs, prep, servicePath) {
  const planNode = doc.createNode({
    job: 'plan',
    steps: [...structuredClone(prep), { script: `bunx n-rules ci plan --path ${servicePath} --azure`, name: 'plan' }]
  })
  doc.getIn(seqs[0].path).items.unshift(planNode)
  return true
}

/**
 * Крок 2: замінює легасі lint-джоби на per-domain джоби у своїх послідовностях.
 * @param {import('yaml').Document} doc документ (мутується)
 * @param {Array<{ seq: { path: Array<string|number> }, job: Record<string, unknown> }>} legacy легасі-джоби
 * @param {string[]} domains релевантні домени сервісу
 * @param {string} servicePath каталог сервісу
 * @param {Array<Record<string, unknown>>} prep prep-кроки
 * @returns {{ renames: Map<string, string[]>, changed: boolean }} мапа перейменувань
 */
function replaceLegacyJobs(doc, legacy, domains, servicePath, prep) {
  /** @type {Map<string, string[]>} */
  const renames = new Map()
  let changed = false
  for (const { seq, job } of legacy) {
    const newJobs = domains.map(d => buildLintJob(d, servicePath, prep))
    const seqNode = doc.getIn(seq.path)
    const docIndex = seqNode.items.findIndex(item => item?.toJS?.(doc)?.job === job.job)
    if (docIndex === -1) continue
    seqNode.items.splice(docIndex, 1, ...newJobs.map(j => doc.createNode(j)))
    renames.set(
      job.job,
      newJobs.map(j => /** @type {string} */ (j.job))
    )
    changed = true
  }
  return { renames, changed }
}

/**
 * Крок 3 (одна джоба): добирає wiring domain-style lint-джоби —
 * dependsOn: plan, condition по outputs, `--no-fix`, fetchDepth: 0.
 * @param {import('yaml').Document} doc документ (мутується)
 * @param {Array<string|number>} base шлях джоби в документі
 * @param {Record<string, unknown>} j джоба (plain JS)
 * @param {{ domain: string|null, stepIndex: number }} found розбір lint-кроку
 * @returns {boolean} чи були зміни
 */
function patchDomainLintJob(doc, base, j, found) {
  let changed = false
  const steps = Array.isArray(j.steps) ? j.steps : []
  if (dependsOf(j).length === 0) {
    doc.setIn([...base, 'dependsOn'], 'plan')
    changed = true
  }
  if (typeof j.condition !== 'string' && found.domain) {
    doc.setIn([...base, 'condition'], `eq(dependencies.plan.outputs['plan.${domainKey(found.domain)}'], 'true')`)
    changed = true
  }
  const cmd = stepCmd(steps[found.stepIndex])
  if (!cmd.includes('--no-fix')) {
    doc.setIn([...base, 'steps', found.stepIndex, ...stepCmdPath(steps[found.stepIndex])], `${cmd.trimEnd()} --no-fix`)
    changed = true
  }
  const checkoutIdx = steps.findIndex(s => s && typeof s === 'object' && 'checkout' in s)
  if (checkoutIdx !== -1 && steps[checkoutIdx].fetchDepth !== 0) {
    doc.setIn([...base, 'steps', checkoutIdx, 'fetchDepth'], 0)
    changed = true
  }
  return changed
}

/**
 * Крок 3 (обхід): знаходить усі domain-style lint-джоби, добирає wiring і
 * доповнює множину імен lint-джоб.
 * @param {import('yaml').Document} doc документ (мутується)
 * @param {Array<{ path: Array<string|number> }>} seqs jobs-послідовності
 * @param {Set<string>} lintJobNames множина lint-джоб (мутується)
 * @returns {boolean} чи були зміни
 */
function patchDomainLintJobs(doc, seqs, lintJobNames) {
  let changed = false
  for (const seq of seqs) {
    const seqNode = doc.getIn(seq.path)
    for (const [i, itemNode] of seqNode.items.entries()) {
      const j = itemNode?.toJS?.(doc)
      if (!j || typeof j.job !== 'string' || j.job === 'plan') continue
      const found = findLintStep(Array.isArray(j.steps) ? j.steps : [])
      if (!found || found.legacy) continue
      lintJobNames.add(j.job)
      if (patchDomainLintJob(doc, [...seq.path, i], j, found)) changed = true
    }
  }
  return changed
}

/**
 * Крок 4: перешиває dependsOn (легасі-ім'я → нові джоби) і ставить
 * Skipped-толерантний condition джобам із прямими deps на умовні lint-джоби
 * (лише коли власного condition немає — нетривіальний не перезаписуємо).
 * @param {import('yaml').Document} doc документ (мутується)
 * @param {Array<{ path: Array<string|number> }>} seqs jobs-послідовності
 * @param {Map<string, string[]>} renames легасі-ім'я → нові lint-джоби
 * @param {Set<string>} lintJobNames множина всіх lint-джоб
 * @returns {boolean} чи були зміни
 */
function rewireDependents(doc, seqs, renames, lintJobNames) {
  let changed = false
  for (const seq of seqs) {
    const seqNode = doc.getIn(seq.path)
    for (const [i, itemNode] of seqNode.items.entries()) {
      const j = itemNode?.toJS?.(doc)
      if (!j || typeof j.job !== 'string' || j.job === 'plan' || lintJobNames.has(j.job)) continue
      if (rewireOneJob(doc, [...seq.path, i], j, renames, lintJobNames)) changed = true
    }
  }
  return changed
}

/**
 * Крок 4 (одна джоба): перешивка dependsOn і Skipped-толерантний condition.
 * @param {import('yaml').Document} doc документ (мутується)
 * @param {Array<string|number>} base шлях джоби в документі
 * @param {Record<string, unknown>} j джоба (plain JS)
 * @param {Map<string, string[]>} renames легасі-ім'я → нові lint-джоби
 * @param {Set<string>} lintJobNames множина всіх lint-джоб
 * @returns {boolean} чи були зміни
 */
function rewireOneJob(doc, base, j, renames, lintJobNames) {
  let deps = dependsOf(j)
  if (deps.length === 0) return false
  let changed = false
  const expanded = deps.flatMap(d => renames.get(d) ?? [d])
  if (JSON.stringify(expanded) !== JSON.stringify(deps)) {
    doc.setIn([...base, 'dependsOn'], doc.createNode(expanded))
    deps = expanded
    changed = true
  }
  const touchesLint = deps.some(d => lintJobNames.has(d))
  if (touchesLint && typeof j.condition !== 'string') {
    const withPlan = deps.includes('plan') ? deps : ['plan', ...deps]
    if (!deps.includes('plan')) doc.setIn([...base, 'dependsOn'], doc.createNode(withPlan))
    doc.setIn([...base, 'condition'], skipTolerantCondition(withPlan))
    changed = true
  }
  return changed
}

/**
 * Аналіз pipeline перед міграцією: послідовності джоб, легасі lint-джоби,
 * plan-джоба і сервісний каталог. `null` — файл поза скоупом міграції
 * (без paths-тригера, template-розкладка, немає сервісного каталогу).
 * @param {import('yaml').Document} doc розпарсений документ
 * @returns {{ seqs: Array<{ path: Array<string|number>, items: unknown[] }>, allJobs: Array<Record<string, unknown>>, planJob: Record<string, unknown>|undefined, legacy: Array<{ seq: object, job: Record<string, unknown>, path: string|null }>, servicePath: string }|null} аналіз
 */
function analyzePipeline(doc) {
  const js = doc.toJS() ?? {}
  const servicePaths = js?.trigger?.paths?.include
  if (!Array.isArray(servicePaths) || servicePaths.length === 0) return null

  const seqs = collectJobSeqs(doc)
  const allJobs = seqs.flatMap(s => s.items).filter(j => j && typeof j === 'object' && typeof j.job === 'string')
  if (allJobs.length === 0) return null // template-розкладка — не мігруємо

  const planJob = allJobs.find(j => j.job === 'plan')
  const legacy = seqs.flatMap(seq =>
    seq.items
      .filter(j => j && typeof j === 'object' && typeof j.job === 'string' && j.job !== 'plan')
      .map(j => ({ seq, job: j, found: findLintStep(Array.isArray(j.steps) ? j.steps : []) }))
      .filter(x => x.found?.legacy)
      .map(x => ({ seq: x.seq, job: x.job, path: x.found.path }))
  )

  // Сервісний каталог: із plan-джоби → з легасі lint-джоби → перший paths.include
  // (glob-суфікс /**, /* зрізається: `run/nexus/**` → `run/nexus`).
  const planPath = (Array.isArray(planJob?.steps) ? planJob.steps : [])
    .map(s => parseNRulesCmd(stepCmd(s), 'n-rules ci plan')?.path)
    .find(Boolean)
  const firstTriggerPath = servicePaths
    .filter(p => typeof p === 'string')
    .map(p => p.replace(GLOB_SUFFIX_RE, ''))
    .find(p => p !== '' && !p.includes('*'))
  const servicePath = planPath ?? legacy[0]?.path ?? firstTriggerPath
  if (typeof servicePath !== 'string') return null

  return { seqs, allJobs, planJob, legacy, servicePath }
}

/**
 * Мігрує один pipeline-файл до канону. Повертає true, якщо файл змінено.
 * @param {string} absPath абсолютний шлях pipeline-файлу
 * @param {string} cwd корінь consumer-репо
 * @returns {Promise<boolean>} чи були зміни
 */
export async function migratePipelineFile(absPath, cwd) {
  const prevText = readFileSync(absPath, 'utf8')
  let doc
  try {
    doc = parseDocument(prevText)
  } catch {
    return false
  }
  const analyzed = analyzePipeline(doc)
  if (!analyzed) return false
  const { seqs, allJobs, planJob, legacy, servicePath } = analyzed

  const prep = derivePrepSteps(allJobs)
  const domains = await relevantDomains(cwd, servicePath)
  let changed = false

  if (!planJob) changed = ensurePlanJob(doc, seqs, prep, servicePath) || changed
  const { renames, changed: legacyChanged } = replaceLegacyJobs(doc, legacy, domains, servicePath, prep)
  changed = legacyChanged || changed

  const lintJobNames = new Set(renames.values().toArray().flat())
  changed = patchDomainLintJobs(doc, seqs, lintJobNames) || changed
  changed = rewireDependents(doc, seqs, renames, lintJobNames) || changed

  if (!changed) return false
  writeFileSync(absPath, doc.toString())
  return true
}

export const patterns = [
  {
    id: 'azure-service-pipeline-canon-migrate',
    test: violations => violations.length > 0,
    async apply(violations, ctx) {
      const files = [...new Set(violations.map(v => v.file).filter(Boolean))]
      const touched = []
      for (const rel of files) {
        const abs = join(ctx.cwd, rel)
        if (!existsSync(abs)) continue
        try {
          if (await migratePipelineFile(abs, ctx.cwd)) touched.push(abs)
        } catch {
          // міграція конкретного файлу не вдалася — лишаємо deny детектору (fail-open до ручного фіксу)
        }
      }
      return {
        touchedFiles: touched,
        message: touched.length > 0 ? `мігровано до сервіс-канону: ${touched.length} pipeline(ів)` : null
      }
    }
  }
]

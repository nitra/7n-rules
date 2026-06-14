/** @see ./docs/orchestrator.md */

import { runFixCheck } from './run-fix-check.mjs'
import { runT0AutoCli } from './t0.mjs'

const DEFAULT_MAX_ITER = 3
const ESCALATE_AFTER = 2

/**
 * Парсить `--max-iter N` і збирає rule-filter (позиційні аргументи без прапорців).
 * @param {string[]} args CLI аргументи після 'fix'
 * @returns {{ maxIter: number, ruleFilter: string[] }} ліміт ітерацій і фільтр правил
 */
function parseOrchestratorArgs(args) {
  const maxIterIdx = args.indexOf('--max-iter')
  const maxIter =
    maxIterIdx === -1 ? DEFAULT_MAX_ITER : Number(args[maxIterIdx + 1] ?? DEFAULT_MAX_ITER) || DEFAULT_MAX_ITER
  const skipIdxs = new Set(maxIterIdx === -1 ? [] : [maxIterIdx, maxIterIdx + 1])
  const ruleFilter = args.filter((a, i) => !a.startsWith('-') && !skipIdxs.has(i))
  return { maxIter, ruleFilter }
}

/**
 * Крок T0-auto: детермінований фікс без LLM, повертає правила, що лишились.
 * @param {string} cwd корінь проєкту
 * @param {string[]} ruleFilter фільтр правил
 * @param {Array<{ ruleId: string }>} failed правила перед кроком
 * @returns {Promise<Array<{ ruleId: string, ok: boolean, output: string }>>} правила після T0
 */
async function runT0Step(cwd, ruleFilter, failed) {
  await runT0AutoCli([...ruleFilter], cwd)

  const afterT0 = await runFixCheck(ruleFilter, cwd)
  const failedAfterT0 = afterT0.rules.filter(r => !r.ok)
  const t0Fixed = failed.filter(r => !failedAfterT0.some(f => f.ruleId === r.ruleId))

  if (t0Fixed.length > 0) {
    console.log(`  ⚙️  T0-auto: ${t0Fixed.map(r => r.ruleId).join(', ')}`)
  }
  return failedAfterT0
}

/**
 * Крок T1: LLM через pi для кожного правила, з ескалацією моделі за провалами.
 * @param {Array<{ ruleId: string, output: string }>} failed правила до фіксу
 * @param {string} cwd корінь проєкту
 * @param {Map<string, number>} failCount ruleId → кількість провалів підряд (мутується)
 * @param {{ runLlmWorker: (ruleId: string, output: string, projectRoot: string, opts: {model: string}) => Promise<{ok: boolean, error?: string}>, MODEL: string, MODEL_HEAVY: string }} worker воркер і моделі
 * @returns {Promise<void>}
 */
async function runLlmStep(failed, cwd, failCount, { runLlmWorker, MODEL, MODEL_HEAVY }) {
  for (const rule of failed) {
    const prevFails = failCount.get(rule.ruleId) ?? 0
    const model = prevFails >= ESCALATE_AFTER ? MODEL_HEAVY : MODEL
    const label = model || 'pi'

    const result = await runLlmWorker(rule.ruleId, rule.output, cwd, { model })

    if (result.ok) {
      console.log(`  ⚡ LLM (${label}): ${rule.ruleId}`)
      failCount.delete(rule.ruleId)
    } else {
      failCount.set(rule.ruleId, prevFails + 1)
      const hint = (result.error ?? '').slice(0, 200)
      console.log(`  ⚡ LLM (${label}): ${rule.ruleId} ❌  ${hint}`)
    }
  }
}

/**
 * @param {string[]} args   CLI аргументи після 'fix'
 * @param {string}   cwd    корінь проєкту
 * @returns {Promise<number>}  0 = all clean, 1 = unresolved
 */
export async function runOrchestratorCli(args, cwd) {
  const worker = await import('./llm-worker.mjs')
  const { maxIter, ruleFilter } = parseOrchestratorArgs(args)

  /** @type {Map<string, number>} ruleId → кількість LLM-провалів підряд */
  const failCount = new Map()

  // ── Перша перевірка (тихо) ──
  const initial = await runFixCheck(ruleFilter, cwd)
  let failed = initial.rules.filter(r => !r.ok)
  const total = initial.total

  // Нічого не зламано — коротка відповідь
  if (failed.length === 0) {
    console.log(`✅ fix: ${total} правил — все чисто`)
    return 0
  }

  // Є порушення — показуємо прогрес
  console.log(`🔄 fix: ${failed.length}/${total} порушень (${failed.map(r => r.ruleId).join(', ')})`)
  if (ruleFilter.length) console.log(`   filter: ${ruleFilter.join(', ')}`)

  for (let iter = 1; iter <= maxIter; iter++) {
    failed = await runT0Step(cwd, ruleFilter, failed)
    if (failed.length === 0) break

    await runLlmStep(failed, cwd, failCount, worker)

    // Перевірка після LLM
    const afterLLM = await runFixCheck(ruleFilter, cwd)
    failed = afterLLM.rules.filter(r => !r.ok)
    if (failed.length === 0) break
  }

  if (failed.length === 0) {
    console.log(`✅ fix: ${total} правил — все чисто`)
    return 0
  }

  console.log(`❌ fix: ${failed.length} невирішених — ${failed.map(r => r.ruleId).join(', ')}`)
  return 1
}

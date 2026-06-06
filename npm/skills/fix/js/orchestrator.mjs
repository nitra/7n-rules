/**
 * Автономний оркестратор n-fix: convergence-loop без участі агента-LLM.
 *
 * Тири:
 *   T0      — детерміністична перевірка (runFixCheck, 0 LLM)
 *   T0-auto — regex-парсинг violation → програмний фікс (0 LLM)
 *   T1      — LLM через pi (haiku → sonnet ескалація)
 *   check-gate — re-run T0 після кожного тіру; loop до maxIter
 *
 * meta.json: { "orchestrator": true } — CLI маршрутизує `fix` сюди.
 */

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const N_CURSOR_BIN = join(HERE, '../../../bin/n-cursor.js')

const DEFAULT_MAX_ITER = 3
const ESCALATE_AFTER = 2

/**
 * @param {string[]} args   CLI аргументи після 'fix'
 * @param {string}   cwd    корінь проєкту
 * @returns {Promise<number>}  0 = all clean, 1 = unresolved
 */
export async function runOrchestratorCli(args, cwd) {
  const { runLlmWorker, MODEL_HAIKU, MODEL_SONNET } = await import('./llm-worker.mjs')

  const maxIterIdx = args.indexOf('--max-iter')
  const maxIter =
    maxIterIdx !== -1 ? Number(args[maxIterIdx + 1] ?? DEFAULT_MAX_ITER) || DEFAULT_MAX_ITER : DEFAULT_MAX_ITER
  const skipIdxs = new Set(maxIterIdx !== -1 ? [maxIterIdx, maxIterIdx + 1] : [])
  const ruleFilter = args.filter((a, i) => !a.startsWith('-') && !skipIdxs.has(i))

  console.log(`🔄 n-cursor fix`)
  if (ruleFilter.length) console.log(`   rules: ${ruleFilter.join(', ')}`)

  /** @type {Map<string, number>} ruleId → кількість LLM-провалів підряд */
  const failCount = new Map()

  for (let iter = 1; iter <= maxIter; iter++) {
    console.log(`\n── Ітерація ${iter}/${maxIter} ──`)

    // ── T0: check ──
    const state = runFixCheck(cwd, ruleFilter)
    if (!state) {
      console.error(`❌ fix: перевірка повернула помилку`)
      return 1
    }

    const failed = state.rules.filter(r => !r.ok)
    if (failed.length === 0) {
      console.log(`✅ fix: 0/${state.total} порушень`)
      return 0
    }

    console.log(`   ❌ ${failed.length}: ${failed.map(r => r.ruleId).join(', ')}`)

    // ── T0-auto: детермінований фікс без LLM ──
    spawnSync('bun', [N_CURSOR_BIN, 'fix-t0', ...ruleFilter], { cwd, stdio: 'inherit' })

    const stateAfterT0 = runFixCheck(cwd, ruleFilter)
    const failedAfterT0 = stateAfterT0?.rules.filter(r => !r.ok) ?? failed
    if (failedAfterT0.length === 0) {
      console.log(`✅ fix: всі правила закриті T0-auto`)
      return 0
    }

    // ── T1: LLM через pi ──
    for (const rule of failedAfterT0) {
      const prevFails = failCount.get(rule.ruleId) ?? 0
      const model = prevFails >= ESCALATE_AFTER ? MODEL_SONNET : MODEL_HAIKU
      const tier = prevFails >= ESCALATE_AFTER ? 'sonnet' : 'haiku'

      console.log(`\n⚡ [${tier}] → ${rule.ruleId}`)

      const result = await runLlmWorker(rule.ruleId, rule.output, cwd, { model })

      if (result.ok) {
        console.log(`   ✅ закрито`)
        failCount.delete(rule.ruleId)
      } else {
        failCount.set(rule.ruleId, prevFails + 1)
        console.log(`   ❌ (${prevFails + 1}× fail): ${result.error ?? ''}`)
      }
    }
  }

  // ── Фінальна перевірка ──
  const final = runFixCheck(cwd, ruleFilter)
  const finalFailed = final?.rules.filter(r => !r.ok) ?? []

  if (finalFailed.length === 0) {
    console.log(`\n✅ fix: чисто`)
    return 0
  }

  console.log(`\n❌ fix: ${finalFailed.length} unresolved після ${maxIter} ітерацій`)
  console.log(`   ${finalFailed.map(r => r.ruleId).join(', ')}`)
  return 1
}

/**
 * Внутрішня check-gate: запускає fix-перевірки і повертає структурований результат.
 * Не є публічним CLI — викликається лише оркестратором.
 *
 * @param {string}   cwd
 * @param {string[]} ruleFilter
 * @returns {{ total: number, failed: number, rules: Array<{ ruleId: string, ok: boolean, output: string }> } | null}
 */
function runFixCheck(cwd, ruleFilter = []) {
  const r = spawnSync('bun', [N_CURSOR_BIN, '_fix-check', ...ruleFilter], {
    cwd,
    encoding: 'utf8',
    timeout: 120_000
  })
  const stdout = r.stdout?.trim()
  if (!stdout) return null
  try {
    return JSON.parse(stdout)
  } catch {
    return null
  }
}

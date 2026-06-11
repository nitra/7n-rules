/** @see ./docs/orchestrator.md */

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
  const { runLlmWorker, MODEL, MODEL_HEAVY } = await import('./llm-worker.mjs')

  const maxIterIdx = args.indexOf('--max-iter')
  const maxIter =
    maxIterIdx === -1 ? DEFAULT_MAX_ITER : Number(args[maxIterIdx + 1] ?? DEFAULT_MAX_ITER) || DEFAULT_MAX_ITER
  const skipIdxs = new Set(maxIterIdx === -1 ? [] : [maxIterIdx, maxIterIdx + 1])
  const ruleFilter = args.filter((a, i) => !a.startsWith('-') && !skipIdxs.has(i))

  /** @type {Map<string, number>} ruleId → кількість LLM-провалів підряд */
  const failCount = new Map()

  // ── Перша перевірка (тихо) ──
  const initial = runFixCheck(cwd, ruleFilter)
  if (!initial) {
    console.error(`❌ fix: помилка перевірки`)
    return 1
  }

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
    // ── T0-auto: детермінований фікс без LLM ──
    spawnSync('bun', [N_CURSOR_BIN, 'fix-t0', ...ruleFilter], { cwd, stdio: 'pipe' })

    const afterT0 = runFixCheck(cwd, ruleFilter)
    const failedAfterT0 = afterT0?.rules.filter(r => !r.ok) ?? failed
    const t0Fixed = failed.filter(r => !failedAfterT0.some(f => f.ruleId === r.ruleId))

    if (t0Fixed.length > 0) {
      console.log(`  ⚙️  T0-auto: ${t0Fixed.map(r => r.ruleId).join(', ')}`)
    }

    failed = failedAfterT0
    if (failed.length === 0) break

    // ── T1: LLM через pi ──
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

    // Перевірка після LLM
    const afterLLM = runFixCheck(cwd, ruleFilter)
    failed = afterLLM?.rules.filter(r => !r.ok) ?? failed
    if (failed.length === 0) break
  }

  if (failed.length === 0) {
    console.log(`✅ fix: ${total} правил — все чисто`)
    return 0
  }

  console.log(`❌ fix: ${failed.length} невирішених — ${failed.map(r => r.ruleId).join(', ')}`)
  return 1
}

/**
 * Внутрішня check-gate: запускає fix-перевірки і повертає структурований результат.
 * Не є публічним CLI — викликається лише оркестратором.
 * @param {string}   cwd корінь проєкту
 * @param {string[]} ruleFilter список ID правил (порожній — усі)
 * @returns {{ total: number, failed: number, rules: Array<{ ruleId: string, ok: boolean, output: string }> } | null} JSON-результат або null якщо stdout порожній/невалідний
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

/** @see ./docs/t0.md */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { discoverT0Patterns } from './discover-t0-patterns.mjs'
import { runConformanceCheck } from './run-conformance-check.mjs'

// Top-level await: ініціалізація один раз при завантаженні модуля.
const RULES_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../rules')
const PATTERNS = await discoverT0Patterns(RULES_DIR)

/**
 * Застосовує всі T0-auto паттерни до одного violation-output.
 * @param {string} ruleId id правила (для логу)
 * @param {string} violationOutput рядок з поля `output` у `fix --json`
 * @param {string} cwd корінь проєкту
 * @returns {Promise<{ applied: boolean, actions: string[] }>} результат: чи щось застосовано і список дій
 */
export async function applyT0Auto(ruleId, violationOutput, cwd) {
  const actions = []
  let applied = false

  for (const p of PATTERNS) {
    if (!p.test(violationOutput)) continue
    // Патерн може бути sync ({ok,action}) або async (Promise) — await нормалізує обидва.
    const result = await p.apply(violationOutput, cwd, { ruleId, rulesDir: RULES_DIR })
    actions.push(`[${p.id}] ${result.action}`)
    if (result.ok) applied = true
  }

  return { applied, actions }
}

/**
 * Повертає список id правил, для яких є хоча б один T0-auto паттерн
 * (визначається по violation-output із `fix --json`).
 * @param {{ ruleId: string, output: string }[]} failedRules повний список правил із output
 * @returns {string[]} ID правил із наявним T0-auto патерном
 */
export function filterT0AutoRules(failedRules) {
  return failedRules.filter(r => PATTERNS.some(p => p.test(r.output))).map(r => r.ruleId)
}

// ─── CLI entry-point ──────────────────────────────────────────────────────────

/**
 * Застосовує T0-auto до кожного провального правила, розділяючи на applied/skipped.
 * @param {Array<{ ruleId: string, output: string }>} failed провальні правила
 * @param {string} cwd корінь проєкту
 * @returns {Promise<{ applied: Array<{ ruleId: string, actions: string[] }>, skipped: string[] }>} застосовані й пропущені
 */
async function applyT0ToFailed(failed, cwd) {
  const applied = []
  const skipped = []
  for (const r of failed) {
    const result = await applyT0Auto(r.ruleId, r.output, cwd)
    if (result.applied) {
      applied.push({ ruleId: r.ruleId, actions: result.actions })
    } else {
      skipped.push(r.ruleId)
    }
  }
  return { applied, skipped }
}

/**
 * CLI підкоманда `n-cursor fix-t0 [rule...]`.
 * Запускає `fix --json`, застосовує T0-auto для кожного violation,
 * повторно перевіряє check-gate, виводить підсумок.
 * @param {string[]} args аргументи (опційний список rule-ids)
 * @param {string}   cwd  корінь проєкту
 * @returns {Promise<number>} 0 — T0-auto закрив всі або немає порушень; 1 — лишились
 */
export async function runT0AutoCli(args, cwd) {
  const ruleFilter = args.filter(a => !a.startsWith('--'))
  const verbose = args.includes('--verbose') || args.includes('-v')

  // 1. Конформність-детект (пряма функція, без subprocess)
  const fixJson = await runConformanceCheck(ruleFilter, cwd)
  const failed = fixJson.rules.filter(r => !r.ok)
  if (failed.length === 0) {
    console.log(`✅ fix-t0: всі правила чисті — T0 не потрібен`)
    return 0
  }

  // 2. Застосувати T0-auto
  const { applied, skipped } = await applyT0ToFailed(failed, cwd)

  if (applied.length === 0) {
    console.log(`⏭️  fix-t0: T0-auto паттерн не підходить для: ${failed.map(r => r.ruleId).join(', ')}`)
    return 1
  }

  // 3. Вивести що зробили
  for (const { ruleId, actions } of applied) {
    console.log(`⚙️  ${ruleId}:`)
    for (const a of actions) console.log(`   ${a}`)
  }

  // 4. Check-gate: перевірити лише ті правила, що ми чіпали
  const recheckJson = await runConformanceCheck(
    applied.map(a => a.ruleId),
    cwd
  )
  const stillFailed = recheckJson.rules.filter(r => !r.ok)

  if (verbose) {
    for (const r of recheckJson.rules) {
      console.log(`  ${r.ok ? '✅' : '❌'} ${r.ruleId}`)
    }
  }

  if (stillFailed.length > 0) {
    console.log(`❌ fix-t0 check-gate: ${stillFailed.map(r => r.ruleId).join(', ')} — лишились`)
    if (skipped.length > 0) {
      console.log(`⏭️  без T0 паттерну: ${skipped.join(', ')} → потрібен LLM`)
    }
    return 1
  }

  const totalFixed = applied.length
  const total = failed.length
  console.log(
    `✅ fix-t0: ${totalFixed}/${total} правил закрито T0-auto` +
      (skipped.length > 0 ? `; ${skipped.join(', ')} → T1 (LLM)` : '')
  )
  return 0
}

/**
 * `flow gate` — структурований вердикт релізної готовності (ідея BMAD qa-gate, у
 * нашому стані). Синтезує механічні гейти `verify` (`state.gates`) і adversarial
 * findings `review` (`state.review.findings`) у єдине PASS/CONCERNS/FAIL + score
 * + причини. Дає traceability «чому готово/не готово». `gate` лише агрегує —
 * рішення verify/review не дублює.
 *
 * Уся IO (`now`) ін'єктується; `computeGate` — чиста (тестується без стану на диску).
 */
import { cwd as processCwd } from 'node:process'

import { flowEventsPath } from './events.mjs'
import { flowStatePath, readState, recordTransition } from './state-store.mjs'

/** Штрафи score за кожен тип проблеми. */
const PENALTY = { failedGate: 40, high: 25, med: 8, noVerify: 15 }

/**
 * Чистий синтез вердикту з наявного стану.
 * @param {{ gates?: { name: string, ok: boolean }[], review?: { findings?: { severity?: string }[] } }} state стан flow
 * @returns {{ verdict: 'PASS' | 'CONCERNS' | 'FAIL', score: number, reasons: string[] }} вердикт
 */
export function computeGate(state) {
  const gates = state.gates ?? []
  const findings = state.review?.findings ?? []
  const failedGates = gates.filter(g => !g.ok)
  const high = findings.filter(f => f.severity === 'high')
  const med = findings.filter(f => f.severity === 'med')
  const noVerify = gates.length === 0

  const reasons = []
  for (const g of failedGates) reasons.push(`gate «${g.name}» провалено`)
  if (high.length > 0) reasons.push(`${high.length} high-severity review finding(s)`)
  if (med.length > 0) reasons.push(`${med.length} med-severity review finding(s)`)
  if (noVerify) reasons.push('verify ще не запускався')

  let verdict = 'PASS'
  if (failedGates.length > 0 || high.length > 0) {
    verdict = 'FAIL'
  } else if (med.length > 0 || noVerify) {
    verdict = 'CONCERNS'
  }

  const penalty =
    PENALTY.failedGate * failedGates.length +
    PENALTY.high * high.length +
    PENALTY.med * med.length +
    (noVerify ? PENALTY.noVerify : 0)
  const score = Math.max(0, Math.min(100, 100 - penalty))

  return { verdict, score, reasons }
}

/**
 * `flow gate` — обчислює й фіксує вердикт у `.flow.json`.
 * @param {string[]} _rest аргументи (не використовуються)
 * @param {{ cwd?: string, log?: (m: string) => void, now?: () => number }} [deps] ін'єкції
 * @returns {Promise<number>} exit code (FAIL → 1; PASS/CONCERNS → 0)
 */
export async function gate(_rest, deps = {}) {
  const cwd = deps.cwd ?? processCwd()
  const log = deps.log ?? console.error
  const now = deps.now ?? Date.now

  const statePath = flowStatePath(cwd)
  const state = readState(statePath)
  if (!state) {
    log('gate: стану нема — спершу `flow init`')
    return 1
  }

  const result = computeGate(state)
  recordTransition(
    { statePath, eventsPath: flowEventsPath(cwd) },
    { type: 'gate', verdict: result.verdict },
    s => ({ ...s, gate: { ...result, at: new Date(now()).toISOString() } }),
    now
  )

  log(`gate: ${result.verdict} (score ${result.score})`)
  for (const r of result.reasons) log(`  · ${r}`)
  return result.verdict === 'FAIL' ? 1 : 0
}

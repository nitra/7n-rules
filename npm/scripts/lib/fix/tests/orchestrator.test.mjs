/**
 * Юніт-тести orchestrator.mjs — драбина ескалації (спека 2026-06-19-fix-escalation-cascade).
 *
 * Стратегія: тестуємо чисті `buildLadder` і `escalateRule` з інжектованими
 * worker/check — без реального spawnSync/LLM. Escalation-лог вимкнено kill-switch-ем,
 * щоб тести не писали в .n-cursor/.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { env } from 'node:process'

import { buildLadder, escalateRule, parseOrchestratorArgs } from '../orchestrator.mjs'

let prevTrace
beforeAll(() => {
  prevTrace = env.N_CURSOR_FIX_ESCALATION_LOG
  env.N_CURSOR_FIX_ESCALATION_LOG = '0'
})
afterAll(() => {
  if (prevTrace === undefined) delete env.N_CURSOR_FIX_ESCALATION_LOG
  else env.N_CURSOR_FIX_ESCALATION_LOG = prevTrace
})

// ── фіктивні worker/check ─────────────────────────────────────────────────────

/**
 * Worker, що віддає наперед задані результати по черзі й логує виклики.
 * @param {Array<object>} results послідовність результатів runLlmWorker
 * @returns {{ calls: object[], runLlmWorker: (ruleId: string, violation: string, cwd: string, opts: object) => object }} worker із журналом викликів
 */
function makeWorker(results) {
  const calls = []
  let i = 0
  return {
    calls,
    runLlmWorker(ruleId, violation, _cwd, opts) {
      calls.push({ ruleId, model: opts.model, feedback: opts.feedback, caller: opts.caller })
      return results[i++] ?? { ok: false, error: 'no result', changes: [], diagnosis: null }
    }
  }
}

/**
 * check, що віддає ok/не-ok по черзі для одного правила.
 * @param {string} ruleId id правила
 * @param {boolean[]} okSeq послідовність recheck-результатів
 * @returns {() => Promise<{rules: Array<{ruleId:string,ok:boolean,output:string}>}>} check(rules, cwd)
 */
function makeCheck(ruleId, okSeq) {
  let i = 0
  return () => {
    const isOk = okSeq[i++] ?? false
    return Promise.resolve({ rules: [{ ruleId, ok: isOk, output: isOk ? '' : 'still failing' }] })
  }
}

const ok = changes => ({ ok: true, changes: changes ?? [{ path: 'f' }], diagnosis: null })
const fail = (error, diagnosis) => ({ ok: false, error, changes: [], diagnosis: diagnosis ?? null })
const clock = () => 0
const noop = () => {
  /* лог глушимо у тестах */
}

const FULL = { localMin: 'omlx/local', cloudMin: 'openai/min', cloudAvg: 'openai/avg' }

describe('buildLadder', () => {
  test('усі тири → 4 рунги у правильному порядку', () => {
    const l = buildLadder(FULL)
    expect(l.map(r => r.tier)).toEqual(['local-min', 'local-min-retry', 'cloud-min', 'cloud-avg'])
    expect(l[0].feedback).toBe(false)
    expect(l[1].feedback).toBe(true)
    expect(l[3].isAvg).toBe(true)
  })

  test('лише local-min → два локальні рунги', () => {
    const l = buildLadder({ localMin: 'omlx/x', cloudMin: '', cloudAvg: '' })
    expect(l.map(r => r.tier)).toEqual(['local-min', 'local-min-retry'])
  })

  test('лише хмара → cloud-min, cloud-avg', () => {
    const l = buildLadder({ localMin: '', cloudMin: 'o/min', cloudAvg: 'o/avg' })
    expect(l.map(r => r.tier)).toEqual(['cloud-min', 'cloud-avg'])
  })

  test('жодного тиру → порожня драбина', () => {
    expect(buildLadder({ localMin: '', cloudMin: '', cloudAvg: '' })).toEqual([])
  })
})

describe('parseOrchestratorArgs', () => {
  test('дефолтний avg-кеп і фільтр правил', () => {
    expect(parseOrchestratorArgs(['changelog', 'bun'])).toEqual({ maxAvg: 3, ruleFilter: ['changelog', 'bun'] })
  })
  test('--max-avg перевизначає і прибирається з фільтра', () => {
    expect(parseOrchestratorArgs(['--max-avg', '1', 'bun'])).toEqual({ maxAvg: 1, ruleFilter: ['bun'] })
  })
})

describe('escalateRule', () => {
  const rule = { ruleId: 'rego', output: 'violation' }

  test('local-min закриває на першому рунгу → resolved, без feedback, avgUsed=0', async () => {
    const worker = makeWorker([ok()])
    const r = await escalateRule(rule, '/p', {
      ladder: buildLadder(FULL),
      worker,
      check: makeCheck('rego', [true]),
      avgBudget: 3,
      clock,
      log: noop
    })
    expect(r).toEqual({ resolved: true, avgUsed: 0 })
    expect(worker.calls).toHaveLength(1)
    expect(worker.calls[0].model).toBe('omlx/local')
    expect(worker.calls[0].feedback).toBeNull()
    expect(worker.calls[0].caller).toBe('fix:rego:local-min')
  })

  test('retry того самого local-min із feedback закриває на 2-му рунгу', async () => {
    const worker = makeWorker([fail('pi returned no changes'), ok()])
    const r = await escalateRule(rule, '/p', {
      ladder: buildLadder(FULL),
      worker,
      check: makeCheck('rego', [false, true]),
      avgBudget: 3,
      clock,
      log: noop
    })
    expect(r.resolved).toBe(true)
    expect(worker.calls).toHaveLength(2)
    expect(worker.calls[1].model).toBe('omlx/local')
    expect(worker.calls[1].feedback).toMatchObject({ previousModel: 'omlx/local' })
  })

  test('каскад local→cloud-min→cloud-avg; avg рахується', async () => {
    const worker = makeWorker([fail('x'), fail('x'), fail('x'), ok()])
    const r = await escalateRule(rule, '/p', {
      ladder: buildLadder(FULL),
      worker,
      check: makeCheck('rego', [false, false, false, true]),
      avgBudget: 3,
      clock,
      log: noop
    })
    expect(r).toEqual({ resolved: true, avgUsed: 1 })
    expect(worker.calls.map(c => c.model)).toEqual(['omlx/local', 'omlx/local', 'openai/min', 'openai/avg'])
  })

  test('avg-кеп 0 → cloud-avg пропускається, worker не кличеться для avg', async () => {
    const worker = makeWorker([fail('x'), fail('x'), fail('x')])
    const r = await escalateRule(rule, '/p', {
      ladder: buildLadder(FULL),
      worker,
      check: makeCheck('rego', [false, false, false]),
      avgBudget: 0,
      clock,
      log: noop
    })
    expect(r.resolved).toBe(false)
    expect(worker.calls.map(c => c.model)).toEqual(['omlx/local', 'omlx/local', 'openai/min'])
  })

  test('systemic-помилка local → пропуск local-min-retry, стрибок на cloud-min', async () => {
    const worker = makeWorker([fail('omlx curl: connection refused'), ok()])
    const r = await escalateRule(rule, '/p', {
      ladder: buildLadder(FULL),
      worker,
      check: makeCheck('rego', [false, true]),
      avgBudget: 3,
      clock,
      log: noop
    })
    expect(r.resolved).toBe(true)
    // 2-й виклик — одразу cloud-min (local-min-retry пропущено через systemic)
    expect(worker.calls.map(c => c.model)).toEqual(['omlx/local', 'openai/min'])
  })

  test('відсутній API-ключ на хмарному → драбина обривається', async () => {
    const worker = makeWorker([fail('x'), fail('x'), fail('pi: немає ключа для openai')])
    const r = await escalateRule(rule, '/p', {
      ladder: buildLadder(FULL),
      worker,
      check: makeCheck('rego', [false, false, false]),
      avgBudget: 3,
      clock,
      log: noop
    })
    expect(r.resolved).toBe(false)
    // cloud-avg не пробувався після no-key на cloud-min
    expect(worker.calls.map(c => c.model)).toEqual(['omlx/local', 'omlx/local', 'openai/min'])
  })
})

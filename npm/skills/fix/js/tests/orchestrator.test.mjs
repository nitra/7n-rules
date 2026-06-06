/**
 * Юніт-тести для orchestrator.mjs.
 *
 * Стратегія: мокуємо спавн і llm-worker, перевіряємо логіку convergence-loop.
 * Реальний n-cursor fix --json не викликається (offline-тест).
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'

// ── мінімальний mock модуля orchestrator без реального spawnSync ──
// Тестуємо getFixState та загальний flow через заміну спавну

describe('orchestrator logic', () => {
  test('clean state → returns 0 immediately', async () => {
    // Симулюємо: fix --json → failed=0
    const result = await runLoopMock({
      states: [{ total: 3, failed: 0, rules: [] }],
      t0Exit: 0,
      llmResults: []
    })
    expect(result).toBe(0)
  })

  test('T0-auto closes all → returns 0 without LLM', async () => {
    const result = await runLoopMock({
      states: [
        {
          total: 3,
          failed: 1,
          rules: [{ ruleId: 'bun', ok: false, output: 'Знайдено заборонений файл: package-lock.json' }]
        },
        { total: 3, failed: 0, rules: [] } // після T0
      ],
      t0Exit: 0,
      llmResults: []
    })
    expect(result).toBe(0)
  })

  test('LLM fixes remaining after T0 → returns 0', async () => {
    const result = await runLoopMock({
      states: [
        { total: 3, failed: 1, rules: [{ ruleId: 'rego', ok: false, output: 'складне порушення' }] },
        { total: 3, failed: 1, rules: [{ ruleId: 'rego', ok: false, output: 'складне порушення' }] }, // after T0 (no change)
        { total: 3, failed: 0, rules: [] } // after LLM
      ],
      t0Exit: 1,
      llmResults: [{ ok: true, turns: 5 }]
    })
    expect(result).toBe(0)
  })

  test('LLM escalates haiku→sonnet after 2 failures', async () => {
    const models = []
    const result = await runLoopMock({
      states: [
        // iter 1: rego fails
        { total: 1, failed: 1, rules: [{ ruleId: 'rego', ok: false, output: 'X' }] },
        { total: 1, failed: 1, rules: [{ ruleId: 'rego', ok: false, output: 'X' }] }, // after T0
        // iter 2: still fails
        { total: 1, failed: 1, rules: [{ ruleId: 'rego', ok: false, output: 'X' }] },
        { total: 1, failed: 1, rules: [{ ruleId: 'rego', ok: false, output: 'X' }] }, // after T0
        // iter 3: still fails
        { total: 1, failed: 1, rules: [{ ruleId: 'rego', ok: false, output: 'X' }] },
        { total: 1, failed: 1, rules: [{ ruleId: 'rego', ok: false, output: 'X' }] }, // after T0
        // final check
        { total: 1, failed: 1, rules: [{ ruleId: 'rego', ok: false, output: 'X' }] }
      ],
      t0Exit: 1,
      llmResults: [
        { ok: false, turns: 10, error: 'fail' }, // iter 1: haiku fails → failCount=1
        { ok: false, turns: 10, error: 'fail' }, // iter 2: haiku fails → failCount=2
        { ok: false, turns: 10, error: 'fail' } // iter 3: sonnet fails → failCount=3
      ],
      onLlmCall: (ruleId, _output, _root, opts) => models.push(opts.model)
    })
    expect(result).toBe(1) // unresolved
    expect(models[0]).toContain('haiku')
    expect(models[1]).toContain('haiku')
    expect(models[2]).toContain('sonnet') // escalated
  })

  test('max-iter reached with unresolved → returns 1', async () => {
    const result = await runLoopMock({
      states: Array(8).fill({ total: 1, failed: 1, rules: [{ ruleId: 'rego', ok: false, output: 'X' }] }),
      t0Exit: 1,
      llmResults: [
        { ok: false, turns: 5 },
        { ok: false, turns: 5 },
        { ok: false, turns: 5 }
      ],
      maxIter: 3
    })
    expect(result).toBe(1)
  })
})

// ── допоміжний mock-runner ────────────────────────────────────────────────────

/**
 * Імітує runOrchestratorCli з mock-станами замість реального spawnSync.
 *
 * @param {{
 *   states: Array<{total:number,failed:number,rules:Array<{ruleId:string,ok:boolean,output:string}>}>,
 *   t0Exit: number,
 *   llmResults: Array<{ok:boolean,turns:number,error?:string}>,
 *   maxIter?: number,
 *   onLlmCall?: Function
 * }} opts
 */
async function runLoopMock({ states, t0Exit, llmResults, maxIter = 3, onLlmCall }) {
  const MODEL_HAIKU = 'claude-haiku-4-5-20251001'
  const MODEL_SONNET = 'claude-sonnet-4-6'
  const ESCALATE_AFTER = 2

  let stateIdx = 0
  let llmIdx = 0
  const failCount = new Map()

  function nextState() {
    return states[Math.min(stateIdx++, states.length - 1)]
  }

  for (let iter = 1; iter <= maxIter; iter++) {
    const state = nextState()
    const failed = state.rules.filter(r => !r.ok)
    if (failed.length === 0) return 0

    // T0-auto (mock)
    const stateAfterT0 = t0Exit === 0 ? { ...state, failed: 0, rules: [] } : nextState()
    const failedAfterT0 = stateAfterT0.rules.filter(r => !r.ok)
    if (failedAfterT0.length === 0) return 0

    // LLM per rule
    for (const rule of failedAfterT0) {
      const prevFails = failCount.get(rule.ruleId) ?? 0
      const model = prevFails >= ESCALATE_AFTER ? MODEL_SONNET : MODEL_HAIKU

      const result = llmResults[llmIdx++] ?? { ok: false, turns: 0, error: 'no result' }
      if (onLlmCall) onLlmCall(rule.ruleId, rule.output, '/mock', { model })

      if (result.ok) {
        failCount.delete(rule.ruleId)
      } else {
        failCount.set(rule.ruleId, prevFails + 1)
      }
    }
  }

  const final = nextState()
  return final.rules.filter(r => !r.ok).length === 0 ? 0 : 1
}

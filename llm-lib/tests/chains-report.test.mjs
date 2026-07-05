/**
 * Тести chains-report: агрегати per-kind/per-rule, T0-кандидати, unclosed,
 * толерантність до старих записів і сміття в JSONL.
 */
import { describe, expect, test } from 'vitest'
import { buildChainsReport, parseTraceJsonl } from '../lib/chains-report.mjs'

/**
 * Фінальний chain-запис з дефолтами.
 * @param {object} [over] поля-overrides запису
 * @returns {object} запис kind:'chain'
 */
function chain(over = {}) {
  return {
    ts: '2026-07-05T10:00:00.000Z',
    kind: 'chain',
    chainId: over.chainId ?? 'c1',
    chainKind: 'fix-concern',
    unit: 'text/cspell',
    outcome: 'success',
    steps: 2,
    localCalls: 1,
    cloudCalls: 1,
    escalated: true,
    usageCloud: { totalTokens: 100 },
    wallMs: 500,
    ...over
  }
}

describe('buildChainsReport', () => {
  test('per-kind і per-rule агрегати з escalation-rate', () => {
    const r = buildChainsReport([
      chain(),
      chain({
        chainId: 'c2',
        outcome: 'fail',
        escalated: false,
        localCalls: 2,
        cloudCalls: 0,
        usageCloud: { totalTokens: 0 }
      }),
      chain({ chainId: 'c3', chainKind: 'doc-generate', unit: 'lib/a.mjs', outcome: 'partial' })
    ])
    expect(r.perKind['fix-concern']).toMatchObject({
      chains: 2,
      success: 1,
      fail: 1,
      escalated: 1,
      escalationRate: 0.5
    })
    expect(r.perKind['doc-generate']).toMatchObject({ chains: 1, partial: 1 })
    expect(r.perRule.text).toMatchObject({ chains: 2 })
    expect(r.totals).toEqual({ chains: 3, cloudCalls: 2, cloudTokens: 200 })
  })

  test('T0-кандидати: лише units що завжди ескалюють або cloud-only, сорт за cloudTokens', () => {
    const r = buildChainsReport([
      // завжди ескалює (2/2) — кандидат
      chain({ chainId: 'a1', unit: 'ga/pins', usageCloud: { totalTokens: 50 } }),
      chain({ chainId: 'a2', unit: 'ga/pins', usageCloud: { totalTokens: 70 } }),
      // ескалює лише інколи (1/2) — НЕ кандидат
      chain({ chainId: 'b1', unit: 'js/eslint' }),
      chain({
        chainId: 'b2',
        unit: 'js/eslint',
        escalated: false,
        localCalls: 1,
        cloudCalls: 0,
        usageCloud: { totalTokens: 0 }
      }),
      // cloud-only — кандидат
      chain({
        chainId: 'd1',
        unit: 'npm/pub',
        escalated: false,
        localCalls: 0,
        cloudCalls: 1,
        usageCloud: { totalTokens: 500 }
      })
    ])
    expect(r.t0Candidates.map(u => u.unit)).toEqual(['npm/pub', 'ga/pins'])
    expect(r.t0Candidates[1]).toMatchObject({ chains: 2, alwaysEscalated: true, cloudTokens: 120 })
  })

  test('unclosed: step-записи без фінального chain-запису', () => {
    const r = buildChainsReport([
      chain({ chainId: 'ok1' }),
      { ts: '2026-07-05T10:01:00.000Z', kind: 'one-shot', chainId: 'ok1', chainKind: 'fix-concern', chainStep: 1 },
      { ts: '2026-07-05T10:02:00.000Z', kind: 'agent', chainId: 'lost', chainKind: 'fix-concern', chainStep: 1 },
      { ts: '2026-07-05T10:02:30.000Z', kind: 'agent', chainId: 'lost', chainKind: 'fix-concern', chainStep: 2 }
    ])
    expect(r.unclosed).toEqual([{ chainId: 'lost', chainKind: 'fix-concern', steps: 2 }])
  })

  test('старі записи без chain-полів і sinceTs-фільтр', () => {
    const r = buildChainsReport(
      [
        { ts: '2026-07-01T00:00:00.000Z', kind: 'one-shot', model: 'omlx/x' }, // старий формат
        chain({ ts: '2026-07-01T00:00:00.000Z', chainId: 'old' }),
        chain({ chainId: 'new' })
      ],
      { sinceTs: '2026-07-05T00:00:00.000Z' }
    )
    expect(r.totals.chains).toBe(1)
  })
})

describe('parseTraceJsonl', () => {
  test('пропускає сміття й порожні рядки', () => {
    const text = `${JSON.stringify(chain())}\n\nне json\n{"обірваний`
    const parsed = parseTraceJsonl(text)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].chainId).toBe('c1')
  })
})

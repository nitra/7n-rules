/**
 * Тести apply.mjs:
 *   - isAllowedGap: verdict ∈ {equivalent,defensive,glue,wrapper} AND confidence ≥ threshold
 *   - applyVerdicts: фільтрує rows.survived, повертає augmented rows + allowedGaps[]
 */
import { describe, expect, test } from 'vitest'

import { applyVerdicts, isAllowedGap } from '../apply.mjs'

const REASON = 'Branch is covered by integration test runStandardRule'

/**
 * Будує row-fixture для applyVerdicts (фіксовані coverage/mutation, кастомний survived).
 * @param {object[]} survived список survived-записів від класифікатора
 * @returns {object} row-об'єкт з area JS, coverage і mutation-сумами
 */
function row(survived) {
  return {
    area: 'JS',
    coverage: { lines: { covered: 10, total: 20 }, functions: { covered: 5, total: 10 } },
    mutation: { caught: 8, total: 10 },
    survived
  }
}

describe('isAllowedGap', () => {
  test('equivalent + confidence ≥ threshold → true', () => {
    const v = { verdict: 'equivalent', confidence: 0.85, reason: REASON }
    expect(isAllowedGap(v, 0.7)).toBe(true)
  })

  test('worth-testing навіть з confidence=1 → false', () => {
    const v = { verdict: 'worth-testing', confidence: 1, reason: REASON }
    expect(isAllowedGap(v, 0.7)).toBe(false)
  })

  test('defensive/glue/wrapper з достатньою confidence → true', () => {
    for (const verdict of ['defensive', 'glue', 'wrapper']) {
      expect(isAllowedGap({ verdict, confidence: 0.75, reason: REASON }, 0.7)).toBe(true)
    }
  })

  test('equivalent з confidence < threshold → false (conservative)', () => {
    const v = { verdict: 'equivalent', confidence: 0.6, reason: REASON }
    expect(isAllowedGap(v, 0.7)).toBe(false)
  })

  test('threshold = 1.1 → завжди false (rollout mode)', () => {
    const v = { verdict: 'equivalent', confidence: 1, reason: REASON }
    expect(isAllowedGap(v, 1.1)).toBe(false)
  })
})

const mkSurvived = file => ({
  file,
  mutants: [
    { line: 1, col: 1, mutantType: 'X', original: 'a', replacement: 'b' },
    { line: 2, col: 2, mutantType: 'Y', original: 'c', replacement: 'd' }
  ],
  exampleTest: null,
  recommendationText: null
})

describe('applyVerdicts', () => {
  test('всі verdicts worth-testing → нічого не фільтрується', () => {
    const rows = [row([mkSurvived('foo.mjs')])]
    const verdicts = [
      { key: 'foo.mjs:1:1:b', verdict: { verdict: 'worth-testing', confidence: 0.9, reason: REASON } },
      { key: 'foo.mjs:2:2:d', verdict: { verdict: 'worth-testing', confidence: 0.9, reason: REASON } }
    ]
    const result = applyVerdicts(rows, verdicts, 0.7)
    expect(result.allowedGaps).toEqual([])
    expect(result.rows[0].survived[0].mutants).toHaveLength(2)
    expect(result.rows[0].mutation.total).toBe(10)
  })

  test('усі verdicts equivalent → всі мутанти переходять в allowedGaps', () => {
    const rows = [row([mkSurvived('foo.mjs')])]
    const verdicts = [
      { key: 'foo.mjs:1:1:b', verdict: { verdict: 'equivalent', confidence: 0.9, reason: REASON } },
      { key: 'foo.mjs:2:2:d', verdict: { verdict: 'equivalent', confidence: 0.9, reason: REASON } }
    ]
    const result = applyVerdicts(rows, verdicts, 0.7)
    expect(result.allowedGaps).toHaveLength(2)
    expect(result.rows[0].survived).toEqual([])
    expect(result.rows[0].mutation.total).toBe(8) // 10 - 2 allowed
  })

  test('частковий — 1 equivalent, 1 worth-testing → 1 в allowedGaps, 1 залишається', () => {
    const rows = [row([mkSurvived('foo.mjs')])]
    const verdicts = [
      { key: 'foo.mjs:1:1:b', verdict: { verdict: 'equivalent', confidence: 0.9, reason: REASON } },
      { key: 'foo.mjs:2:2:d', verdict: { verdict: 'worth-testing', confidence: 0.8, reason: REASON } }
    ]
    const result = applyVerdicts(rows, verdicts, 0.7)
    expect(result.allowedGaps).toHaveLength(1)
    expect(result.allowedGaps[0].file).toBe('foo.mjs')
    expect(result.rows[0].survived).toHaveLength(1)
    expect(result.rows[0].survived[0].mutants).toHaveLength(1)
    expect(result.rows[0].survived[0].mutants[0].line).toBe(2)
    expect(result.rows[0].mutation.total).toBe(9)
  })

  test('threshold = 1.1 (rollout) → нічого не фільтрується незалежно від verdict', () => {
    const rows = [row([mkSurvived('foo.mjs')])]
    const verdicts = [{ key: 'foo.mjs:1:1:b', verdict: { verdict: 'equivalent', confidence: 1, reason: REASON } }]
    const result = applyVerdicts(rows, verdicts, 1.1)
    expect(result.allowedGaps).toEqual([])
    expect(result.rows[0].survived[0].mutants).toHaveLength(2)
  })

  test('verdict без відповідного key → mutant НЕ фільтрується (conservative)', () => {
    const rows = [row([mkSurvived('foo.mjs')])]
    const verdicts = [] // нема verdicts взагалі
    const result = applyVerdicts(rows, verdicts, 0.7)
    expect(result.allowedGaps).toEqual([])
    expect(result.rows[0].survived[0].mutants).toHaveLength(2)
  })

  test('rows без survived → no-op, без мутацій rows', () => {
    const rows = [{ ...row(), survived: undefined }]
    const result = applyVerdicts(rows, [], 0.7)
    expect(result.allowedGaps).toEqual([])
    expect(result.rows[0].mutation.total).toBe(10)
  })

  test('multiple rows, partial overlap у verdicts', () => {
    const rows = [row([mkSurvived('a.mjs')]), row([mkSurvived('b.mjs')])]
    const verdicts = [
      { key: 'a.mjs:1:1:b', verdict: { verdict: 'glue', confidence: 0.9, reason: REASON } },
      { key: 'b.mjs:2:2:d', verdict: { verdict: 'wrapper', confidence: 0.9, reason: REASON } }
    ]
    const result = applyVerdicts(rows, verdicts, 0.7)
    expect(result.allowedGaps).toHaveLength(2)
    expect(result.rows[0].survived[0].mutants).toHaveLength(1)
    expect(result.rows[1].survived[0].mutants).toHaveLength(1)
  })
})

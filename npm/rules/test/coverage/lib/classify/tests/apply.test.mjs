import { vi, describe, it, expect, beforeEach } from 'vitest'
import { applyVerdicts } from '../apply.mjs'

describe('applyVerdicts', () => {
  const mockRows = [
    {
      area: 'rule1',
      coverage: { lines: { covered: 10, total: 10 }, functions: { covered: 5, total: 5 } },
      mutation: { caught: 5, total: 10 },
      survived: [
        {
          file: 'src/file1.js',
          mutants: [
            {
              line: 10,
              col: 1,
              mutantType: 'eq',
              original: 'a',
              replacement: 'b'
            }
          ],
          exampleTest: null,
          recommendationText: null
        }
      ]
    }
  ]

  const mockVerdicts = [
    { key: 'src/file1.js:10:1:b', verdict: { verdict: 'equivalent', confidence: 0.9, reason: 'Same logic' } }
  ]

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should mark equivalent mutants as allowed gaps if confidence >= threshold', () => {
    const result = applyVerdicts(mockRows, mockVerdicts, 0.8)
    expect(result.allowedGaps).toHaveLength(1)
    expect(result.rows[0].mutation.total).toBe(9)
    expect(result.rows[0].survived).toHaveLength(0)
  })

  it('should keep mutants if verdict is not in SKIP_VERDICTS, even if confidence is high', () => {
    const customVerdicts = [
      { key: 'src/file1.js:10:1:b', verdict: { verdict: 'worth-testing', confidence: 0.99, reason: 'Test needed' } }
    ]
    const result = applyVerdicts(mockRows, customVerdicts, 0.8)

    // worth-testing is not skipped, so it stays
    expect(result.allowedGaps).toHaveLength(0)
    expect(result.rows[0].mutation.total).toBe(10)
    expect(result.rows[0].survived[0].mutants).toHaveLength(1)
  })

  it('should keep mutants if verdict is in SKIP_VERDICTS but confidence < threshold', () => {
    const customVerdicts = [
      { key: 'src/file1.js:10:1:b', verdict: { verdict: 'equivalent', confidence: 0.5, reason: 'Low confidence' } }
    ]
    const result = applyVerdicts(mockRows, customVerdicts, 0.8)

    // Equivalent but confidence (0.5 < 0.8) -> should NOT be skipped
    expect(result.allowedGaps).toHaveLength(0)
    expect(result.rows[0].mutation.total).toBe(10)
    expect(result.rows[0].survived[0].mutants).toHaveLength(1)
  })
})

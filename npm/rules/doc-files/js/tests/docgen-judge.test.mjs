import { describe, expect, test } from 'vitest'

import { JUDGE_CONFIDENCE, judgeFailsDoc, parseDocVerdict } from '../docgen-judge.mjs'

describe('parseDocVerdict', () => {
  test('витягує valid verdict з обрамленого тексту', () => {
    const v = parseDocVerdict('бла {"verdict":"inaccurate","confidence":0.9,"reason":"wrong return"} кінець')
    expect(v).toEqual({ verdict: 'inaccurate', confidence: 0.9, reason: 'wrong return' })
  })

  test('нема JSON → throws', () => {
    expect(() => parseDocVerdict('no json here')).toThrow()
  })

  test('невідомий verdict → throws', () => {
    expect(() => parseDocVerdict('{"verdict":"maybe","confidence":0.5,"reason":"x"}')).toThrow()
  })

  test('confidence поза [0,1] → throws', () => {
    expect(() => parseDocVerdict('{"verdict":"accurate","confidence":2,"reason":"x"}')).toThrow()
  })
})

describe('judgeFailsDoc', () => {
  test('inaccurate ≥ поріг → true', () => {
    expect(judgeFailsDoc({ verdict: 'inaccurate', confidence: JUDGE_CONFIDENCE })).toBe(true)
  })

  test('inaccurate нижче порога → false', () => {
    expect(judgeFailsDoc({ verdict: 'inaccurate', confidence: 0.1 })).toBe(false)
  })

  test('accurate (навіть високий confidence) → false', () => {
    expect(judgeFailsDoc({ verdict: 'accurate', confidence: 0.99 })).toBe(false)
  })

  test('generic → false (scope лише inaccurate)', () => {
    expect(judgeFailsDoc({ verdict: 'generic', confidence: 0.99 })).toBe(false)
  })

  test('null → false', () => {
    expect(judgeFailsDoc(null)).toBe(false)
  })
})

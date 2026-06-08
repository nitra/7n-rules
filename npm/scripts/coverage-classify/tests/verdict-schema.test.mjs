/**
 * Тести для verdict-schema.mjs: zod-валідація відповіді LLM-класифікатора
 * і parseVerdict — витяг JSON з raw-text відповіді з retry-friendly помилкою.
 */
import { describe, expect, test } from 'vitest'

import { parseVerdict, VerdictSchema } from '../verdict-schema.mjs'

const MIN_REASON = 'Branch is covered by integration test runStandardRule'
const NO_JSON_RE = /No JSON/u

describe('VerdictSchema', () => {
  test('валідний worth-testing verdict', () => {
    const v = {
      verdict: 'worth-testing',
      confidence: 0.85,
      reason: MIN_REASON,
      suggestedTest: 'Test branch with condition x === 1'
    }
    expect(VerdictSchema.parse(v)).toEqual(v)
  })

  test('валідний equivalent verdict без suggestedTest', () => {
    const v = { verdict: 'equivalent', confidence: 0.92, reason: MIN_REASON }
    expect(VerdictSchema.parse(v)).toEqual(v)
  })

  test('reject: невідомий verdict-enum', () => {
    expect(() => VerdictSchema.parse({ verdict: 'unknown', confidence: 0.5, reason: MIN_REASON })).toThrow()
  })

  test('reject: confidence > 1', () => {
    expect(() => VerdictSchema.parse({ verdict: 'glue', confidence: 1.5, reason: MIN_REASON })).toThrow()
  })

  test('reject: confidence < 0', () => {
    expect(() => VerdictSchema.parse({ verdict: 'glue', confidence: -0.1, reason: MIN_REASON })).toThrow()
  })

  test('reject: reason < 20 символів', () => {
    expect(() => VerdictSchema.parse({ verdict: 'glue', confidence: 0.5, reason: 'short' })).toThrow()
  })

  test('reject: reason > 500 символів', () => {
    expect(() => VerdictSchema.parse({ verdict: 'glue', confidence: 0.5, reason: 'x'.repeat(501) })).toThrow()
  })

  test('reject: suggestedTest > 300 символів', () => {
    expect(() =>
      VerdictSchema.parse({
        verdict: 'worth-testing',
        confidence: 0.5,
        reason: MIN_REASON,
        suggestedTest: 'x'.repeat(301)
      })
    ).toThrow()
  })
})

describe('parseVerdict', () => {
  test('видобуває JSON з чистого тексту', () => {
    const raw = `{"verdict":"glue","confidence":0.8,"reason":"${MIN_REASON}"}`
    expect(parseVerdict(raw)).toEqual({ verdict: 'glue', confidence: 0.8, reason: MIN_REASON })
  })

  test('видобуває JSON з тексту з prefix/suffix', () => {
    const raw = `Here is my classification:\n{"verdict":"glue","confidence":0.8,"reason":"${MIN_REASON}"}\n\nDone.`
    expect(parseVerdict(raw).verdict).toBe('glue')
  })

  test("throw коли немає JSON-об'єкта у тексті", () => {
    expect(() => parseVerdict('No JSON here')).toThrow(NO_JSON_RE)
  })

  test('throw на невалідному JSON', () => {
    expect(() => parseVerdict('{ broken json')).toThrow()
  })

  test('throw коли JSON не відповідає схемі', () => {
    expect(() => parseVerdict('{"verdict":"x","confidence":0.5,"reason":"short"}')).toThrow()
  })
})

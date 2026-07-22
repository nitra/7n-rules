import { describe, expect, it } from 'vitest'

import { parseVerdict, VerdictSchema } from '../verdict-schema.mjs'

const REASON = 'This mutant is behaviorally equivalent to the original branch'

describe('parseVerdict', () => {
  it('parses a clean JSON response', () => {
    const raw = JSON.stringify({ verdict: 'equivalent', confidence: 0.9, reason: REASON })
    expect(parseVerdict(raw)).toEqual({ verdict: 'equivalent', confidence: 0.9, reason: REASON })
  })

  it('strips a markdown code fence around the JSON', () => {
    const raw = `Here is my classification:\n\`\`\`json\n${JSON.stringify({ verdict: 'worth-testing', confidence: 0.8, reason: REASON })}\n\`\`\`\nLet me know if you need more detail.`
    const verdict = parseVerdict(raw)
    expect(verdict.verdict).toBe('worth-testing')
  })

  it('discards trailing prose after a balanced JSON object with no fence', () => {
    const raw = `${JSON.stringify({ verdict: 'defensive', confidence: 0.7, reason: REASON })}\n\nHope this helps!`
    const verdict = parseVerdict(raw)
    expect(verdict.verdict).toBe('defensive')
  })

  it("repairs an unescaped double quote inside reason (real failure: \"Expected ',' or '}'\")", () => {
    const raw = `{"verdict":"equivalent","confidence":0.9,"reason":"checks if user.role === "admin" without further validation of the input"}`
    const verdict = parseVerdict(raw)
    expect(verdict.verdict).toBe('equivalent')
    expect(verdict.reason).toContain('"admin"')
  })

  it('repairs an invalid backslash escape inside reason (real failure: "Bad escaped character")', () => {
    const raw = String.raw`{"verdict":"worth-testing","confidence":0.8,"reason":"matches against /\d+/ pattern which is never exercised with negative input"}`
    const verdict = parseVerdict(raw)
    expect(verdict.verdict).toBe('worth-testing')
    expect(verdict.reason).toContain('/\\d+/')
  })

  it('repairs a literal newline inside a string value', () => {
    const raw =
      '{"verdict":"worth-testing","confidence":0.8,"reason":"first line of the\nexplanation continues on a second line here"}'
    const verdict = parseVerdict(raw)
    expect(verdict.verdict).toBe('worth-testing')
    expect(verdict.reason).toContain('\n')
  })

  it('drops a trailing comma before the closing brace', () => {
    const raw = `{"verdict":"glue","confidence":0.6,"reason":"${REASON}",}`
    const verdict = parseVerdict(raw)
    expect(verdict.verdict).toBe('glue')
  })

  it('truncates an over-length reason instead of failing schema validation (real failure: "too_big")', () => {
    const longReason = 'x'.repeat(600)
    const raw = JSON.stringify({ verdict: 'worth-testing', confidence: 0.5, reason: longReason })
    const verdict = parseVerdict(raw)
    expect(verdict.reason.length).toBeLessThanOrEqual(500)
  })

  it('truncates an over-length suggestedTest instead of failing schema validation', () => {
    const longTest = 'y'.repeat(400)
    const raw = JSON.stringify({ verdict: 'worth-testing', confidence: 0.5, reason: REASON, suggestedTest: longTest })
    const verdict = parseVerdict(raw)
    expect(verdict.suggestedTest.length).toBeLessThanOrEqual(300)
  })

  it('throws when no JSON object is present', () => {
    expect(() => parseVerdict('sorry, I cannot classify this mutant')).toThrow('No JSON object found')
  })

  it('throws when the extracted JSON does not match the schema', () => {
    const raw = JSON.stringify({ verdict: 'not-a-real-verdict', confidence: 0.9, reason: REASON })
    expect(() => parseVerdict(raw)).toThrow()
  })
})

describe('VerdictSchema', () => {
  it('rejects a reason shorter than 20 chars', () => {
    const result = VerdictSchema.safeParse({ verdict: 'equivalent', confidence: 0.9, reason: 'too short' })
    expect(result.success).toBe(false)
  })
})

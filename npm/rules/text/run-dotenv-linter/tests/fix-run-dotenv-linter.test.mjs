/**
 * Тест T0-патерну `fix-run-dotenv-linter.mjs` (перенесено з колишнього `text/check/fix-check.mjs`).
 */
import { describe, expect, test } from 'vitest'
import { patterns } from '../fix-run-dotenv-linter.mjs'

describe('text/run-dotenv-linter fix pattern', () => {
  test('один патерн, реагує лише на reason dotenv-linter', () => {
    expect(patterns.map(p => p.id)).toEqual(['text-dotenv-fix'])
    expect(patterns[0].test([{ reason: 'dotenv-linter', message: 'm' }])).toBe(true)
    expect(patterns[0].test([{ reason: 'v8r', message: 'm' }])).toBe(false)
    expect(patterns[0].test([{ reason: 'cspell', message: 'm' }])).toBe(false)
  })
})

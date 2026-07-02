/**
 * Тест T0-патерну `fix-markdownlint.mjs` (перенесено з колишнього `text/check/fix-check.mjs`).
 */
import { describe, expect, test } from 'vitest'
import { patterns } from '../fix-markdownlint.mjs'

describe('text/markdownlint fix pattern', () => {
  test('один патерн, реагує лише на reason markdownlint', () => {
    expect(patterns.map(p => p.id)).toEqual(['text-markdownlint-fix'])
    expect(patterns[0].test([{ reason: 'markdownlint', message: 'm' }])).toBe(true)
    expect(patterns[0].test([{ reason: 'shellcheck', message: 'm' }])).toBe(false)
    expect(patterns[0].test([{ reason: 'cspell', message: 'm' }])).toBe(false)
  })
})

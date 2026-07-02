/**
 * Тест T0-патерну `fix-run-shellcheck.mjs` (перенесено з колишнього `text/check/fix-check.mjs`).
 */
import { describe, expect, test } from 'vitest'
import { patterns } from '../fix-run-shellcheck.mjs'

describe('text/run-shellcheck fix pattern', () => {
  test('один патерн, реагує лише на reason shellcheck', () => {
    expect(patterns.map(p => p.id)).toEqual(['text-shellcheck-fix'])
    expect(patterns[0].test([{ reason: 'shellcheck', message: 'm' }])).toBe(true)
    expect(patterns[0].test([{ reason: 'markdownlint', message: 'm' }])).toBe(false)
    expect(patterns[0].test([{ reason: 'cspell', message: 'm' }])).toBe(false)
  })
})

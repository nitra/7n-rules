/**
 * Тести T0-codemod `fix-check.mjs`. Реальний `markdownlint --fix` зав'язаний на
 * markdownlint-cli2 + git (перевірено вручну/e2e); тут — контракт патерну: test-предикат.
 */
import { describe, expect, test } from 'vitest'
import { patterns } from '../fix-check.mjs'

const P = patterns[0]

describe('text-markdownlint-fix pattern', () => {
  test('єдиний патерн з очікуваним id', () => {
    expect(patterns).toHaveLength(1)
    expect(P.id).toBe('text-markdownlint-fix')
  })

  test('test: true на markdownlint-порушенні', () => {
    expect(P.test([{ reason: 'markdownlint', message: 'm' }])).toBe(true)
  })

  test('test: false на інших під-тулах text/check', () => {
    expect(P.test([{ reason: 'cspell', message: 'm' }])).toBe(false)
    expect(P.test([{ reason: 'v8r', message: 'm' }])).toBe(false)
    expect(P.test([])).toBe(false)
  })
})

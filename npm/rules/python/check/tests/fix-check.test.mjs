/**
 * Тести T0-codemod `fix-check.mjs` (python). Реальний `ruff check --fix`/`format` зав'язаний
 * на uv-проєкт (перевірено e2e); тут — контракт патерну: test-предикат.
 */
import { describe, expect, test } from 'vitest'
import { patterns } from '../fix-check.mjs'

const P = patterns[0]

describe('python-ruff-fix pattern', () => {
  test('id', () => {
    expect(patterns).toHaveLength(1)
    expect(P.id).toBe('python-ruff-fix')
  })

  test('test: true на ruff check/format порушеннях', () => {
    expect(P.test([{ reason: 'ruff-check-violation', message: 'm' }])).toBe(true)
    expect(P.test([{ reason: 'ruff-format-violation', message: 'm' }])).toBe(true)
  })

  test('test: false на інших', () => {
    expect(P.test([{ reason: 'uv-missing', message: 'm' }])).toBe(false)
    expect(P.test([])).toBe(false)
  })
})

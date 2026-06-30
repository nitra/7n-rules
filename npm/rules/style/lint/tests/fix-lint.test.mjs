/**
 * Тести T0-codemod `fix-lint.mjs`. Реальний `stylelint --fix` зав'язаний на stylelint +
 * конфіг + css-fixture (перевіряється e2e); тут — контракт патерну: test-предикат і
 * скоупинг (відсутність style-файлів → лінтер не запускається).
 */
import { describe, expect, test } from 'vitest'
import { patterns } from '../fix-lint.mjs'

const P = patterns[0]

describe('style-stylelint-fix pattern', () => {
  test('єдиний патерн з очікуваним id', () => {
    expect(patterns).toHaveLength(1)
    expect(P.id).toBe('style-stylelint-fix')
  })

  test('test: true на stylelint-violation', () => {
    expect(P.test([{ reason: 'stylelint-violation', message: 'm' }])).toBe(true)
  })

  test('test: false без stylelint-violation', () => {
    expect(P.test([{ reason: 'other', message: 'm' }])).toBe(false)
    expect(P.test([])).toBe(false)
  })

  test('apply: дельта без style-файлів → touchedFiles порожній', () => {
    const res = P.apply([{ reason: 'stylelint-violation', message: 'm' }], { cwd: '/tmp', files: ['a.js', 'b.ts'] })
    expect(res.touchedFiles).toEqual([])
  })
})

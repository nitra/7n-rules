/**
 * Тести T0-codemod `fix-eslint.mjs`. Реальний прогін oxlint/eslint --fix зав'язаний на
 * зовнішні лінтери + конфіг репо (перевірено вручну + e2e); тут — контракт патерну:
 * test-предикат і скоупинг лише js-файлів (без зайвого виклику лінтерів).
 */
import { describe, expect, test } from 'vitest'
import { patterns } from '../fix-eslint.mjs'

const P = patterns[0]

describe('js-eslint-autofix pattern', () => {
  test('єдиний патерн з очікуваним id', () => {
    expect(patterns).toHaveLength(1)
    expect(P.id).toBe('js-eslint-autofix')
  })

  test('test: true коли є violation з file', () => {
    expect(P.test([{ reason: 'x', message: 'm', file: 'a.mjs' }])).toBe(true)
  })

  test('test: false коли violations без file', () => {
    expect(P.test([{ reason: 'x', message: 'm' }])).toBe(false)
    expect(P.test([])).toBe(false)
  })

  test('apply: лише не-js файли → лінтери не запускаються, touchedFiles порожній', async () => {
    const res = await P.apply([{ reason: 'x', message: 'm', file: 'README.md' }], { cwd: '/nonexistent-cwd' })
    expect(res.touchedFiles).toEqual([])
  })
})

import { describe, expect, test } from 'vitest'

import { extractFacts } from '../docgen-extract.mjs'

const caches = src => extractFacts(src, 'x.mjs').markers.caches
const symbols = src => extractFacts(src, 'x.mjs').localSymbols

describe('markers.caches — лише іменований cache/memo-маркер, не будь-який new Map() (R2)', () => {
  test('акумулятор new Map() не вважається кешем', () => {
    expect(caches('const byPath = new Map()\n')).toBe(false)
  })

  test('іменований cache-ідентифікатор → кеш', () => {
    expect(caches('function go(walkCache) {}\n')).toBe(true)
  })

  test('memoize → кеш', () => {
    expect(caches('const memoize = fn => fn\n')).toBe(true)
  })

  test('файл без кешу → false', () => {
    expect(caches('export const a = 1\n')).toBe(false)
  })
})

describe('localSymbols — неекспортовані top-level функції/класи (R6)', () => {
  test('службова функція потрапляє, експортована — ні', () => {
    const src = 'export function check() {}\nfunction helper() {}\nclass Inner {}\n'
    const ls = symbols(src)
    expect(ls).toContain('helper')
    expect(ls).toContain('Inner')
    expect(ls).not.toContain('check')
  })

  test('файл лише з експортами → порожньо', () => {
    expect(symbols('export const a = 1\nexport function b() {}\n')).toEqual([])
  })
})

import { describe, expect, test } from 'vitest'

import { extractFacts } from '../main.mjs'

const caches = src => extractFacts(src, 'x.mjs').markers.caches
const symbols = src => extractFacts(src, 'x.mjs').localSymbols
const readOnly = src => extractFacts(src, 'x.mjs').markers.readOnly

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

describe('markers.readOnly — raw-SQL tagged-template мутації (DML у тілі шаблону)', () => {
  test('pgWrite`UPDATE ...` → не read-only', () => {
    expect(readOnly('function go() {\n  pgWrite`UPDATE users SET x = 1`\n}\n')).toBe(false)
  })

  test('pgWrite`MERGE INTO ...` → не read-only', () => {
    expect(readOnly('pgWrite`MERGE INTO t USING s ON t.id = s.id`\n')).toBe(false)
  })

  test('pgWrite`DELETE FROM ...` → не read-only', () => {
    expect(readOnly('pgWrite`DELETE FROM t WHERE id = 1`\n')).toBe(false)
  })

  test('pgRead`SELECT ...` → read-only (не тригериться на SELECT)', () => {
    expect(readOnly('const rows = pgRead`SELECT * FROM t`\n')).toBe(true)
  })

  test('коментар/рядок зі словом "update" поза tagged-template → read-only', () => {
    expect(readOnly('// update the docs later\nconst s = "update"\n')).toBe(true)
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

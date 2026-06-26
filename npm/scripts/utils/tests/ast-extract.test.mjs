/**
 * Тести ast-extract: generic AST-facts (imports/exports/topLevelFunctions) на oxc.
 *   - imports зі specifiers; named/default/all exports; export const arrow → і export, і function
 *   - parse fail / read fail → деградація до empty з error
 */

import { describe, expect, test } from 'vitest'
import { extractContext, extractContextFromSource } from '../ast-extract.mjs'

describe('extractContextFromSource', () => {
  test('imports із джерелом і локальними іменами', () => {
    const src = `import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import * as os from 'node:os'`
    const r = extractContextFromSource(src, 'x.mjs')
    expect(r.imports).toEqual([
      { source: 'node:fs', names: ['readFileSync', 'writeFileSync'] },
      { source: 'node:path', names: ['path'] },
      { source: 'node:os', names: ['os'] }
    ])
  })

  test('named export декларацій (const, function, class)', () => {
    const src = `export const GREETING = 'hi'
export function doWork() {}
export class Thing {}`
    const r = extractContextFromSource(src, 'x.mjs')
    expect(r.exports).toEqual(['GREETING', 'doWork', 'Thing'])
    expect(r.topLevelFunctions).toContain('doWork')
  })

  test('export const arrow → і export, і topLevelFunction', () => {
    const r = extractContextFromSource(`export const handler = async () => 42`, 'x.mjs')
    expect(r.exports).toContain('handler')
    expect(r.topLevelFunctions).toContain('handler')
  })

  test('export { a, b } specifiers', () => {
    const src = `const a = 1, b = 2
export { a, b }`
    const r = extractContextFromSource(src, 'x.mjs')
    expect(r.exports).toEqual(expect.arrayContaining(['a', 'b']))
  })

  test('default export → "default"', () => {
    expect(extractContextFromSource(`export default function () {}`, 'x.mjs').exports).toContain('default')
  })

  test('export * as ns', () => {
    expect(extractContextFromSource(`export * as helpers from './h.mjs'`, 'x.mjs').exports).toContain('helpers')
  })

  test('top-level function declaration (не експортована)', () => {
    expect(extractContextFromSource(`function internal() {}`, 'x.mjs').topLevelFunctions).toEqual(['internal'])
  })

  test('синтаксична помилка → empty з error', () => {
    const r = extractContextFromSource(`export const = = =`, 'x.mjs')
    expect(r.error).toBe('parse failed')
    expect(r.imports).toEqual([])
    expect(r.exports).toEqual([])
  })
})

describe('extractContext (file IO)', () => {
  test('неіснуючий файл → empty з read error (не кидає)', () => {
    const r = extractContext('/nonexistent/path/nope.mjs')
    expect(r.error).toMatch(/read failed/)
    expect(r.topLevelFunctions).toEqual([])
  })
})

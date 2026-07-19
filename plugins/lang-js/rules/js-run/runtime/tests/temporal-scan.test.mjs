/**
 * Модульні тести AST-сканера заборони `Temporal` у Bun runtime.
 */
import { describe, expect, test } from 'vitest'

import { findTemporalUsageInText, isTemporalScanSourceFile } from '../../lib/temporal-scan.mjs'

describe('temporal-scan (oxc)', () => {
  test('Temporal.Now.instant() — порушення', () => {
    const hits = findTemporalUsageInText(`const now = Temporal.Now.instant()\n`, 'x.js')
    expect(hits).toHaveLength(1)
    expect(hits[0].line).toBe(1)
  })

  test("import { Temporal } from '@js-temporal/polyfill' — порушення", () => {
    const hits = findTemporalUsageInText(`import { Temporal } from '@js-temporal/polyfill'\n`, 'x.ts')
    expect(hits).toHaveLength(1)
  })

  test('звичайний Date не дає порушень', () => {
    const hits = findTemporalUsageInText(`const stamp = new Date().toISOString()\n`, 'x.js')
    expect(hits).toHaveLength(0)
  })

  test("isTemporalScanSourceFile — JS/TS-сім'я, без .d.ts", () => {
    expect(isTemporalScanSourceFile('src/a.ts')).toBe(true)
    expect(isTemporalScanSourceFile('src/a.mjs')).toBe(true)
    expect(isTemporalScanSourceFile('src/a.tsx')).toBe(true)
    expect(isTemporalScanSourceFile('src/a.json')).toBe(false)
    expect(isTemporalScanSourceFile('src/a.d.ts')).toBe(false)
  })
})

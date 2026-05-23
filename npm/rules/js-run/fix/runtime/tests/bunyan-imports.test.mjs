/**
 * Модульні тести для сканування заборонених імпортів `@nitra/bunyan` / `bunyan` (js-run.mdc),
 * парсер — oxc-parser.
 */
import { describe, expect, test } from 'bun:test'

import { findBunyanImportsInText, isBunyanScanSourceFile, shouldSkipFileForBunyanScan } from '../bunyan-imports.mjs'

describe('bunyan-imports (oxc)', () => {
  test('default import з @nitra/bunyan', () => {
    const hits = findBunyanImportsInText(`import log from '@nitra/bunyan'\n`, 'x.ts')
    expect(hits.length).toBe(1)
    expect(hits[0].module).toBe('@nitra/bunyan')
    expect(hits[0].line).toBe(1)
  })

  test('named import з застарілого bunyan', () => {
    const hits = findBunyanImportsInText(`import { createLogger } from 'bunyan'\n`, 'x.js')
    expect(hits.length).toBe(1)
    expect(hits[0].module).toBe('bunyan')
  })

  test('side-effect import все одно порушення', () => {
    const hits = findBunyanImportsInText(`import '@nitra/bunyan'\n`, 'x.ts')
    expect(hits.length).toBe(1)
  })

  test('require("@nitra/bunyan") — порушення', () => {
    const hits = findBunyanImportsInText(`const log = require('@nitra/bunyan')\n`, 'x.cjs')
    expect(hits.length).toBe(1)
    expect(hits[0].module).toBe('@nitra/bunyan')
  })

  test('динамічний import("@nitra/bunyan") — порушення', () => {
    const hits = findBunyanImportsInText(`const m = await import('@nitra/bunyan')\n`, 'x.ts')
    expect(hits.length).toBe(1)
  })

  test('імпорти з @nitra/pino — без порушень', () => {
    expect(findBunyanImportsInText(`import log from '@nitra/pino'\n`, 'x.ts').length).toBe(0)
    expect(findBunyanImportsInText(`const x = require('@nitra/pino')\n`, 'x.cjs').length).toBe(0)
  })

  test('multiline import зберігає номер рядка початку', () => {
    const src = `// header\nimport {\n  a,\n  b\n} from '@nitra/bunyan'\n`
    const hits = findBunyanImportsInText(src, 'x.ts')
    expect(hits.length).toBe(1)
    expect(hits[0].line).toBe(2)
  })

  test('isBunyanScanSourceFile / shouldSkipFileForBunyanScan', () => {
    expect(isBunyanScanSourceFile('src/a.ts')).toBe(true)
    expect(isBunyanScanSourceFile('src/a.mjs')).toBe(true)
    expect(isBunyanScanSourceFile('src/a.tsx')).toBe(true)
    expect(isBunyanScanSourceFile('src/a.json')).toBe(false)
    expect(shouldSkipFileForBunyanScan('src/a.d.ts')).toBe(true)
    expect(shouldSkipFileForBunyanScan('src/a.ts')).toBe(false)
  })
})

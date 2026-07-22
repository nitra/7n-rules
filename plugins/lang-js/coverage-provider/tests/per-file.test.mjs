import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { collectPerFile, parseLcovPerFile } from '../per-file.mjs'

describe('parseLcovPerFile', () => {
  test('парсить SF/LF/LH у per-file рядки з pct', () => {
    const lcov = [
      'SF:src/a.mjs',
      'LF:10',
      'LH:8',
      'end_of_record',
      'SF:src/b.mjs',
      'LF:4',
      'LH:0',
      'end_of_record'
    ].join('\n')
    expect(parseLcovPerFile(lcov)).toEqual([
      { file: 'src/a.mjs', pct: 80, linesFound: 10, linesCovered: 8 },
      { file: 'src/b.mjs', pct: 0, linesFound: 4, linesCovered: 0 }
    ])
  })

  test('LF:0 → 100% (нема що покривати)', () => {
    const lcov = ['SF:src/empty.mjs', 'LF:0', 'LH:0', 'end_of_record'].join('\n')
    expect(parseLcovPerFile(lcov)[0].pct).toBe(100)
  })
})

/**
 * Runner-стаб: пише заданий lcov у lcovDir і повертає 0.
 * @param {string} lcov вміст lcov.info
 * @returns {{runJsCoverage: (opts: object) => number, calls: object[]}} стаб зі списком викликів
 */
function stubRunner(lcov) {
  const calls = []
  return {
    calls,
    runJsCoverage(opts) {
      calls.push(opts)
      writeFileSync(join(opts.lcovDir, 'lcov.info'), lcov)
      return 0
    }
  }
}

describe('collectPerFile', () => {
  let dir

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'per-file-test-'))
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 't', devDependencies: { vitest: '^4.0.0' } }))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test('повертає рядки лише для запитаних файлів-кандидатів', async () => {
    mkdirSync(join(dir, 'src'), { recursive: true })
    writeFileSync(join(dir, 'src/logic.mjs'), 'export function f(x) {\n  if (x) { return 1 }\n  return 0\n}\n')
    const lcov = [
      'SF:src/logic.mjs',
      'LF:4',
      'LH:1',
      'end_of_record',
      'SF:src/other.mjs',
      'LF:2',
      'LH:2',
      'end_of_record'
    ].join('\n')
    const runner = stubRunner(lcov)
    const rows = await collectPerFile(dir, { files: ['src/logic.mjs'], runner })
    expect(rows).toEqual([
      { file: 'src/logic.mjs', pct: 25, linesFound: 4, linesCovered: 1, reason: 'містить функції з розгалуженнями' }
    ])
    expect(runner.calls[0].extraArgs).toContain('--coverage.include=src/logic.mjs')
    expect(runner.calls[0].extraArgs).toContain('--exclude=**/.*/**')
    expect(runner.calls[0].excludeStorybookProject).toBe(true)
  })

  test('wiring-файли (quickClassify needsTests:false) виключаються з гейта', async () => {
    mkdirSync(join(dir, 'src'), { recursive: true })
    writeFileSync(join(dir, 'src/index.mjs'), "export { f } from './logic.mjs'\n")
    const lcov = ['SF:src/index.mjs', 'LF:1', 'LH:0', 'end_of_record'].join('\n')
    const rows = await collectPerFile(dir, { files: ['src/index.mjs'], runner: stubRunner(lcov) })
    expect(rows).toEqual([])
  })

  test('тести/сторі/конфіги/.vue не є кандидатами делта-гейта', async () => {
    const runner = stubRunner('')
    const rows = await collectPerFile(dir, {
      files: ['src/a.test.mjs', 'src/B.stories.ts', 'vitest.config.mjs', 'src/C.vue', 'types/x.d.ts'],
      runner
    })
    expect(rows).toEqual([])
    expect(runner.calls).toEqual([])
  })

  test('root без vitest (і без hoisted у корені) → тихий skip', async () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 't' }))
    mkdirSync(join(dir, 'src'), { recursive: true })
    writeFileSync(join(dir, 'src/logic.mjs'), 'export const x = 1\n')
    const runner = stubRunner('')
    const rows = await collectPerFile(dir, { files: ['src/logic.mjs'], runner })
    expect(rows).toEqual([])
    expect(runner.calls).toEqual([])
  })

  test('vitest exit ≠ 0 → кидає з кодом', async () => {
    mkdirSync(join(dir, 'src'), { recursive: true })
    writeFileSync(join(dir, 'src/logic.mjs'), 'export const x = 1\n')
    const runner = { runJsCoverage: () => 1 }
    await expect(collectPerFile(dir, { files: ['src/logic.mjs'], runner })).rejects.toThrow('vitest exit 1')
  })
})

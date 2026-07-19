/**
 * Тести T0-codemod `fix-eslint.mjs`. Реальний прогін oxlint/eslint --fix зав'язаний на
 * зовнішні лінтери + конфіг репо (перевірено вручну + e2e); тут — контракт патерну:
 * test-предикат і скоупинг лише js-файлів (без зайвого виклику лінтерів).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, test, vi } from 'vitest'

import { patterns } from '../fix-eslint.mjs'
import { withTmpDir } from '@7n/rules/scripts/utils/test-helpers.mjs'

const AUTOFIX = patterns[0]
const MECHANICAL = patterns[1]

describe('js-eslint-autofix pattern', () => {
  test('2 патерни, перший — очікуваний id', () => {
    expect(patterns).toHaveLength(2)
    expect(AUTOFIX.id).toBe('js-eslint-autofix')
  })

  test('test: true коли є violation з file', () => {
    expect(AUTOFIX.test([{ reason: 'x', message: 'm', file: 'a.mjs' }])).toBe(true)
  })

  test('test: false коли violations без file', () => {
    expect(AUTOFIX.test([{ reason: 'x', message: 'm' }])).toBe(false)
    expect(AUTOFIX.test([])).toBe(false)
  })

  test('apply: лише не-js файли → лінтери не запускаються, touchedFiles порожній', async () => {
    const res = await AUTOFIX.apply([{ reason: 'x', message: 'm', file: 'README.md' }], { cwd: '/nonexistent-cwd' })
    expect(res.touchedFiles).toEqual([])
  })
})

describe('js-eslint-mechanical-text-fix pattern', () => {
  test('id', () => {
    expect(MECHANICAL.id).toBe('js-eslint-mechanical-text-fix')
  })

  test('test: true на unicorn/prefer-number-is-safe-integer (обидва формати reason)', () => {
    expect(
      MECHANICAL.test([
        { reason: 'unicorn/prefer-number-is-safe-integer', message: 'm', file: 'a.js', data: { line: 1 } }
      ])
    ).toBe(true)
    expect(
      MECHANICAL.test([
        { reason: 'unicorn(prefer-number-is-safe-integer)', message: 'm', file: 'a.js', data: { line: 1 } }
      ])
    ).toBe(true)
  })

  test('test: false без file/data.line або на невідомому reason', () => {
    expect(MECHANICAL.test([{ reason: 'unicorn/prefer-number-is-safe-integer', message: 'm' }])).toBe(false)
    expect(MECHANICAL.test([{ reason: 'unicorn/prefer-number-is-safe-integer', message: 'm', file: 'a.js' }])).toBe(
      false
    )
    expect(MECHANICAL.test([{ reason: 'jsdoc/require-returns', message: 'm', file: 'a.js', data: { line: 1 } }])).toBe(
      false
    )
    expect(MECHANICAL.test([])).toBe(false)
  })

  test('apply: замінює Number.isInteger → Number.isSafeInteger лише на позначеному рядку', async () => {
    await withTmpDir(async dir => {
      const file = join(dir, 'a.js')
      writeFileSync(file, 'const ok = Number.isInteger(x)\nconst other = Number.isInteger(y)\n', 'utf8')
      const recordWrite = vi.fn()
      const res = await MECHANICAL.apply(
        [{ reason: 'unicorn/prefer-number-is-safe-integer', message: 'm', file: 'a.js', data: { line: 1 } }],
        { cwd: dir, recordWrite }
      )
      expect(res.touchedFiles).toEqual([file])
      expect(recordWrite).toHaveBeenCalledWith(file)
      const content = readFileSync(file, 'utf8')
      expect(content).toBe('const ok = Number.isSafeInteger(x)\nconst other = Number.isInteger(y)\n')
    })
  })

  test('apply: рядок без очікуваного шаблону (файл змінився з detect-у) → пропускається, файл не пишеться', async () => {
    await withTmpDir(async dir => {
      const file = join(dir, 'a.js')
      writeFileSync(file, 'const ok = SOMETHING_ELSE\n', 'utf8')
      const res = await MECHANICAL.apply(
        [{ reason: 'unicorn/prefer-number-is-safe-integer', message: 'm', file: 'a.js', data: { line: 1 } }],
        { cwd: dir, recordWrite: vi.fn() }
      )
      expect(res.touchedFiles).toEqual([])
    })
  })

  test('apply: декілька порушень у різних файлах — усі торкнуті файли повертаються', async () => {
    await withTmpDir(async dir => {
      const fileA = join(dir, 'a.js')
      const fileB = join(dir, 'b.js')
      writeFileSync(fileA, 'Number.isInteger(x)\n', 'utf8')
      writeFileSync(fileB, 'Number.isInteger(y)\n', 'utf8')
      const res = await MECHANICAL.apply(
        [
          { reason: 'unicorn/prefer-number-is-safe-integer', message: 'm', file: 'a.js', data: { line: 1 } },
          { reason: 'unicorn(prefer-number-is-safe-integer)', message: 'm', file: 'b.js', data: { line: 1 } }
        ],
        { cwd: dir, recordWrite: vi.fn() }
      )
      expect(res.touchedFiles.toSorted()).toEqual([fileA, fileB].toSorted())
    })
  })
})

/**
 * Тести `text/oxfmt`: детектор (--list-different) і T0-фіксер (--write) на temp-fixtures.
 * oxfmt стабільно доступний у PATH (homebrew/node_modules) — інтеграційний прогін.
 */
import { describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { lint } from '../main.mjs'
import { patterns } from '../fix-oxfmt.mjs'

/**
 * Виконує `fn(dir)` у свіжому temp-каталозі й гарантовано прибирає його (await — fn асинхронний).
 * @param {(dir: string) => Promise<unknown>} fn тіло тесту
 * @returns {Promise<unknown>} результат `fn`
 */
async function withTmp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'oxfmt-'))
  try {
    return await fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const ctxFor = dir => ({ cwd: dir, ruleId: 'text', concernId: 'oxfmt', files: undefined })

describe('text/oxfmt detector', () => {
  test('неформатований файл → одне порушення oxfmt-unformatted', () =>
    withTmp(async dir => {
      writeFileSync(join(dir, 'bad.mjs'), 'export  const   x=1\n')
      const { violations: v } = await lint(ctxFor(dir))
      expect(v).toHaveLength(1)
      expect(v[0].reason).toBe('oxfmt-unformatted')
      expect(v[0].data.kind).toBe('oxfmt-unformatted')
      expect(v[0].file).toBe('bad.mjs')
    }))

  test('відформатований файл → 0 порушень', () =>
    withTmp(async dir => {
      // temp-dir без .oxfmtrc → oxfmt-defaults (semi:true), тож канон тут — крапка з комою.
      writeFileSync(join(dir, 'good.mjs'), 'export const x = 1;\n')
      const { violations } = await lint(ctxFor(dir))
      expect(violations).toHaveLength(0)
    }))

  test('делта: не-fmt-типи відсіюються', () =>
    withTmp(async dir => {
      writeFileSync(join(dir, 'readme.md'), '# unformatted   stuff\n')
      const { violations: v } = await lint({ cwd: dir, ruleId: 'text', concernId: 'oxfmt', files: ['readme.md'] })
      expect(v).toHaveLength(0)
    }))
})

describe('text/oxfmt T0 fixer', () => {
  test('detect → T0 write → re-detect = 0', () =>
    withTmp(async dir => {
      writeFileSync(join(dir, 'bad.mjs'), 'export  const   x=1\nexport const y= 2\n')
      const { violations: before } = await lint(ctxFor(dir))
      expect(before).toHaveLength(1)
      const res = await patterns[0].apply(before, ctxFor(dir))
      expect(res.touchedFiles).toHaveLength(1)
      const { violations: after } = await lint(ctxFor(dir))
      expect(after).toHaveLength(0)
    }))

  test('test=false без oxfmt-unformatted', () => {
    expect(patterns[0].test([{ reason: 'other', message: 'm', file: 'a.mjs' }])).toBe(false)
  })
})

import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { check } from './check.mjs'

const CANON_EXCLUDE = [
  '(^|/)node_modules(/|$)',
  String.raw`(^|/)\.git(/|$)`,
  '(^|/)dist(/|$)',
  '(^|/)build(/|$)',
  String.raw`.*\.lock$`,
  '.*fixtures?/.*'
].join('\n')

/**
 * @param {(cwd: string) => void} prep підготовка фікстур у тимчасовій директорії
 * @param {(cwd: string) => Promise<number>} body тіло тесту
 * @returns {Promise<number>} результат виконання body
 */
async function withTmpCwd(prep, body) {
  const cwd = mkdtempSync(join(tmpdir(), 'trufflehog-check-'))
  const origCwd = process.cwd()
  try {
    process.chdir(cwd)
    prep(cwd)
    return await body(cwd)
  } finally {
    process.chdir(origCwd)
    rmSync(cwd, { recursive: true, force: true })
  }
}

const NO_PREP = (/** @type {string} */ _cwd) => null

describe('security/fix/trufflehog/check', () => {
  test('fails when package.json missing', async () => {
    const exit = await withTmpCwd(NO_PREP, async () => await check())
    expect(exit).toBe(1)
  })

  test('fails when .trufflehog-exclude missing', async () => {
    const exit = await withTmpCwd(
      cwd => {
        writeFileSync(join(cwd, 'package.json'), '{}')
      },
      async () => await check()
    )
    expect(exit).toBe(1)
  })

  test('fails when .trufflehog-exclude lacks canonical patterns', async () => {
    const exit = await withTmpCwd(
      cwd => {
        writeFileSync(join(cwd, 'package.json'), '{}')
        writeFileSync(join(cwd, '.trufflehog-exclude'), 'foo\n')
      },
      async () => await check()
    )
    expect(exit).toBe(1)
  })

  test('passes when both files present and exclude has canonical patterns', async () => {
    const exit = await withTmpCwd(
      cwd => {
        writeFileSync(join(cwd, 'package.json'), '{}')
        writeFileSync(join(cwd, '.trufflehog-exclude'), CANON_EXCLUDE + '\n')
      },
      async () => await check()
    )
    expect(exit).toBe(0)
  })
})

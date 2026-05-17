import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { check } from './check.mjs'

const CANON_EXCLUDE = [
  '(^|/)node_modules(/|$)',
  '(^|/)\\.git(/|$)',
  '(^|/)dist(/|$)',
  '(^|/)build(/|$)',
  '.*\\.lock$',
  '.*fixtures?/.*'
].join('\n')

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

describe('security/fix/trufflehog/check', () => {
  test('fails when package.json missing', async () => {
    const exit = await withTmpCwd(() => {}, async () => await check())
    expect(exit).toBe(1)
  })

  test('fails when .trufflehog-exclude missing', async () => {
    const exit = await withTmpCwd(cwd => {
      writeFileSync(join(cwd, 'package.json'), '{}')
    }, async () => await check())
    expect(exit).toBe(1)
  })

  test('fails when .trufflehog-exclude lacks canonical patterns', async () => {
    const exit = await withTmpCwd(cwd => {
      writeFileSync(join(cwd, 'package.json'), '{}')
      writeFileSync(join(cwd, '.trufflehog-exclude'), 'foo\n')
    }, async () => await check())
    expect(exit).toBe(1)
  })

  test('passes when both files present and exclude has canonical patterns', async () => {
    const exit = await withTmpCwd(cwd => {
      writeFileSync(join(cwd, 'package.json'), '{}')
      writeFileSync(join(cwd, '.trufflehog-exclude'), CANON_EXCLUDE + '\n')
    }, async () => await check())
    expect(exit).toBe(0)
  })
})

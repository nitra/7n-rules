import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { check } from './check.mjs'

async function withTmpCwd(prep, body) {
  const cwd = mkdtempSync(join(tmpdir(), 'gitleaks-check-'))
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

describe('security/fix/gitleaks/check', () => {
  test('fails when package.json missing', async () => {
    const exit = await withTmpCwd(() => {}, async () => await check())
    expect(exit).toBe(1)
  })

  test('passes JS concern when package.json exists', async () => {
    const exit = await withTmpCwd(cwd => {
      writeFileSync(join(cwd, 'package.json'), '{}')
    }, async () => await check())
    expect(exit).toBe(0)
  })
})

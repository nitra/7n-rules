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

  test('fails when .gitleaks.toml missing', async () => {
    const exit = await withTmpCwd(cwd => {
      writeFileSync(join(cwd, 'package.json'), '{}')
    }, async () => await check())
    expect(exit).toBe(1)
  })

  test('fails when .gitleaks.toml lacks useDefault from template', async () => {
    const exit = await withTmpCwd(cwd => {
      writeFileSync(join(cwd, 'package.json'), '{}')
      writeFileSync(join(cwd, '.gitleaks.toml'), 'title = "x"\n')
    }, async () => await check())
    expect(exit).toBe(1)
  })

  test('passes when both files exist and .gitleaks.toml is template superset', async () => {
    const exit = await withTmpCwd(cwd => {
      writeFileSync(join(cwd, 'package.json'), '{}')
      writeFileSync(join(cwd, '.gitleaks.toml'), `[extend]
useDefault = true

[allowlist]
description = "будь-який project-specific опис"
paths = [
  '''(^|/)node_modules(/|$)''',
  '''(^|/)\\.git(/|$)''',
  '''(^|/)dist(/|$)''',
  '''(^|/)build(/|$)''',
  '''.*\\.lock$''',
  '''.*fixtures?/.*'''
]
`)
    }, async () => await check())
    expect(exit).toBe(0)
  })

  test('fails when .gitleaks.toml allowlist paths missing canonical entry', async () => {
    const exit = await withTmpCwd(cwd => {
      writeFileSync(join(cwd, 'package.json'), '{}')
      writeFileSync(join(cwd, '.gitleaks.toml'), `[extend]
useDefault = true

[allowlist]
paths = [
  '''(^|/)node_modules(/|$)''',
  '''(^|/)\\.git(/|$)'''
]
`)
    }, async () => await check())
    expect(exit).toBe(1)
  })
})

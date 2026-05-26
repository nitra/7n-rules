import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runStandardLint } from '../run-standard-lint.mjs'

describe('runStandardLint', () => {
  it('виводить ключ з шляху rules/<id>/lint і викликає stepsFn', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'run-standard-lint-'))
    try {
      const fakeLintDir = '/repo/rules/foo/lint'
      let called = 0
      const code = await runStandardLint(
        fakeLintDir,
        () => {
          called++
          return 0
        },
        { cacheDir, getFingerprint: () => null }
      )
      expect(code).toBe(0)
      expect(called).toBe(1)
    } finally {
      rmSync(cacheDir, { recursive: true, force: true })
    }
  })

  it('дедуплікує другий виклик при збігу fingerprint у межах TTL', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'run-standard-lint-'))
    try {
      const fakeLintDir = '/repo/rules/bar/lint'
      let called = 0
      const opts = { cacheDir, ttl: 60_000, getFingerprint: () => 'a'.repeat(64) }
      await runStandardLint(
        fakeLintDir,
        () => {
          called++
          return 0
        },
        opts
      )
      await runStandardLint(
        fakeLintDir,
        () => {
          called++
          return 0
        },
        opts
      )
      expect(called).toBe(1)
    } finally {
      rmSync(cacheDir, { recursive: true, force: true })
    }
  })
})

import * as fs from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { cwd as processCwd } from 'node:process'

import { describe, expect, test } from 'vitest'

import { withTmpDir } from '../../../utils/test-helpers.mjs'
import { lintLockFingerprint, withGlobalLintLock } from '../lint-lock.mjs'

const TREE_FP = 'a'.repeat(64)
const RE_SHA256_HEX = /^[0-9a-f]{64}$/u
const RE_LOCK_TIMEOUT = /не вдалося взяти лок/u

/**
 * Варіант виклику lint для тестів — cwd збігається з процесним, дедуп можливий.
 * @param {Partial<{cwd: string, full: boolean, rules: string[], noFix: boolean}>} [overrides] відхилення від бази
 * @returns {{cwd: string, full: boolean, rules: string[], noFix: boolean}} варіант
 */
function makeVariant(overrides = {}) {
  return { cwd: processCwd(), full: false, rules: [], noFix: false, ...overrides }
}

describe('lintLockFingerprint — дедуп-ключ: дерево + варіант виклику (spec 2026-07-03)', () => {
  test('null при --cwd не на процесний cwd: знімок дерева відповідав би не тому дереву', () => {
    expect(lintLockFingerprint(makeVariant({ cwd: '/somewhere/else' }), () => TREE_FP)).toBeNull()
  })

  test('null поза git-репо (tree-fingerprint null)', () => {
    expect(lintLockFingerprint(makeVariant(), () => null)).toBeNull()
  })

  test('той самий варіант на тому самому дереві → стабільний fingerprint', () => {
    const a = lintLockFingerprint(makeVariant(), () => TREE_FP)
    const b = lintLockFingerprint(makeVariant(), () => TREE_FP)
    expect(a).toMatch(RE_SHA256_HEX)
    expect(a).toBe(b)
  })

  test('порядок rules не впливає: lint js text ≡ lint text js', () => {
    const a = lintLockFingerprint(makeVariant({ rules: ['js', 'text'] }), () => TREE_FP)
    const b = lintLockFingerprint(makeVariant({ rules: ['text', 'js'] }), () => TREE_FP)
    expect(a).toBe(b)
  })

  test('інший варіант (--full, --no-fix, rules) → інший fingerprint: scoped-успіх не маскує ширший прогін', () => {
    const base = lintLockFingerprint(makeVariant(), () => TREE_FP)
    expect(lintLockFingerprint(makeVariant({ full: true }), () => TREE_FP)).not.toBe(base)
    expect(lintLockFingerprint(makeVariant({ noFix: true }), () => TREE_FP)).not.toBe(base)
    expect(lintLockFingerprint(makeVariant({ rules: ['js'] }), () => TREE_FP)).not.toBe(base)
  })

  test('інше дерево → інший fingerprint', () => {
    const a = lintLockFingerprint(makeVariant(), () => TREE_FP)
    const b = lintLockFingerprint(makeVariant(), () => 'b'.repeat(64))
    expect(a).not.toBe(b)
  })
})

describe('withGlobalLintLock — черга і fail-closed (spec 2026-07-03)', () => {
  test('послідовні запуски виконуються, лок звільняється', async () => {
    await withTmpDir(async dir => {
      const opts = { cacheDir: join(dir, 'lock-state'), getFingerprint: () => null }
      const first = await withGlobalLintLock(makeVariant(), () => 0, opts)
      const second = await withGlobalLintLock(makeVariant(), () => 42, opts)
      expect(first).toBe(0)
      expect(second).toBe(42)
    })
  })

  test('таймаут черги за живим чужим локом — fail-closed, runFn не виконується', async () => {
    await withTmpDir(async dir => {
      const cacheDir = join(dir, 'lock-state')
      const lockDir = join(cacheDir, 'lock')
      fs.mkdirSync(lockDir, { recursive: true })
      // host ≠ поточний → PID-перевірка не спрацює; startedAt свіжий → не stale.
      // Лишається лише чекати — і впасти за waitTimeout (onWaitTimeout: 'fail' у дефолтах).
      fs.writeFileSync(
        join(lockDir, 'owner.json'),
        JSON.stringify({ pid: process.pid, host: 'other-host', startedAt: Date.now(), fingerprint: null })
      )
      let ran = false
      await expect(
        withGlobalLintLock(
          makeVariant(),
          () => {
            ran = true
            return 0
          },
          { cacheDir, waitTimeout: 1, pollInterval: 10, getFingerprint: () => null }
        )
      ).rejects.toThrow(RE_LOCK_TIMEOUT)
      expect(ran).toBe(false)
    })
  })

  test('лок мертвого PID на цьому host перехоплюється одразу', async () => {
    await withTmpDir(async dir => {
      const cacheDir = join(dir, 'lock-state')
      const lockDir = join(cacheDir, 'lock')
      fs.mkdirSync(lockDir, { recursive: true })
      fs.writeFileSync(
        join(lockDir, 'owner.json'),
        JSON.stringify({ pid: 999_999_999, host: hostname(), startedAt: Date.now(), fingerprint: null })
      )
      const code = await withGlobalLintLock(makeVariant(), () => 7, {
        cacheDir,
        getFingerprint: () => null
      })
      expect(code).toBe(7)
    })
  })
})

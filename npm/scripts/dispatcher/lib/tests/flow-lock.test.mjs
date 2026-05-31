/**
 * Тести per-branch локу flow (`lib/flow-lock.mjs`, spec §4.1.3) — reuse
 * `withLock` із fail-closed-override. `console.error` мокаємо (withLock логує
 * стан локу).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { pid } from 'node:process'

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { withTmpDir } from '../../../utils/test-helpers.mjs'
import { withFlowLock } from '../flow-lock.mjs'

beforeEach(() => {
  vi.spyOn(console, 'error').mockReturnValue()
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('withFlowLock', () => {
  test('виконує runFn і повертає результат', async () => {
    await withTmpDir(async dir => {
      const wt = join(dir, '.worktrees', 'feat-x')
      mkdirSync(wt, { recursive: true })
      const r = await withFlowLock(wt, async () => 42)
      expect(r).toBe(42)
    })
  })

  test('fail-closed: зайнятий «живий» лок → throw, runFn не запускається', async () => {
    await withTmpDir(async dir => {
      const parent = join(dir, '.worktrees')
      const wt = join(parent, 'feat-x')
      mkdirSync(wt, { recursive: true })
      // Зайняти лок власником, що НЕ stale: поточний pid (живий), свіжий час.
      const lockDir = join(parent, '.flow-lock-feat-x', 'lock')
      mkdirSync(lockDir, { recursive: true })
      writeFileSync(
        join(lockDir, 'owner.json'),
        JSON.stringify({ pid, host: hostname(), startedAt: Date.now() }),
        'utf8'
      )
      let ran = false
      await expect(
        withFlowLock(
          wt,
          async () => {
            ran = true
            return 1
          },
          { waitTimeout: 30, pollInterval: 5 }
        )
      ).rejects.toThrow(/fail-closed/)
      expect(ran).toBe(false)
    })
  })

  test('відносний шлях → throw', () => {
    expect(() => withFlowLock('.worktrees/feat-x', async () => 1)).toThrow(/абсолютн/)
  })
})

/**
 * Тести Executor (`lib/executor.mjs`, spec §3 Ф3/§4.1.7). runner/verify/commit
 * ін'єктуються — без реальних LLM/git/gates.
 */
import { join } from 'node:path'

import { describe, expect, test, vi } from 'vitest'

import { withTmpDir } from '../../../utils/test-helpers.mjs'
import { executePlan, microprompt, patchStep } from '../executor.mjs'
import { readState, writeState } from '../state-store.mjs'

const FIXED = () => 1_700_000_000_000

/**
 * Шляхи стану/журналу в tmp-каталозі.
 * @param {string} dir tmp-каталог
 * @returns {{ statePath: string, eventsPath: string }} шляхи
 */
function paths(dir) {
  return { statePath: join(dir, 'feat.flow.json'), eventsPath: join(dir, 'feat.events.jsonl') }
}

/**
 * Свіжий 2-кроковий план.
 * @returns {object[]} план
 */
function plan2() {
  return [
    { step: 0, task: 'a', status: 'pending', retry_count: 0 },
    { step: 1, task: 'b', status: 'pending', retry_count: 0 }
  ]
}

describe('microprompt', () => {
  test('містить крок + критерії + останню помилку', () => {
    const p = microprompt({ step: 2, task: 'X', acceptance: 'Y', last_error: 'ERR' }, { branch: 'feat/z' })
    expect(p).toContain('Крок 2: X')
    expect(p).toContain('Y')
    expect(p).toContain('ERR')
  })
})

describe('patchStep', () => {
  test('оновлює крок за індексом (pure)', () => {
    expect(patchStep({ plan: [{ a: 1 }, { a: 2 }] }, 1, { a: 9 }).plan).toEqual([{ a: 1 }, { a: 9 }])
  })
})

describe('executePlan', () => {
  test('happy: усі verify зелені → done + commit на кожен крок', async () => {
    await withTmpDir(async dir => {
      const p = paths(dir)
      writeState(p.statePath, { branch: 'feat/x', status: 'in_progress', plan: plan2() })
      const commit = vi.fn()
      const res = await executePlan(p, {
        runner: { runStep: vi.fn(async () => ({ ok: true })) },
        verify: () => ({ pass: true }),
        commit,
        cwd: dir,
        now: FIXED
      })
      expect(res).toEqual({ status: 'done' })
      expect(commit).toHaveBeenCalledTimes(2)
      const s = readState(p.statePath)
      expect(s.plan.every(st => st.status === 'done')).toBe(true)
      expect(s.status).toBe('built')
    })
  })

  test('retry-then-pass: verify падає раз, тоді зелений', async () => {
    await withTmpDir(async dir => {
      const p = paths(dir)
      writeState(p.statePath, { branch: 'feat/x', status: 'in_progress', plan: [{ step: 0, task: 'a', status: 'pending', retry_count: 0 }] })
      let n = 0
      const commit = vi.fn()
      const res = await executePlan(p, {
        runner: { runStep: async () => ({ ok: true }) },
        verify: () => ({ pass: n++ > 0, failedOutput: 'lint err' }),
        commit,
        cwd: dir,
        now: FIXED
      })
      expect(res.status).toBe('done')
      expect(commit).toHaveBeenCalledTimes(1)
      const s = readState(p.statePath)
      expect(s.plan[0].status).toBe('done')
      expect(s.plan[0].retry_count).toBe(1)
    })
  })

  test('вичерпано спроби → blocked-on-human + HITL; commit НЕ викликається', async () => {
    await withTmpDir(async dir => {
      const p = paths(dir)
      writeState(p.statePath, { branch: 'feat/x', status: 'in_progress', plan: [{ step: 0, task: 'a', status: 'pending', retry_count: 0 }] })
      const commit = vi.fn()
      const res = await executePlan(p, {
        runner: { runStep: async () => ({ ok: true }) },
        verify: () => ({ pass: false, failedOutput: 'err' }),
        commit,
        cwd: dir,
        maxRepairAttempts: 3,
        now: FIXED
      })
      expect(res).toEqual({ status: 'blocked-on-human', step: 0 })
      expect(commit).not.toHaveBeenCalled()
      const s = readState(p.statePath)
      expect(s.status).toBe('blocked-on-human')
      expect(s.hitl).toHaveLength(1)
      expect(s.hitl[0].status).toBe('open')
      expect(s.plan[0].retry_count).toBe(3)
    })
  })

  test('нема плану → throw', async () => {
    await withTmpDir(async dir => {
      const p = paths(dir)
      writeState(p.statePath, { branch: 'x', status: 'in_progress', plan: [] })
      await expect(
        executePlan(p, { runner: { runStep: async () => ({}) }, verify: () => ({ pass: true }), commit: () => {}, cwd: dir })
      ).rejects.toThrow(/немає плану/)
    })
  })
})

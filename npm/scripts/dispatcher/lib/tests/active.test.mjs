/**
 * Тести Активного Раннера (`lib/active.mjs`, spec §8.1 Фасад B). Усе ін'єктується
 * (run/runner/verify/commit/now) — без реальних LLM/git/gates.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, test, vi } from 'vitest'

import { withTmpDir } from '../../../utils/test-helpers.mjs'
import { cancel, repair, resume, run } from '../active.mjs'
import { flowStatePath, readState, writeState } from '../state-store.mjs'

const noop = () => {}
const FIXED = () => 1_700_000_000_000

/**
 * Фейковий command-runner для ensureWorktree/git (не linked worktree → create).
 * @param {object} [over] перевизначення
 * @returns {(cmd: string, args: string[]) => { status: number, stdout: string, stderr: string }} runner
 */
function makeRun(over = {}) {
  return (cmd, args) => {
    const k = args.join(' ')
    if (k.includes('--show-superproject')) return { status: 0, stdout: '', stderr: '' }
    if (k.includes('--git-common-dir')) return { status: 0, stdout: '/repo/.git', stderr: '' }
    if (k.includes('--git-dir')) return { status: 0, stdout: '/repo/.git', stderr: '' }
    if (k.includes('rev-parse HEAD')) return { status: 0, stdout: over.head ?? 'C1', stderr: '' }
    if (k.includes('worktree add')) return { status: over.worktreeAddStatus ?? 0, stdout: '', stderr: '' }
    return { status: 0, stdout: '', stderr: '' }
  }
}

describe('run', () => {
  test('happy: план + executor зелений → build, exit 0', async () => {
    await withTmpDir(async dir => {
      const commit = vi.fn()
      const code = await run(['feat/x', 'build cache'], {
        run: makeRun(),
        runner: { runStep: async () => ({ ok: true, output: '[{"task":"a"}]' }) },
        verify: () => ({ pass: true }),
        commit,
        cwd: dir,
        log: noop,
        now: FIXED
      })
      expect(code).toBe(0)
      const s = readState(flowStatePath(join(dir, '.worktrees', 'feat-x')))
      expect(s.status).toBe('built')
      expect(s.plan[0].status).toBe('done')
      expect(commit).toHaveBeenCalledTimes(1)
    })
  })

  test('planner падає → exit 1', async () => {
    await withTmpDir(async dir => {
      const code = await run(['feat/x', 'task'], {
        run: makeRun(),
        runner: { runStep: async () => ({ ok: false, output: 'boom' }) },
        cwd: dir,
        log: noop,
        now: FIXED
      })
      expect(code).toBe(1)
    })
  })

  test('executor blocked → exit 2', async () => {
    await withTmpDir(async dir => {
      const code = await run(['feat/x', 'task'], {
        run: makeRun(),
        runner: { runStep: async () => ({ ok: true, output: '[{"task":"a"}]' }) },
        verify: () => ({ pass: false, failedOutput: 'e' }),
        commit: vi.fn(),
        cwd: dir,
        log: noop,
        now: FIXED
      })
      expect(code).toBe(2)
    })
  })

  test('--autonomous: перевищення budget → exit 1, status failed', async () => {
    await withTmpDir(async dir => {
      const code = await run(['--autonomous', 'feat/x', 'task'], {
        run: makeRun(),
        runner: { runStep: async () => ({ ok: true, output: '[{"task":"a"}]' }) },
        budget: { maxApiCalls: 1 },
        verify: () => ({ pass: true }),
        commit: vi.fn(),
        cwd: dir,
        log: noop,
        now: FIXED
      })
      expect(code).toBe(1)
      expect(readState(flowStatePath(join(dir, '.worktrees', 'feat-x'))).status).toBe('failed')
    })
  })
})

describe('cancel', () => {
  test('прибирає sibling-и', async () => {
    await withTmpDir(async dir => {
      const wt = join(dir, '.worktrees', 'feat-x')
      writeState(flowStatePath(wt), { branch: 'feat/x', status: 'in_progress' })
      expect(await cancel([], { cwd: wt, log: noop })).toBe(0)
      expect(existsSync(flowStatePath(wt))).toBe(false)
    })
  })
})

describe('repair', () => {
  test('--discard-step-work → git reset --hard, exit 0', async () => {
    await withTmpDir(async dir => {
      const calls = []
      const code = await repair(['--discard-step-work'], {
        run: (cmd, args) => {
          calls.push(args.join(' '))
          return { status: 0 }
        },
        cwd: dir,
        log: noop
      })
      expect(code).toBe(0)
      expect(calls).toContain('reset --hard HEAD')
    })
  })
  test('діагностика без стану → exit 0', async () => {
    await withTmpDir(async dir => {
      expect(await repair([], { cwd: join(dir, 'wt'), log: noop })).toBe(0)
    })
  })
})

describe('resume', () => {
  test('нема стану → 1', async () => {
    await withTmpDir(async dir => {
      expect(await resume([], { cwd: join(dir, 'wt'), log: noop })).toBe(1)
    })
  })

  test('blocked з відкритим HITL → 2', async () => {
    await withTmpDir(async dir => {
      const wt = join(dir, '.worktrees', 'feat-x')
      writeState(flowStatePath(wt), {
        branch: 'feat/x',
        status: 'blocked-on-human',
        plan: [{ step: 0, task: 'a', status: 'pending', retry_count: 3 }],
        hitl: [{ id: 'q-0', step: 0, status: 'open', answer: '' }]
      })
      expect(await resume([], { cwd: wt, run: () => ({ status: 0 }), log: noop, now: FIXED })).toBe(2)
    })
  })

  test('після відповіді HITL → executor → done (hint застосовано, спроби скинуто)', async () => {
    await withTmpDir(async dir => {
      const wt = join(dir, '.worktrees', 'feat-x')
      writeState(flowStatePath(wt), {
        branch: 'feat/x',
        status: 'blocked-on-human',
        plan: [{ step: 0, task: 'a', status: 'pending', retry_count: 3 }],
        hitl: [{ id: 'q-0', step: 0, status: 'open', answer: 'роби так' }]
      })
      const code = await resume([], {
        cwd: wt,
        run: () => ({ status: 0 }),
        runner: { runStep: async () => ({ ok: true }) },
        verify: () => ({ pass: true }),
        commit: vi.fn(),
        log: noop,
        now: FIXED
      })
      expect(code).toBe(0)
      const s = readState(flowStatePath(wt))
      expect(s.plan[0].status).toBe('done')
      expect(s.hitl[0].status).toBe('answered')
    })
  })
})

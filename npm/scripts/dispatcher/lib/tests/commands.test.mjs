/**
 * Тести handler-ів `flow` (`lib/commands.mjs`, spec §8.1). `run`/`log`/
 * `fingerprint`/`now` ін'єктуються — без реальних процесів.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import { withTmpDir } from '../../../utils/test-helpers.mjs'
import { init, release, verify } from '../commands.mjs'
import { flowStatePath, readState, writeState } from '../state-store.mjs'

const noop = () => {}
const FIXED = () => 1_700_000_000_000

/**
 * Фейковий runner: статуси/stdout за розпізнаваними фрагментами команди.
 * @param {object} [over] перевизначення (gitDir/gitCommon/superproject/head/worktreeAddStatus/changeStatus)
 * @returns {(cmd: string, args: string[]) => { status: number, stdout: string, stderr: string }} runner
 */
function makeRun(over = {}) {
  return (cmd, args) => {
    const k = args.join(' ')
    if (k.includes('--show-superproject')) return { status: 0, stdout: over.superproject ?? '', stderr: '' }
    if (k.includes('--git-common-dir')) return { status: 0, stdout: over.gitCommon ?? '/repo/.git', stderr: '' }
    if (k.includes('--git-dir')) return { status: 0, stdout: over.gitDir ?? '/repo/.git', stderr: '' }
    if (k.includes('rev-parse HEAD')) return { status: 0, stdout: over.head ?? 'COMMIT', stderr: '' }
    if (k.includes('worktree add')) return { status: over.worktreeAddStatus ?? 0, stdout: '', stderr: 'boom' }
    if (k.includes('change')) return { status: over.changeStatus ?? 0, stdout: '', stderr: 'boom' }
    return { status: 0, stdout: '', stderr: '' }
  }
}

describe('init', () => {
  test('новий worktree: створює стан із branch/base_commit', async () => {
    await withTmpDir(async dir => {
      const code = await init(['feat/x', 'рефактор', 'кешу'], { run: makeRun({ head: 'C123' }), cwd: dir, log: noop, now: FIXED })
      expect(code).toBe(0)
      const s = readState(flowStatePath(join(dir, '.worktrees', 'feat-x')))
      expect(s.branch).toBe('feat/x')
      expect(s.status).toBe('in_progress')
      expect(s.metadata.base_commit).toBe('C123')
      expect(s.level).toBe(2) // «рефактор» → L2
    })
  })

  test('уже в worktree: стан поряд із cwd, без worktree add', async () => {
    await withTmpDir(async dir => {
      const wt = join(dir, 'wt')
      // gitDir != gitCommon → linked worktree
      const code = await init(['feat/y', 'desc'], {
        run: makeRun({ gitDir: '/repo/.git/worktrees/y', gitCommon: '/repo/.git' }),
        cwd: wt,
        log: noop,
        now: FIXED
      })
      expect(code).toBe(0)
      expect(readState(flowStatePath(wt)).branch).toBe('feat/y')
    })
  })

  test('без аргументів → 1', async () => {
    expect(await init([], { run: makeRun(), log: noop })).toBe(1)
    expect(await init(['feat/x'], { run: makeRun(), log: noop })).toBe(1)
  })

  test('worktree add падає → 1', async () => {
    await withTmpDir(async dir => {
      const code = await init(['feat/x', 'desc'], { run: makeRun({ worktreeAddStatus: 1 }), cwd: dir, log: noop, now: FIXED })
      expect(code).toBe(1)
    })
  })
})

describe('verify', () => {
  test('усі gate-и зелені → exit 0', async () => {
    await withTmpDir(async dir => {
      const code = await verify([], { run: () => ({ status: 0 }), cwd: join(dir, 'wt'), log: noop, fingerprint: () => 'FP' })
      expect(code).toBe(0)
    })
  })

  test('gate падає → exit 1', async () => {
    await withTmpDir(async dir => {
      const code = await verify([], { run: () => ({ status: 1 }), cwd: join(dir, 'wt'), log: noop, fingerprint: () => null })
      expect(code).toBe(1)
    })
  })

  test('записує gate-результати + fingerprint у наявний стан', async () => {
    await withTmpDir(async dir => {
      const wt = join(dir, '.worktrees', 'feat-x')
      const statePath = flowStatePath(wt)
      writeState(statePath, { branch: 'feat/x', status: 'in_progress' })
      const code = await verify([], { run: () => ({ status: 0 }), cwd: wt, log: noop, fingerprint: () => 'FP' })
      expect(code).toBe(0)
      const s = readState(statePath)
      expect(s.fingerprint).toBe('FP')
      expect(s.gates.every(g => g.ok)).toBe(true)
      expect(s.status).toBe('in_progress')
    })
  })

  test('фейл verify → статус failed', async () => {
    await withTmpDir(async dir => {
      const wt = join(dir, '.worktrees', 'feat-y')
      const statePath = flowStatePath(wt)
      writeState(statePath, { branch: 'feat/y', status: 'in_progress' })
      const code = await verify([], { run: () => ({ status: 1 }), cwd: wt, log: noop, fingerprint: () => null })
      expect(code).toBe(1)
      expect(readState(statePath).status).toBe('failed')
    })
  })

  test('без плану: попередження, код за gate-ами (0)', async () => {
    await withTmpDir(async dir => {
      const wt = join(dir, '.worktrees', 'feat-np')
      writeState(flowStatePath(wt), { branch: 'feat/np', status: 'in_progress' }) // без plan
      const msgs = []
      const code = await verify([], { run: () => ({ status: 0 }), cwd: wt, log: m => msgs.push(m), fingerprint: () => 'FP' })
      expect(code).toBe(0)
      expect(msgs.join('\n')).toMatch(/план/i)
    })
  })

  test('із планом: без попередження про план', async () => {
    await withTmpDir(async dir => {
      const wt = join(dir, '.worktrees', 'feat-wp')
      writeState(flowStatePath(wt), { branch: 'feat/wp', status: 'planned', plan: [{ step: 0, task: 'A' }] })
      const msgs = []
      await verify([], { run: () => ({ status: 0 }), cwd: wt, log: m => msgs.push(m), fingerprint: () => 'FP' })
      expect(msgs.join('\n')).not.toMatch(/плану не зафіксовано/i)
    })
  })

  test('без стану — лише gate-и (стан не пишеться)', async () => {
    await withTmpDir(async dir => {
      const wt = join(dir, '.worktrees', 'no-state')
      const code = await verify([], { run: () => ({ status: 0 }), cwd: wt, log: noop, fingerprint: () => 'FP' })
      expect(code).toBe(0)
      expect(readState(flowStatePath(wt))).toBe(null)
    })
  })
})

describe('release', () => {
  test('без стану → 1', async () => {
    await withTmpDir(async dir => {
      const wt = join(dir, '.worktrees', 'feat-x')
      expect(await release([], { run: makeRun(), cwd: wt, log: noop, now: FIXED })).toBe(1)
    })
  })

  test('happy: change ok → status done + completion у стані', async () => {
    await withTmpDir(async dir => {
      const wt = join(dir, '.worktrees', 'feat-x')
      const statePath = flowStatePath(wt)
      writeState(statePath, { branch: 'feat/x', status: 'in_progress', gates: [{ name: 'lint', ok: true }] })
      const code = await release(['--bump', 'patch'], { run: makeRun(), cwd: wt, log: noop, now: FIXED })
      expect(code).toBe(0)
      const s = readState(statePath)
      expect(s.status).toBe('done')
      expect(s.completion.gates).toEqual({ lint: 'ok' })
    })
  })

  test('пише summary у task record, якщо state.task задано', async () => {
    await withTmpDir(async dir => {
      const wt = join(dir, '.worktrees', 'feat-x')
      const taskPath = join(dir, 'task.md')
      writeState(flowStatePath(wt), { branch: 'feat/x', status: 'in_progress', task: taskPath })
      await release([], { run: makeRun(), cwd: wt, log: noop, now: FIXED })
      expect(readFileSync(taskPath, 'utf8')).toContain('flow:summary:start')
    })
  })

  test('gate FAIL → попередження, але реліз не блокується', async () => {
    await withTmpDir(async dir => {
      const wt = join(dir, '.worktrees', 'feat-x')
      writeState(flowStatePath(wt), { branch: 'feat/x', status: 'in_progress', gate: { verdict: 'FAIL', score: 20 } })
      const msgs = []
      const code = await release(['--bump', 'patch'], { run: makeRun(), cwd: wt, log: m => msgs.push(m), now: FIXED })
      expect(code).toBe(0)
      expect(msgs.join('\n')).toMatch(/gate = FAIL/i)
    })
  })

  test('change падає → 1', async () => {
    await withTmpDir(async dir => {
      const wt = join(dir, '.worktrees', 'feat-x')
      writeState(flowStatePath(wt), { branch: 'feat/x', status: 'in_progress' })
      const code = await release([], { run: makeRun({ changeStatus: 1 }), cwd: wt, log: noop, now: FIXED })
      expect(code).toBe(1)
    })
  })
})

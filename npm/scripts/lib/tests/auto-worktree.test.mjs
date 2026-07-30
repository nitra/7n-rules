/**
 * Тести для `auto-worktree.mjs`:
 *   - ensureRunningInWorktree: вже worktree → без змін; поза worktree →
 *     auto-create (`mt worktree create` + `bun install`); detached HEAD →
 *     кидає; requireCleanTree → кидає на брудному дереві, не кидає на чистому
 *     і коли вимкнено.
 *   - bringChangesBackToOriginal/removeAutoCreatedWorktree: спільний набір
 *     `describeAutoWorktreeBridge` (utils/tests/auto-worktree-suite.mjs).
 */
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

import { describeAutoWorktreeBridge } from '../../utils/tests/auto-worktree-suite.mjs'
import { bringChangesBackToOriginal, ensureRunningInWorktree, removeAutoCreatedWorktree } from '../auto-worktree.mjs'

/** Заглушка `log` для тестів, де побічний ефект не перевіряється. */
function noop() {
  /* no-op: цей тест не перевіряє вивід */
}

/**
 * Fake `deps.native` для `ensureRunningInWorktree` — без dlopen. `sanitizeWorktreeName`
 * повторює `mt_core::sanitize` для вжитих у тестах векторів (slash → `-`);
 * `worktreeCreate` пише виклик у спільний `calls` (той самий масив, куди пише
 * fake `spawnFn`, — мінімізує диф старих асертів на колишній `mt worktree create`)
 * і повертає `<repoRoot>/.worktrees/<name>`, той самий шлях, що раніше рахувався
 * вручну через `join`.
 * @param {string[]} calls спільний масив викликів
 * @returns {{ sanitizeWorktreeName: (raw: string) => string, worktreeCreate: (repoRoot: string, name: string, description: string, base: string|null) => string }} fake native
 */
function makeFakeNative(calls) {
  return {
    sanitizeWorktreeName: raw => raw.replaceAll('/', '-'),
    worktreeCreate: (repoRoot, name, description, base) => {
      calls.push(`native.worktreeCreate ${repoRoot} ${name} ${description} ${base}`)
      return join(repoRoot, '.worktrees', name)
    }
  }
}

const WORKTREE_OPTS = { suffix: 'lint', description: 'n-lint: worktree-only skill' }
const DETACHED_HEAD_RE = /detached HEAD/
const DIRTY_TREE_RE = /незакомічені зміни/
const TREE_STILL_DIRTY_RE = /усе ще не чисте/

describe('ensureRunningInWorktree', () => {
  test('вже під .worktrees/ — повертає cwd без змін, нічого не створює', async () => {
    const calls = []
    const result = await ensureRunningInWorktree(
      '/repo/.worktrees/main-lint',
      (cmd, args = []) => {
        calls.push([cmd, ...args].join(' '))
        return { status: 0, stdout: '/repo/.worktrees/main-lint\n', stderr: '' }
      },
      noop,
      WORKTREE_OPTS
    )
    expect(result).toEqual({ cwd: '/repo/.worktrees/main-lint', autoCreated: false, worktreeName: null })
    expect(calls).toEqual(['git rev-parse --show-toplevel'])
  })

  test('вже під .claude/worktrees/ (harness Claude Code) — повертає cwd без змін, нічого не створює', async () => {
    const calls = []
    const result = await ensureRunningInWorktree(
      '/repo/.claude/worktrees/task-abc123',
      (cmd, args = []) => {
        calls.push([cmd, ...args].join(' '))
        return { status: 0, stdout: '/repo/.claude/worktrees/task-abc123\n', stderr: '' }
      },
      noop,
      WORKTREE_OPTS
    )
    expect(result).toEqual({ cwd: '/repo/.claude/worktrees/task-abc123', autoCreated: false, worktreeName: null })
    expect(calls).toEqual(['git rev-parse --show-toplevel'])
  })

  test('поза worktree, чисте дерево — сам створює worktree і ставить залежності', async () => {
    const calls = []
    const result = await ensureRunningInWorktree(
      '/Users/dev/repo',
      (cmd, args = []) => {
        calls.push([cmd, ...args].join(' '))
        if (cmd === 'git' && args[0] === 'rev-parse') return { status: 0, stdout: '/Users/dev/repo\n', stderr: '' }
        if (cmd === 'git' && args[0] === 'branch') return { status: 0, stdout: 'main\n', stderr: '' }
        if (cmd === 'git' && args[0] === 'status') return { status: 0, stdout: '', stderr: '' }
        return { status: 0, stdout: '', stderr: '' }
      },
      noop,
      WORKTREE_OPTS,
      { native: makeFakeNative(calls) }
    )
    expect(result).toEqual({
      cwd: join('/Users/dev/repo', '.worktrees', 'main-lint'),
      autoCreated: true,
      worktreeName: 'main-lint'
    })
    expect(calls).toContain('native.worktreeCreate /Users/dev/repo main-lint n-lint: worktree-only skill null')
    expect(calls.some(c => c.startsWith('bun install'))).toBe(true)
  })

  test('гілка зі slash — worktree name і шлях sanitized через native.sanitizeWorktreeName (slash → -)', async () => {
    const calls = []
    const result = await ensureRunningInWorktree(
      '/repo',
      (cmd, args = []) => {
        calls.push([cmd, ...args].join(' '))
        if (cmd === 'git' && args[0] === 'rev-parse') return { status: 0, stdout: '/repo\n', stderr: '' }
        if (cmd === 'git' && args[0] === 'branch') return { status: 0, stdout: 'feature/x\n', stderr: '' }
        if (cmd === 'git' && args[0] === 'status') return { status: 0, stdout: '', stderr: '' }
        return { status: 0, stdout: '', stderr: '' }
      },
      noop,
      WORKTREE_OPTS,
      { native: makeFakeNative(calls) }
    )
    expect(result.worktreeName).toBe('feature-x-lint')
    expect(result.cwd).toBe(join('/repo', '.worktrees', 'feature-x-lint'))
    expect(calls).toContain('native.worktreeCreate /repo feature-x-lint n-lint: worktree-only skill null')
  })

  test('detached HEAD (немає поточної гілки) — кидає, не створює worktree', async () => {
    const calls = []
    await expect(
      ensureRunningInWorktree(
        '/repo',
        (cmd, args = []) => {
          calls.push(cmd)
          if (cmd === 'git' && args[0] === 'rev-parse') return { status: 0, stdout: '/repo\n', stderr: '' }
          if (cmd === 'git' && args[0] === 'branch') return { status: 0, stdout: '\n', stderr: '' }
          return { status: 0, stdout: '', stderr: '' }
        },
        noop,
        WORKTREE_OPTS
      )
    ).rejects.toThrow(DETACHED_HEAD_RE)
    expect(calls).not.toContain('npx')
  })

  test('requireCleanTree (дефолт) + брудне дерево + confirm=false — кидає, не створює worktree', async () => {
    const calls = []
    await expect(
      ensureRunningInWorktree(
        '/repo',
        (cmd, args = []) => {
          calls.push(cmd)
          if (cmd === 'git' && args[0] === 'rev-parse') return { status: 0, stdout: '/repo\n', stderr: '' }
          if (cmd === 'git' && args[0] === 'branch') return { status: 0, stdout: 'main\n', stderr: '' }
          if (cmd === 'git' && args[0] === 'status') return { status: 0, stdout: ' M package.json\n', stderr: '' }
          return { status: 0, stdout: '', stderr: '' }
        },
        noop,
        WORKTREE_OPTS,
        { confirm: () => Promise.resolve(false) }
      )
    ).rejects.toThrow(DIRTY_TREE_RE)
    expect(calls).not.toContain('npx')
  })

  test('requireCleanTree (дефолт) + брудне дерево + confirm=true — пушить (npx @7n/n push), потім створює worktree', async () => {
    const calls = []
    const confirmCalls = []
    let statusCallCount = 0
    const result = await ensureRunningInWorktree(
      '/repo',
      (cmd, args = []) => {
        calls.push([cmd, ...args].join(' '))
        if (cmd === 'git' && args[0] === 'rev-parse') return { status: 0, stdout: '/repo\n', stderr: '' }
        if (cmd === 'git' && args[0] === 'branch') return { status: 0, stdout: 'main\n', stderr: '' }
        if (cmd === 'git' && args[0] === 'status') {
          statusCallCount += 1
          return { status: 0, stdout: statusCallCount === 1 ? ' M package.json\n' : '', stderr: '' }
        }
        return { status: 0, stdout: '', stderr: '' }
      },
      noop,
      WORKTREE_OPTS,
      {
        confirm: message => {
          confirmCalls.push(message)
          return Promise.resolve(true)
        },
        native: makeFakeNative(calls)
      }
    )
    expect(confirmCalls).toHaveLength(1)
    expect(calls).toContain('npx @7n/n push')
    expect(result.autoCreated).toBe(true)
  })

  test('requireCleanTree (дефолт) + confirm=true, але push не очистив дерево — кидає', async () => {
    await expect(
      ensureRunningInWorktree(
        '/repo',
        (cmd, args = []) => {
          if (cmd === 'git' && args[0] === 'rev-parse') return { status: 0, stdout: '/repo\n', stderr: '' }
          if (cmd === 'git' && args[0] === 'branch') return { status: 0, stdout: 'main\n', stderr: '' }
          if (cmd === 'git' && args[0] === 'status') return { status: 0, stdout: ' M package.json\n', stderr: '' }
          return { status: 0, stdout: '', stderr: '' }
        },
        noop,
        WORKTREE_OPTS,
        { confirm: () => Promise.resolve(true) }
      )
    ).rejects.toThrow(TREE_STILL_DIRTY_RE)
  })

  test('requireCleanTree: false — створює worktree навіть на брудному дереві, не питає confirm', async () => {
    const calls = []
    const confirmCalls = []
    const result = await ensureRunningInWorktree(
      '/repo',
      (cmd, args = []) => {
        calls.push([cmd, ...args].join(' '))
        if (cmd === 'git' && args[0] === 'rev-parse') return { status: 0, stdout: '/repo\n', stderr: '' }
        if (cmd === 'git' && args[0] === 'branch') return { status: 0, stdout: 'main\n', stderr: '' }
        return { status: 0, stdout: '', stderr: '' }
      },
      noop,
      { ...WORKTREE_OPTS, requireCleanTree: false },
      {
        confirm: message => {
          confirmCalls.push(message)
          return Promise.resolve(true)
        },
        native: makeFakeNative(calls)
      }
    )
    expect(result.autoCreated).toBe(true)
    expect(calls.some(c => c.startsWith('git status'))).toBe(false)
    expect(confirmCalls).toHaveLength(0)
  })
})

describeAutoWorktreeBridge({ bringChangesBackToOriginal, removeAutoCreatedWorktree, branch: 'main-lint' })

/**
 * Тести для `auto-worktree.mjs`:
 *   - ensureRunningInWorktree: вже worktree → без змін; поза worktree →
 *     auto-create (`npx \@7n/mt worktree create` + `bun install`); detached HEAD →
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

const WORKTREE_OPTS = { suffix: 'lint', description: 'n-lint: worktree-only skill' }
const DETACHED_HEAD_RE = /detached HEAD/
const DIRTY_TREE_RE = /незакомічені зміни/

describe('ensureRunningInWorktree', () => {
  test('вже під .worktrees/ — повертає cwd без змін, нічого не створює', () => {
    const calls = []
    const result = ensureRunningInWorktree(
      '/repo/.worktrees/main-lint',
      (cmd, args = []) => {
        calls.push([cmd, ...args].join(' '))
        return { status: 0, stdout: '/repo/.worktrees/main-lint\n', stderr: '' }
      },
      noop,
      WORKTREE_OPTS
    )
    expect(result).toEqual({ cwd: '/repo/.worktrees/main-lint', autoCreated: false, branchArg: null })
    expect(calls).toEqual(['git rev-parse --show-toplevel'])
  })

  test('поза worktree, чисте дерево — сам створює worktree і ставить залежності', () => {
    const calls = []
    const result = ensureRunningInWorktree(
      '/Users/dev/repo',
      (cmd, args = []) => {
        calls.push([cmd, ...args].join(' '))
        if (cmd === 'git' && args[0] === 'rev-parse') return { status: 0, stdout: '/Users/dev/repo\n', stderr: '' }
        if (cmd === 'git' && args[0] === 'branch') return { status: 0, stdout: 'main\n', stderr: '' }
        if (cmd === 'git' && args[0] === 'status') return { status: 0, stdout: '', stderr: '' }
        return { status: 0, stdout: '', stderr: '' }
      },
      noop,
      WORKTREE_OPTS
    )
    expect(result).toEqual({
      cwd: join('/Users/dev/repo', '.worktrees', 'main-lint'),
      autoCreated: true,
      branchArg: 'main-lint'
    })
    expect(calls).toContain('npx @7n/mt worktree create main-lint n-lint: worktree-only skill')
    expect(calls.some(c => c.startsWith('bun install'))).toBe(true)
  })

  test('гілка зі slash — branchArg лишає slash, шлях worktree — sanitized (slash → -)', () => {
    const calls = []
    const result = ensureRunningInWorktree(
      '/repo',
      (cmd, args = []) => {
        calls.push([cmd, ...args].join(' '))
        if (cmd === 'git' && args[0] === 'rev-parse') return { status: 0, stdout: '/repo\n', stderr: '' }
        if (cmd === 'git' && args[0] === 'branch') return { status: 0, stdout: 'feature/x\n', stderr: '' }
        if (cmd === 'git' && args[0] === 'status') return { status: 0, stdout: '', stderr: '' }
        return { status: 0, stdout: '', stderr: '' }
      },
      noop,
      WORKTREE_OPTS
    )
    expect(result.branchArg).toBe('feature/x-lint')
    expect(result.cwd).toBe(join('/repo', '.worktrees', 'feature-x-lint'))
    expect(calls).toContain('npx @7n/mt worktree create feature/x-lint n-lint: worktree-only skill')
  })

  test('detached HEAD (немає поточної гілки) — кидає, не створює worktree', () => {
    const calls = []
    expect(() =>
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
    ).toThrow(DETACHED_HEAD_RE)
    expect(calls).not.toContain('npx')
  })

  test('requireCleanTree (дефолт) + брудне дерево — кидає, не створює worktree', () => {
    const calls = []
    expect(() =>
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
        WORKTREE_OPTS
      )
    ).toThrow(DIRTY_TREE_RE)
    expect(calls).not.toContain('npx')
  })

  test('requireCleanTree: false — створює worktree навіть на брудному дереві', () => {
    const calls = []
    const result = ensureRunningInWorktree(
      '/repo',
      (cmd, args = []) => {
        calls.push([cmd, ...args].join(' '))
        if (cmd === 'git' && args[0] === 'rev-parse') return { status: 0, stdout: '/repo\n', stderr: '' }
        if (cmd === 'git' && args[0] === 'branch') return { status: 0, stdout: 'main\n', stderr: '' }
        return { status: 0, stdout: '', stderr: '' }
      },
      noop,
      { ...WORKTREE_OPTS, requireCleanTree: false }
    )
    expect(result.autoCreated).toBe(true)
    expect(calls.some(c => c.startsWith('git status'))).toBe(false)
  })
})

describeAutoWorktreeBridge({ bringChangesBackToOriginal, removeAutoCreatedWorktree, branch: 'main-lint' })

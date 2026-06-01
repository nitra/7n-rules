/**
 * Тести cwd-незалежного резолвера активного flow (`lib/flow-resolve.mjs`).
 * git і FS повністю ін'єктовані — без репозиторію й диска.
 */
import { describe, expect, test } from 'vitest'

import { resolveActiveFlowState } from '../flow-resolve.mjs'

const REPO = '/repo'
const WT = '/repo/.worktrees'

/**
 * Будує ін'єкції з фіксованими toplevel / станами / переліком файлів.
 * @param {{ toplevel?: string|null, states?: Record<string, object>, dir?: string[] }} cfg конфіг
 * @returns {object} deps
 */
function deps({ toplevel = null, states = {}, dir = [] }) {
  return {
    repoRoot: REPO,
    git: args => {
      if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') {
        return toplevel ? { status: 0, stdout: `${toplevel}\n` } : { status: 1, stdout: '' }
      }
      return { status: 1, stdout: '' }
    },
    exists: p => Object.hasOwn(states, p),
    readState: p => states[p] ?? null,
    readdir: () => dir
  }
}

describe('resolveActiveFlowState', () => {
  test('1. явний --branch (worktree існує) → шлях гілки (sanitized), autoResolved=false', () => {
    const wt = `${WT}/feat-x`
    const r = resolveActiveFlowState(
      { cwd: REPO, branch: 'feat/x' },
      { repoRoot: REPO, exists: p => p === wt, git: () => ({ status: 1, stdout: '' }), readdir: () => [] }
    )
    expect(r.statePath).toBe(`${wt}.flow.json`)
    expect(r.worktreeDir).toBe(wt)
    expect(r.label).toBe('feat-x')
    expect(r.autoResolved).toBe(false)
  })

  test('1b. --branch неіснуючого worktree → помилка «не знайдено» (без ENOENT далі)', () => {
    const r = resolveActiveFlowState(
      { cwd: REPO, branch: 'ghost' },
      { repoRoot: REPO, exists: () => false, git: () => ({ status: 1, stdout: '' }), readdir: () => [] }
    )
    expect(r.statePath).toBeNull()
    expect(r.error).toContain('не знайдено')
  })

  test('1c. cwd = worktree без стану → «стану нема», чужий активний flow НЕ підтягується', () => {
    const top = `${WT}/feat-empty`
    const states = { [`${WT}/feat-other.flow.json`]: { status: 'in_progress' } }
    const r = resolveActiveFlowState(
      { cwd: top },
      {
        repoRoot: REPO,
        git: args => (args[1] === '--show-toplevel' ? { status: 0, stdout: `${top}\n` } : { status: 1, stdout: '' }),
        exists: p => Object.hasOwn(states, p),
        readState: p => states[p] ?? null,
        readdir: () => ['feat-other.flow.json']
      }
    )
    expect(r.statePath).toBeNull()
    expect(r.error).toContain('стану нема')
  })

  test('2. toplevel у .worktrees/ з наявним станом → беремо його', () => {
    const top = `${WT}/feat-a`
    const states = { [`${WT}/feat-a.flow.json`]: { status: 'in_progress' } }
    const r = resolveActiveFlowState({ cwd: top }, deps({ toplevel: top, states }))
    expect(r.statePath).toBe(`${WT}/feat-a.flow.json`)
    expect(r.worktreeDir).toBe(top)
    expect(r.autoResolved).toBe(false)
  })

  test('3. toplevel поза worktree + рівно один активний → авторезолв', () => {
    const states = { [`${WT}/feat-b.flow.json`]: { status: 'in_progress' } }
    const r = resolveActiveFlowState({ cwd: REPO }, deps({ toplevel: REPO, states, dir: ['feat-b.flow.json'] }))
    expect(r.statePath).toBe(`${WT}/feat-b.flow.json`)
    expect(r.worktreeDir).toBe(`${WT}/feat-b`)
    expect(r.autoResolved).toBe(true)
  })

  test('4. кілька активних → statePath=null, помилка зі списком', () => {
    const states = {
      [`${WT}/feat-b.flow.json`]: { status: 'in_progress' },
      [`${WT}/feat-c.flow.json`]: { status: 'in_progress' }
    }
    const r = resolveActiveFlowState(
      { cwd: REPO },
      deps({ toplevel: REPO, states, dir: ['feat-b.flow.json', 'feat-c.flow.json'] })
    )
    expect(r.statePath).toBeNull()
    expect(r.error).toContain('кілька активних')
    expect(r.error).toContain('feat-b')
    expect(r.error).toContain('feat-c')
  })

  test('5. нуль активних → statePath=null, «стану нема»', () => {
    const r = resolveActiveFlowState({ cwd: REPO }, deps({ toplevel: REPO, dir: [] }))
    expect(r.statePath).toBeNull()
    expect(r.error).toContain('стану нема')
  })

  test('6. done-стан не вважається активним (ігнорується при скані)', () => {
    const states = { [`${WT}/feat-d.flow.json`]: { status: 'done' } }
    const r = resolveActiveFlowState({ cwd: REPO }, deps({ toplevel: REPO, states, dir: ['feat-d.flow.json'] }))
    expect(r.statePath).toBeNull()
    expect(r.error).toContain('стану нема')
  })

  test('7. пошкоджений стан при скані пропускається, не валить резолв', () => {
    const good = `${WT}/feat-good.flow.json`
    const states = { [good]: { status: 'in_progress' } }
    const r = resolveActiveFlowState(
      { cwd: REPO },
      {
        repoRoot: REPO,
        git: () => ({ status: 0, stdout: `${REPO}\n` }),
        exists: p => Object.hasOwn(states, p),
        readState: p => {
          if (p.endsWith('feat-bad.flow.json')) throw new Error('corrupt')
          return states[p] ?? null
        },
        readdir: () => ['feat-bad.flow.json', 'feat-good.flow.json']
      }
    )
    expect(r.statePath).toBe(good)
    expect(r.autoResolved).toBe(true)
  })

  test('8. git недоступний і немає sibling-стану → «стану нема»', () => {
    const r = resolveActiveFlowState(
      { cwd: REPO },
      { git: () => ({ status: 1, stdout: '' }), exists: () => false, readdir: () => [] }
    )
    expect(r.statePath).toBeNull()
    expect(r.error).toContain('стану нема')
  })
})

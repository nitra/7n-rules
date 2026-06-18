import { describe, expect, test } from 'vitest'

import { WORKTREE_END, WORKTREE_START, injectWorktreeNotice } from '../worktree-notice.mjs'

const WORKTREE_BLOCK_RE = /<!-- n-cursor:worktree:start -->[\s\S]*?<!-- n-cursor:worktree:end -->/u

const SKILL = `---
name: fix
description: щось
---

# n-fix

тіло
`

describe('injectWorktreeNotice', () => {
  test('worktree=true → вставляє блок після frontmatter, перед H1', () => {
    const out = injectWorktreeNotice(SKILL, true)
    expect(out).toContain(WORKTREE_START)
    expect(out).toContain(WORKTREE_END)
    expect(out.indexOf(WORKTREE_START)).toBeLessThan(out.indexOf('# n-fix'))
    expect(out.startsWith('---\nname: fix')).toBe(true)
  })

  test('worktree=true → preflight без shell expansion і з literal worktree-командами', () => {
    const out = injectWorktreeNotice(SKILL, true)
    expect(out).toContain('[!IMPORTANT]')
    expect(out).toContain('git rev-parse --show-toplevel')
    expect(out).toContain('git branch --show-current')
    expect(out).toContain('npx @7n/mt worktree create "feature/x-fix" "n-fix: worktree-only skill"')
    expect(out).toContain('cd ".worktrees/feature-x-fix"')
    expect(out).not.toContain('worktree add <branch>')
    expect(out).not.toContain('<навіщо>')
    expect(out).not.toContain('B=$(')
    expect(out).not.toContain('W="${')
  })

  test('worktree=true → root-assert ловить запуск із піддиректорії (pwd vs toplevel)', () => {
    const out = injectWorktreeNotice(SKILL, true)
    expect(out).toContain('pwd')
    expect(out).toContain('Root-assert')
    expect(out).toContain('cd <toplevel>')
    expect(out).toContain('піддиректорії')
  })

  test('worktree=true → Крок 0.1 bootstrap = bun install (без ETARGET-обгортки)', () => {
    const out = injectWorktreeNotice(SKILL, true)
    expect(out).toContain('bun install')
    // ETARGET-обгортка прибрана: `mt worktree create` — бінарник, не npx-резолв.
    expect(out).not.toContain('n_cursor_npx')
    expect(out).not.toContain('N_CURSOR_NPX_RETRY_MAX_MIN')
    expect(out).not.toContain('sleep 30')
  })

  test('worktree=true → Крок 0.1 винесено ПІСЛЯ no-expansion preflight-снипета', () => {
    const out = injectWorktreeNotice(SKILL, true)
    expect(out.indexOf('**Крок 0.1')).toBeGreaterThan(out.indexOf('cd ".worktrees/feature-x-fix"'))
  })

  test('ідемпотентність: повторний виклик не дублює блок', () => {
    const once = injectWorktreeNotice(SKILL, true)
    const twice = injectWorktreeNotice(once, true)
    expect(twice).toBe(once)
    expect(twice.split(WORKTREE_START)).toHaveLength(2)
  })

  test('worktree=false → блоку немає, контент незмінний', () => {
    const out = injectWorktreeNotice(SKILL, false)
    expect(out).not.toContain(WORKTREE_START)
    expect(out).toBe(SKILL)
  })

  test('worktree=false прибирає наявний блок', () => {
    const withBlock = injectWorktreeNotice(SKILL, true)
    const stripped = injectWorktreeNotice(withBlock, false)
    expect(stripped).not.toContain(WORKTREE_START)
    expect(stripped).toContain('# n-fix')
    expect(stripped).toContain('name: fix')
  })

  test('зміна тексту всередині маркерів не ламає ре-синк', () => {
    const withBlock = injectWorktreeNotice(SKILL, true)
    const tampered = withBlock.replace(WORKTREE_BLOCK_RE, `${WORKTREE_START}\n> змінений текст\n${WORKTREE_END}`)
    const resynced = injectWorktreeNotice(tampered, true)
    expect(resynced.split(WORKTREE_START)).toHaveLength(2)
    expect(resynced).toContain('один інстанс за раз')
    expect(resynced).toContain('feature/x-fix')
  })

  test('suffix береться з назви скіла і обрізається до 10 символів', () => {
    const out = injectWorktreeNotice(SKILL.replace('name: fix', 'name: n-coverage-fix'), true)
    expect(out).toContain('feature/x-coverage-f')
    expect(out).toContain('n-coverage-f: worktree-only skill')
  })

  test('suffix транслітерує кирилицю', () => {
    const out = injectWorktreeNotice(SKILL.replace('name: fix', 'name: Фікс тестів'), true)
    expect(out).toContain('feature/x-fiks-testi')
  })
})

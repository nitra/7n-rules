import { describe, expect, test } from 'vitest'

import { WORKTREE_END, WORKTREE_START, injectWorktreeNotice } from '../worktree-notice.mjs'

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

  test('worktree=true → жорсткий fail-fast gate (preflight + ABORT), не порада', () => {
    const out = injectWorktreeNotice(SKILL, true)
    expect(out).toContain('[!IMPORTANT]')
    expect(out).toContain('git rev-parse --show-toplevel')
    expect(out).toContain('ABORT')
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
    const tampered = withBlock.replace(
      /<!-- n-cursor:worktree:start -->[\s\S]*?<!-- n-cursor:worktree:end -->/u,
      `${WORKTREE_START}\n> змінений текст\n${WORKTREE_END}`
    )
    const resynced = injectWorktreeNotice(tampered, true)
    expect(resynced.split(WORKTREE_START)).toHaveLength(2)
    expect(resynced).toContain('один інстанс за раз')
  })
})

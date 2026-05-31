import { describe, expect, test } from 'vitest'
import { join } from 'node:path'

import { buildDescription, findOrphanDescFiles, sanitizeBranch, worktreePaths } from '../worktree.mjs'

describe('sanitizeBranch', () => {
  test('слеш → дефіс', () => {
    expect(sanitizeBranch('feat/skill-meta')).toBe('feat-skill-meta')
  })
  test('кілька слешів', () => {
    expect(sanitizeBranch('a/b/c')).toBe('a-b-c')
  })
  test('без слеша — без змін', () => {
    expect(sanitizeBranch('hotfix')).toBe('hotfix')
  })
  test('небезпечні для шляху символи → дефіс', () => {
    expect(sanitizeBranch('feat\\x')).toBe('feat-x')
    expect(sanitizeBranch('a b')).toBe('a-b')
  })
  test('порожній/невалідний → кидає', () => {
    expect(() => sanitizeBranch('')).toThrow()
    expect(() => sanitizeBranch('/')).toThrow()
  })
})

describe('worktreePaths', () => {
  test('детерміновані шляхи від кореня репо', () => {
    const p = worktreePaths('/repo', 'feat/x')
    expect(p.checkout).toBe(join('/repo', '.worktrees', 'feat-x'))
    expect(p.descFile).toBe(join('/repo', '.worktrees', 'feat-x.md'))
  })
})

describe('buildDescription', () => {
  test('містить усі поля за шаблоном', () => {
    const md = buildDescription({
      branch: 'feat/x',
      task: 'зробити Y',
      baseCommit: 'abc1234',
      date: '2026-05-31'
    })
    expect(md).toContain('# feat/x')
    expect(md).toContain('зробити Y')
    expect(md).toContain('2026-05-31')
    expect(md).toContain('abc1234')
    expect(md).toContain('npx @nitra/cursor worktree remove feat/x')
  })
})

describe('findOrphanDescFiles', () => {
  test('повертає .md без відповідного checkout', () => {
    const descFiles = ['/repo/.worktrees/a.md', '/repo/.worktrees/b.md']
    const registeredCheckouts = ['/repo/.worktrees/a']
    expect(findOrphanDescFiles(descFiles, registeredCheckouts)).toEqual(['/repo/.worktrees/b.md'])
  })
  test('усі мають checkout → порожньо', () => {
    expect(findOrphanDescFiles(['/repo/.worktrees/a.md'], ['/repo/.worktrees/a'])).toEqual([])
  })
})

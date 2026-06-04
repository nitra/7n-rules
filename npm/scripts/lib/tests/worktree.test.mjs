import { describe, expect, test } from 'vitest'
import { join } from 'node:path'

import {
  buildDescription,
  buildDirtyNotice,
  findOrphanDescFiles,
  firstFreeBranch,
  sanitizeBranch,
  worktreePaths
} from '../worktree.mjs'

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
    expect(sanitizeBranch(String.raw`feat\x`)).toBe('feat-x')
    expect(sanitizeBranch('a b')).toBe('a-b')
  })
  test('порожній/невалідний → кидає', () => {
    expect(() => sanitizeBranch('')).toThrow()
    expect(() => sanitizeBranch('/')).toThrow()
  })
})

describe('firstFreeBranch', () => {
  test('вільна назва — повертає без змін', () => {
    expect(firstFreeBranch('main-fix', () => false)).toBe('main-fix')
  })
  test('зайнята база → перший вільний числовий суфікс', () => {
    const taken = new Set(['main-fix', 'main-fix2'])
    expect(firstFreeBranch('main-fix', n => taken.has(n))).toBe('main-fix3')
  })
  test('лише база зайнята → base2', () => {
    expect(firstFreeBranch('main-fix', n => n === 'main-fix')).toBe('main-fix2')
  })
  test('обрізає пробіли по краях', () => {
    expect(firstFreeBranch('  hot  ', () => false)).toBe('hot')
  })
  test('порожнє імʼя → кидає', () => {
    expect(() => firstFreeBranch('', () => false)).toThrow()
    expect(() => firstFreeBranch('   ', () => false)).toThrow()
  })
  test('усе зайнято в межах ліміту → кидає', () => {
    expect(() => firstFreeBranch('x', () => true, 3)).toThrow()
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

describe('buildDirtyNotice', () => {
  test('чисте дерево → null', () => {
    expect(buildDirtyNotice('')).toBeNull()
    expect(buildDirtyNotice('\n')).toBeNull()
    expect(buildDirtyNotice(null)).toBeNull()
  })
  test('кілька файлів → перелік шляхів і кількість', () => {
    const out = buildDirtyNotice(' M .github/workflows/npm-publish.yml\n?? new.txt')
    expect(out).toContain('2 незакомічених змін')
    expect(out).toContain('   - .github/workflows/npm-publish.yml')
    expect(out).toContain('   - new.txt')
    expect(out).toContain('Закоміть потрібні файли')
  })
  test('перейменування → показує orig -> dest', () => {
    expect(buildDirtyNotice('R  old.js -> new.js')).toContain('   - old.js -> new.js')
  })
  test('понад поріг → лише кількість без переліку', () => {
    const porcelain = Array.from({ length: 12 }, (_, i) => ` M f${i}.txt`).join('\n')
    const out = buildDirtyNotice(porcelain)
    expect(out).toContain('12 незакомічених змін')
    expect(out).not.toContain('   - f0.txt')
  })
  test('кастомний поріг переліку', () => {
    expect(buildDirtyNotice(' M a\n M b\n M c', 2)).not.toContain('   - a')
    expect(buildDirtyNotice(' M a\n M b', 2)).toContain('   - a')
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

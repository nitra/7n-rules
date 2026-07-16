import { describe, expect, test } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { collectChangedFiles, collectChangedFilesSince } from '../changed-files.mjs'
import { withTmpDir } from '../../utils/test-helpers.mjs'

const UNREACHABLE_BASE_RE = /недосяжний/

/**
 * Поточний HEAD-комміт у dir (для використання як base).
 * @param {string} dir репо
 * @returns {string} sha
 */
function headSha(dir) {
  return spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).stdout.trim()
}

/**
 * Ініціалізує git-репо у dir з одним закоміченим `base.js`.
 * @param {string} dir каталог
 * @returns {string} той самий dir (для зручності)
 */
function initRepo(dir) {
  spawnSync('git', ['init', '-q', '--initial-branch=main'], { cwd: dir })
  spawnSync('git', ['config', 'user.email', 't@t'], { cwd: dir })
  spawnSync('git', ['config', 'user.name', 't'], { cwd: dir })
  writeFileSync(join(dir, 'base.js'), 'export const a = 1\n', 'utf8')
  spawnSync('git', ['add', '.'], { cwd: dir })
  spawnSync('git', ['commit', '-qm', 'init'], { cwd: dir })
  return dir
}

describe('collectChangedFiles', () => {
  test('modified tracked + untracked', async () => {
    await withTmpDir(dir => {
      initRepo(dir)
      writeFileSync(join(dir, 'base.js'), 'export const a = 2\n', 'utf8')
      writeFileSync(join(dir, 'new.ts'), 'export const b = 3\n', 'utf8')
      const files = collectChangedFiles(dir)
      expect(files).toContain('base.js')
      expect(files).toContain('new.ts')
    })
  })
  test('untracked у worktree-чекаутах (.worktrees, .claude/worktrees) не потрапляють у список', async () => {
    await withTmpDir(dir => {
      initRepo(dir)
      mkdirSync(join(dir, '.worktrees', 'feature-x'), { recursive: true })
      mkdirSync(join(dir, '.claude', 'worktrees', 'agent-y'), { recursive: true })
      writeFileSync(join(dir, '.worktrees', 'feature-x', 'copy.js'), 'export const w = 1\n', 'utf8')
      writeFileSync(join(dir, '.claude', 'worktrees', 'agent-y', 'COVERAGE.md'), '# x\n', 'utf8')
      writeFileSync(join(dir, 'new.ts'), 'export const b = 3\n', 'utf8')
      const files = collectChangedFiles(dir)
      expect(files).toEqual(['new.ts'])
    })
  })
  test('чисте дерево → порожньо', async () => {
    await withTmpDir(dir => {
      initRepo(dir)
      expect(collectChangedFiles(dir)).toEqual([])
    })
  })
  test('поза git → порожньо', async () => {
    await withTmpDir(dir => {
      expect(collectChangedFiles(dir)).toEqual([])
    })
  })
})

describe('collectChangedFilesSince', () => {
  test('ловить і закомічене від base, і незакомічене — однаково', async () => {
    await withTmpDir(dir => {
      initRepo(dir)
      const base = headSha(dir)
      // закомічена зміна від base
      writeFileSync(join(dir, 'committed.js'), 'export const c = 1\n', 'utf8')
      spawnSync('git', ['add', '.'], { cwd: dir })
      spawnSync('git', ['commit', '-qm', 'step'], { cwd: dir })
      // незакомічена модифікація tracked-файла + новий untracked
      writeFileSync(join(dir, 'base.js'), 'export const a = 9\n', 'utf8')
      writeFileSync(join(dir, 'untracked.ts'), 'export const u = 1\n', 'utf8')

      const files = collectChangedFilesSince(base, dir)
      expect(files).toContain('committed.js') // закомічене від base
      expect(files).toContain('base.js') // незакомічена модифікація
      expect(files).toContain('untracked.ts') // новий untracked
    })
  })

  test('base=null → fallback на collectChangedFiles (working-tree vs HEAD)', async () => {
    await withTmpDir(dir => {
      initRepo(dir)
      writeFileSync(join(dir, 'base.js'), 'export const a = 2\n', 'utf8')
      expect(collectChangedFilesSince(null, dir)).toEqual(collectChangedFiles(dir))
    })
  })

  test('чисте дерево на base=HEAD → порожньо', async () => {
    await withTmpDir(dir => {
      initRepo(dir)
      expect(collectChangedFilesSince(headSha(dir), dir)).toEqual([])
    })
  })

  test('недосяжний base → throw (fail-closed, не порожній scope)', async () => {
    await withTmpDir(dir => {
      initRepo(dir)
      // 40-значний, але неіснуючий sha → git rev-parse --verify впаде.
      expect(() => collectChangedFilesSince('0'.repeat(40), dir)).toThrow(UNREACHABLE_BASE_RE)
    })
  })
})

import { describe, expect, test } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { runWorktreeCli } from '../worktree-cli.mjs'
import { withTmpDir } from '../utils/test-helpers.mjs'

/**
 * Ініціалізує git-репо з одним комітом у dir.
 * @param {string} dir абсолютний шлях
 * @returns {string} dir
 */
function initRepo(dir) {
  spawnSync('git', ['init', '-q', '--initial-branch=main'], { cwd: dir })
  spawnSync('git', ['config', 'user.email', 't@t'], { cwd: dir })
  spawnSync('git', ['config', 'user.name', 't'], { cwd: dir })
  writeFileSync(join(dir, 'f.txt'), 'x', 'utf8')
  spawnSync('git', ['add', '.'], { cwd: dir })
  spawnSync('git', ['commit', '-qm', 'init'], { cwd: dir })
  return dir
}

const silent = { log: () => { /* noop */ }, logError: () => { /* noop */ } }

describe('runWorktreeCli add', () => {
  test('створює checkout + .md від HEAD', async () => {
    await withTmpDir(async dir => {
      initRepo(dir)
      const code = await runWorktreeCli(['add', 'feat/x', 'зробити Y'], { cwd: dir, ...silent })
      expect(code).toBe(0)
      expect(existsSync(join(dir, '.worktrees', 'feat-x'))).toBe(true)
      const md = readFileSync(join(dir, '.worktrees', 'feat-x.md'), 'utf8')
      expect(md).toContain('# feat/x')
      expect(md).toContain('зробити Y')
    })
  })

  test('зайнята назва → створює сусідній checkout з числовим суфіксом', async () => {
    await withTmpDir(async dir => {
      initRepo(dir)
      await runWorktreeCli(['add', 'feat', 'перший'], { cwd: dir, ...silent })
      const code = await runWorktreeCli(['add', 'feat', 'другий'], { cwd: dir, ...silent })
      expect(code).toBe(0)
      expect(existsSync(join(dir, '.worktrees', 'feat'))).toBe(true)
      expect(existsSync(join(dir, '.worktrees', 'feat2'))).toBe(true)
      const branches = spawnSync('git', ['branch'], { cwd: dir, encoding: 'utf8' }).stdout
      expect(branches).toContain('feat2')
      const md = readFileSync(join(dir, '.worktrees', 'feat2.md'), 'utf8')
      expect(md).toContain('# feat2')
    })
  })

  test('брудне основне дерево → нагадує про незакомічені зміни', async () => {
    await withTmpDir(async dir => {
      initRepo(dir)
      writeFileSync(join(dir, 'f.txt'), 'changed', 'utf8') // незакомічена правка основного дерева
      const lines = []
      const code = await runWorktreeCli(['add', 'feat/x', 'опис'], {
        cwd: dir,
        log: line => lines.push(line),
        logError: () => { /* noop */ }
      })
      expect(code).toBe(0)
      const out = lines.join('\n')
      expect(out).toContain('незакомічених змін')
      expect(out).toContain('   - f.txt')
    })
  })

  test('чисте основне дерево → без нагадування', async () => {
    await withTmpDir(async dir => {
      initRepo(dir)
      const lines = []
      await runWorktreeCli(['add', 'feat/x', 'опис'], {
        cwd: dir,
        log: line => lines.push(line),
        logError: () => { /* noop */ }
      })
      expect(lines.join('\n')).not.toContain('незакомічених змін')
    })
  })

  test('без опису → exit 1, нічого не створює', async () => {
    await withTmpDir(async dir => {
      initRepo(dir)
      const code = await runWorktreeCli(['add', 'feat/x'], { cwd: dir, ...silent })
      expect(code).toBe(1)
      expect(existsSync(join(dir, '.worktrees', 'feat-x'))).toBe(false)
    })
  })
})

describe('runWorktreeCli remove', () => {
  test('прибирає checkout + .md, лишає гілку', async () => {
    await withTmpDir(async dir => {
      initRepo(dir)
      await runWorktreeCli(['add', 'feat/x', 'опис'], { cwd: dir, ...silent })
      const code = await runWorktreeCli(['remove', 'feat/x'], { cwd: dir, ...silent })
      expect(code).toBe(0)
      expect(existsSync(join(dir, '.worktrees', 'feat-x'))).toBe(false)
      expect(existsSync(join(dir, '.worktrees', 'feat-x.md'))).toBe(false)
      const branches = spawnSync('git', ['branch'], { cwd: dir, encoding: 'utf8' }).stdout
      expect(branches).toContain('feat/x')
    })
  })
})

describe('runWorktreeCli prune', () => {
  test('видаляє осиротілий .md', async () => {
    await withTmpDir(async dir => {
      initRepo(dir)
      const wtDir = join(dir, '.worktrees')
      mkdirSync(wtDir, { recursive: true })
      writeFileSync(join(wtDir, 'ghost.md'), '# ghost', 'utf8')
      const code = await runWorktreeCli(['prune'], { cwd: dir, ...silent })
      expect(code).toBe(0)
      expect(existsSync(join(wtDir, 'ghost.md'))).toBe(false)
    })
  })
})

describe('runWorktreeCli list', () => {
  test('повертає 0 і не падає на репо без worktree', async () => {
    await withTmpDir(async dir => {
      initRepo(dir)
      const code = await runWorktreeCli(['list'], { cwd: dir, ...silent })
      expect(code).toBe(0)
    })
  })
})

describe('runWorktreeCli usage', () => {
  test('невідома підкоманда → exit 1', async () => {
    await withTmpDir(async dir => {
      initRepo(dir)
      expect(await runWorktreeCli(['bogus'], { cwd: dir, ...silent })).toBe(1)
    })
  })
})

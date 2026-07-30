import { describe, expect, test } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { collectChangedFiles, collectChangedFilesSince, resolveChangedBase } from '../changed-files.mjs'
import { loadNative } from '../native.mjs'
import { isWorktreeCheckoutPath } from '../../utils/walkDir.mjs'
import { withTmpDir } from '../../utils/test-helpers.mjs'

const UNREACHABLE_BASE_RE = /недосяжний/
const FULL_SHA_RE = /^[0-9a-f]{40}$/

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

/**
 * Виконує git-команду в dir (обгортка для читабельності підготовки тестів).
 * @param {string} dir репо
 * @param {string[]} args аргументи git
 */
function git(dir, args) {
  spawnSync('git', args, { cwd: dir })
}

describe('resolveChangedBase', () => {
  test('stale локальна main у worktree: origin/main новіша → база від origin/main', async () => {
    await withTmpDir(dir => {
      initRepo(dir) // комміт A на main
      const shaA = headSha(dir)
      writeFileSync(join(dir, 'upstream.js'), 'export const up = 1\n', 'utf8')
      git(dir, ['add', '.'])
      git(dir, ['commit', '-qm', 'upstream'])
      const shaB = headSha(dir)
      git(dir, ['update-ref', 'refs/remotes/origin/main', shaB])
      git(dir, ['checkout', '-qb', 'feature'])
      git(dir, ['branch', '-f', 'main', shaA]) // локальна main застрягла на A
      expect(resolveChangedBase(dir)).toBe(shaB)
    })
  })

  test('локальна main новіша за stale origin/main → база від main', async () => {
    await withTmpDir(dir => {
      initRepo(dir)
      const shaA = headSha(dir)
      git(dir, ['update-ref', 'refs/remotes/origin/main', shaA]) // origin без свіжого fetch
      writeFileSync(join(dir, 'local.js'), 'export const l = 1\n', 'utf8')
      git(dir, ['add', '.'])
      git(dir, ['commit', '-qm', 'local'])
      const shaB = headSha(dir)
      git(dir, ['checkout', '-qb', 'feature'])
      expect(resolveChangedBase(dir)).toBe(shaB)
    })
  })

  test('без origin/main (офлайн/без remote) → фолбек на main', async () => {
    await withTmpDir(dir => {
      initRepo(dir)
      const shaA = headSha(dir)
      git(dir, ['checkout', '-qb', 'feature'])
      expect(resolveChangedBase(dir)).toBe(shaA)
    })
  })

  test('Git policy без main: бере найновіший merge-base серед base і release гілок', async () => {
    await withTmpDir(dir => {
      git(dir, ['init', '-q', '--initial-branch=dev'])
      git(dir, ['config', 'user.email', 't@t'])
      git(dir, ['config', 'user.name', 't'])
      writeFileSync(
        join(dir, '.n-rules.json'),
        JSON.stringify({ git: { baseBranch: 'dev', releaseBranches: ['tr-qa', 'tr'] } }),
        'utf8'
      )
      writeFileSync(join(dir, 'base.js'), 'export const a = 1\n', 'utf8')
      git(dir, ['add', '.'])
      git(dir, ['commit', '-qm', 'init'])
      writeFileSync(join(dir, 'integration.js'), 'export const i = 1\n', 'utf8')
      git(dir, ['add', '.'])
      git(dir, ['commit', '-qm', 'integration'])
      const newest = headSha(dir)
      git(dir, ['branch', 'tr'])
      git(dir, ['checkout', '-qb', 'feature'])
      expect(resolveChangedBase(dir)).toBe(newest)
    })
  })

  test('явний baseRef вимикає вибір — merge-base лише проти нього', async () => {
    await withTmpDir(dir => {
      initRepo(dir)
      const shaA = headSha(dir)
      writeFileSync(join(dir, 'next.js'), 'export const n = 1\n', 'utf8')
      git(dir, ['add', '.'])
      git(dir, ['commit', '-qm', 'next'])
      expect(resolveChangedBase(dir, shaA)).toBe(shaA)
    })
  })

  test('жодного ref (гілка не main, origin відсутній) → null', async () => {
    await withTmpDir(dir => {
      git(dir, ['init', '-q', '--initial-branch=trunk'])
      git(dir, ['config', 'user.email', 't@t'])
      git(dir, ['config', 'user.name', 't'])
      writeFileSync(join(dir, 'base.js'), 'export const a = 1\n', 'utf8')
      git(dir, ['add', '.'])
      git(dir, ['commit', '-qm', 'init'])
      expect(resolveChangedBase(dir)).toBeNull()
    })
  })

  test('контракт: результат — або null, або повний 40-символьний hex sha', async () => {
    await withTmpDir(dir => {
      initRepo(dir)
      writeFileSync(join(dir, 'next.js'), 'export const n = 1\n', 'utf8')
      git(dir, ['add', '.'])
      git(dir, ['commit', '-qm', 'next'])
      git(dir, ['checkout', '-qb', 'feature'])
      // З ref-ом (main існує) — рядок формату sha.
      expect(resolveChangedBase(dir)).toMatch(FULL_SHA_RE)
      // Без жодного сумісного ref-а — null, не порожній рядок/undefined.
      expect(resolveChangedBase(dir, 'does-not-exist')).toBeNull()
    })
  })

  test('linked worktree: виклик зсередини worktree дає той самий sha, що з основного дерева', async () => {
    await withTmpDir(dir => {
      const mainDir = join(dir, 'main')
      mkdirSync(mainDir, { recursive: true })
      initRepo(mainDir) // комміт A на main
      writeFileSync(join(mainDir, 'upstream.js'), 'export const up = 1\n', 'utf8')
      git(mainDir, ['add', '.'])
      git(mainDir, ['commit', '-qm', 'upstream'])
      const shaB = headSha(mainDir) // main зараз на B

      const worktreeDir = join(dir, 'linked')
      git(mainDir, ['worktree', 'add', '-q', worktreeDir, '-b', 'feature'])

      // Обидва дерева бачать один і той самий git-об'єктний граф — той самий sha.
      expect(resolveChangedBase(worktreeDir)).toBe(shaB)
      expect(resolveChangedBase(worktreeDir)).toBe(resolveChangedBase(mainDir))
    })
  })

  test('detached HEAD: merge-base рахується від HEAD навіть поза гілкою', async () => {
    await withTmpDir(dir => {
      initRepo(dir) // main на коміті A
      const shaA = headSha(dir)
      git(dir, ['checkout', '-qb', 'topic'])
      writeFileSync(join(dir, 'topic.js'), 'export const t = 1\n', 'utf8')
      git(dir, ['add', '.'])
      git(dir, ['commit', '-qm', 'topic'])
      const shaB = headSha(dir)
      git(dir, ['checkout', '-q', shaB]) // detach: HEAD = B, поза будь-якою гілкою

      const status = spawnSync('git', ['symbolic-ref', '-q', 'HEAD'], { cwd: dir })
      expect(status.status).not.toBe(0) // sanity-check: справді detached

      // main лишився на A; кандидат-гілка "main" все ще резолвиться відносно HEAD.
      expect(resolveChangedBase(dir)).toBe(shaA)
    })
  })

  test('явний integrationBranches-набір без жодного origin/*: лише локальні base+release гілки', async () => {
    await withTmpDir(dir => {
      git(dir, ['init', '-q', '--initial-branch=dev'])
      git(dir, ['config', 'user.email', 't@t'])
      git(dir, ['config', 'user.name', 't'])
      writeFileSync(
        join(dir, '.n-rules.json'),
        JSON.stringify({ git: { baseBranch: 'dev', releaseBranches: ['tr'] } }),
        'utf8'
      )
      writeFileSync(join(dir, 'base.js'), 'export const a = 1\n', 'utf8')
      git(dir, ['add', '.'])
      git(dir, ['commit', '-qm', 'init'])
      const shaA = headSha(dir)
      git(dir, ['branch', 'tr']) // tr = локальна release-гілка на shaA, без жодного origin/* взагалі
      writeFileSync(join(dir, 'more.js'), 'export const m = 1\n', 'utf8')
      git(dir, ['add', '.'])
      git(dir, ['commit', '-qm', 'more']) // dev іде далі — feature гілкується від старішої tr
      git(dir, ['checkout', '-qb', 'feature', 'tr'])
      // origin взагалі не існує (жодного remote) — лише локальні dev/tr дають merge-base.
      // HEAD = shaA (tr); спільний предок і з dev (попереду), і з tr (сам HEAD) — shaA.
      expect(resolveChangedBase(dir)).toBe(shaA)
    })
  })

  test('shallow clone (--depth 1, файловий remote): fail-closed як голий git CLI', async () => {
    await withTmpDir(dir => {
      const srcDir = join(dir, 'src')
      mkdirSync(srcDir, { recursive: true })
      git(srcDir, ['init', '-q', '--initial-branch=main'])
      git(srcDir, ['config', 'user.email', 't@t'])
      git(srcDir, ['config', 'user.name', 't'])
      writeFileSync(join(srcDir, 'a.txt'), 'a\n', 'utf8')
      git(srcDir, ['add', '.'])
      git(srcDir, ['commit', '-qm', 'C1'])
      git(srcDir, ['branch', 'other']) // other = C1, залишається позаду
      writeFileSync(join(srcDir, 'b.txt'), 'b\n', 'utf8')
      git(srcDir, ['add', '.'])
      git(srcDir, ['commit', '-qm', 'm2']) // main випереджає other на 1 коміт

      const cloneDir = join(dir, 'clone')
      const clone = spawnSync(
        'git',
        ['clone', '-q', '--depth', '1', '--no-single-branch', `file://${srcDir}`, cloneDir],
        { encoding: 'utf8' }
      )
      expect(clone.status).toBe(0)
      // Policy вказує лише на "other" (не "main") — інакше тривіальний збіг HEAD===origin/main
      // (обидва на m2, без обходу історії) замаскував би розбіжність нижче.
      writeFileSync(
        join(cloneDir, '.n-rules.json'),
        JSON.stringify({ git: { baseBranch: 'other', releaseBranches: ['other'] } }),
        'utf8'
      )

      // Контрольна перевірка фікстури: сирий `git merge-base` на shallow-клоні не
      // бачить спільного предка (shallow-обрізана історія приховує батьків m2) і
      // падає з ненульовим exit-кодом.
      const cliMergeBase = spawnSync('git', ['merge-base', 'HEAD', 'origin/other'], { cwd: cloneDir })
      expect(cliMergeBase.status).not.toBe(0)

      // native (`rules-core`) детектує shallow-репо (`Repository::is_shallow()`) і на
      // такому репо рахує merge-base через ту саму porcelain-межу, що й дореформений
      // JS, — не через gix-traversal (який ігнорує shallow-обрізання й дав би sha,
      // навіть коли об'єкт-предок фізично присутній локально). Consumer-CI з
      // fetch-depth:1 покладається саме на fail-closed null тут.
      const result = resolveChangedBase(cloneDir)
      expect(result).toBeNull()
    })
  })
})

describe('isWorktreeCheckoutPath: native ⇄ JS (walkDir.mjs) parity', () => {
  test.each([
    '.worktrees/a.js',
    'x/.worktrees/a.js',
    '.claude/worktrees/a.js',
    'x/.claude/worktrees/a.js',
    '.claude/foo/worktrees/a.js',
    'foo.worktrees/x.js',
    '.worktrees',
    'src/ok.mjs'
  ])('%s', p => {
    expect(loadNative().isWorktreeCheckoutPath(p)).toBe(isWorktreeCheckoutPath(p))
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

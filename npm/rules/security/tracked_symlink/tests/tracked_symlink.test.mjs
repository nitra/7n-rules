/**
 * Тести detector-а security/tracked_symlink на справжніх git-індексах у тимчасових репо:
 * відстежений symlink за межі дерева (абсолютний і `../`-відносний) — порушення;
 * symlink всередині дерева, звичайні файли й не-git тека — чисто.
 */
import { describe, expect, test } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdir, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { lint } from '../main.mjs'
import { withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'

const run = dir => lint({ cwd: dir, ruleId: 'security', concernId: 'tracked_symlink', files: undefined })

/**
 * Ініціалізує порожнє git-репо у теці (без коміту — detector читає індекс, не HEAD).
 * @param {string} dir абсолютний шлях теки
 * @returns {void}
 */
function initRepo(dir) {
  spawnSync('git', ['init', '-q'], { cwd: dir, encoding: 'utf8' })
}

/**
 * Додає шляхи в індекс, обходячи .gitignore (`-f`) — фікстури свідомо імітують
 * саме той випадок, коли ignore вже не рятує через tracked-стан.
 * @param {string} dir корінь репо
 * @param {string[]} paths шляхи для `git add`
 * @returns {void}
 */
function gitAdd(dir, paths) {
  spawnSync('git', ['add', '-f', ...paths], { cwd: dir, encoding: 'utf8' })
}

describe('security/tracked_symlink', () => {
  test('відстежений symlink на абсолютний шлях — порушення absolute-target', async () => {
    await withTmpDir(async dir => {
      initRepo(dir)
      await symlink('/private/tmp/claude-501/cargo-target-external', join(dir, 'target'))
      gitAdd(dir, ['target'])

      const res = await run(dir)
      expect(res.violations).toHaveLength(1)
      expect(res.violations[0].reason).toBe('absolute-target')
      expect(res.violations[0].file).toBe('target')
      expect(res.violations[0].data.target).toBe('/private/tmp/claude-501/cargo-target-external')
      expect(res.violations[0].message).toContain('git rm --cached target')
    })
  })

  test('відносний symlink, що виходить за корінь репо — порушення escapes-repo', async () => {
    await withTmpDir(async dir => {
      initRepo(dir)
      await mkdir(join(dir, 'crates'))
      await symlink('../../outside/build', join(dir, 'crates', 'artifacts'))
      gitAdd(dir, ['crates/artifacts'])

      const res = await run(dir)
      expect(res.violations).toHaveLength(1)
      expect(res.violations[0].reason).toBe('escapes-repo')
      expect(res.violations[0].file).toBe('crates/artifacts')
    })
  })

  test('symlink всередині дерева — чисто (навіть з `..` у середині шляху)', async () => {
    await withTmpDir(async dir => {
      initRepo(dir)
      await mkdir(join(dir, 'pkg', 'nested'), { recursive: true })
      await writeFile(join(dir, 'pkg', 'real.txt'), 'x\n')
      await symlink('../real.txt', join(dir, 'pkg', 'nested', 'link.txt'))
      await symlink('pkg/real.txt', join(dir, 'root-link.txt'))
      gitAdd(dir, ['pkg', 'root-link.txt'])

      const res = await run(dir)
      expect(res.violations).toHaveLength(0)
    })
  })

  test('репо без symlink-ів — чисто', async () => {
    await withTmpDir(async dir => {
      initRepo(dir)
      await writeFile(join(dir, 'a.txt'), 'a\n')
      gitAdd(dir, ['a.txt'])

      const res = await run(dir)
      expect(res.violations).toHaveLength(0)
    })
  })

  test('не git-робоче дерево — пропуск із діагностикою, без порушень', async () => {
    await withTmpDir(async dir => {
      await symlink('/private/tmp/whatever', join(dir, 'target'))

      const res = await run(dir)
      expect(res.violations).toHaveLength(0)
      expect(res.diagnostics?.[0].level).toBe('info')
    })
  })

  test('кілька поганих symlink-ів — по порушенню на кожен', async () => {
    await withTmpDir(async dir => {
      initRepo(dir)
      await symlink('/var/tmp/a', join(dir, 'a'))
      await symlink('/var/tmp/b', join(dir, 'b'))
      gitAdd(dir, ['a', 'b'])

      const res = await run(dir)
      expect(res.violations).toHaveLength(2)
      expect(res.violations.map(v => v.file).sort()).toEqual(['a', 'b'])
    })
  })
})

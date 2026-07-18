import { describe, expect, test } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { collectPathScopedChangedFiles, collectPathScopedFiles } from '../path-scope.mjs'
import { withTmpDir, writeJson } from '../../../utils/test-helpers.mjs'

/**
 * Git-репо у dir (гілка branch) з закоміченими pkg/a.js і outside.js.
 * @param {string} dir каталог
 * @param {string} [branch] початкова гілка
 */
async function initRepo(dir, branch = 'main') {
  spawnSync('git', ['init', '-q', `--initial-branch=${branch}`], { cwd: dir })
  spawnSync('git', ['config', 'user.email', 't@t'], { cwd: dir })
  spawnSync('git', ['config', 'user.name', 't'], { cwd: dir })
  await mkdir(join(dir, 'pkg'), { recursive: true })
  await writeFile(join(dir, 'pkg', 'a.js'), 'export const a = 1\n', 'utf8')
  await writeFile(join(dir, 'outside.js'), 'export const o = 1\n', 'utf8')
  spawnSync('git', ['add', '.'], { cwd: dir })
  spawnSync('git', ['commit', '-qm', 'init'], { cwd: dir })
}

const RE_OUTSIDE_CWD = /усередині/u
const RE_NOT_A_DIR = /не є каталогом/u

describe('collectPathScopedFiles', () => {
  test('повертає лише файли під --path, відносно cwd', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'pkg', 'src'), { recursive: true })
      await writeFile(join(dir, 'pkg', 'src', 'a.js'), 'export {}\n', 'utf8')
      await writeFile(join(dir, 'outside.js'), 'export {}\n', 'utf8')

      const files = await collectPathScopedFiles(dir, 'pkg')

      expect(files).toEqual(['pkg/src/a.js'])
    })
  })

  test('поважає .n-rules.json:ignore', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'pkg', 'vendor'), { recursive: true })
      await writeFile(join(dir, 'pkg', 'kept.js'), 'export {}\n', 'utf8')
      await writeFile(join(dir, 'pkg', 'vendor', 'skip.js'), 'export {}\n', 'utf8')
      await writeJson(join(dir, '.n-rules.json'), { ignore: ['pkg/vendor'] })

      const files = await collectPathScopedFiles(dir, 'pkg')

      expect(files).toEqual(['pkg/kept.js'])
    })
  })

  test('порожній каталог → порожній список, не помилка', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'empty'), { recursive: true })

      const files = await collectPathScopedFiles(dir, 'empty')

      expect(files).toEqual([])
    })
  })

  test('traversal через .. поза cwd → помилка', async () => {
    await withTmpDir(async dir => {
      await expect(collectPathScopedFiles(dir, '../etc')).rejects.toThrow(RE_OUTSIDE_CWD)
    })
  })

  test('неіснуючий каталог → помилка', async () => {
    await withTmpDir(async dir => {
      await expect(collectPathScopedFiles(dir, 'nope')).rejects.toThrow(RE_NOT_A_DIR)
    })
  })

  test('шлях на файл, не каталог → помилка', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'file.txt'), 'x', 'utf8')
      await expect(collectPathScopedFiles(dir, 'file.txt')).rejects.toThrow(RE_NOT_A_DIR)
    })
  })
})

describe('collectPathScopedChangedFiles', () => {
  test('перетин: змінені/untracked у path так, поза path і незмінені — ні', async () => {
    await withTmpDir(async dir => {
      await initRepo(dir)
      await writeFile(join(dir, 'pkg', 'a.js'), 'export const a = 2\n', 'utf8')
      await writeFile(join(dir, 'pkg', 'new.js'), 'export const n = 1\n', 'utf8')
      await writeFile(join(dir, 'outside.js'), 'export const o = 2\n', 'utf8')
      await mkdir(join(dir, 'pkg', 'sub'), { recursive: true })
      await writeFile(join(dir, 'pkg', 'sub', 'kept.js'), 'export const k = 1\n', 'utf8')

      const r = await collectPathScopedChangedFiles(dir, 'pkg')

      expect(r.baseResolved).toBe(true)
      expect(r.files).toEqual(['pkg/a.js', 'pkg/new.js', 'pkg/sub/kept.js'])
    })
  })

  test('незмінений файл path не потрапляє (на відміну від collectPathScopedFiles)', async () => {
    await withTmpDir(async dir => {
      await initRepo(dir)
      await writeFile(join(dir, 'pkg', 'new.md'), '# x\n', 'utf8')

      const r = await collectPathScopedChangedFiles(dir, 'pkg')

      expect(r.files).toEqual(['pkg/new.md'])
    })
  })

  test('поважає .n-rules.json:ignore усередині перетину', async () => {
    await withTmpDir(async dir => {
      await initRepo(dir)
      await mkdir(join(dir, 'pkg', 'vendor'), { recursive: true })
      await writeFile(join(dir, 'pkg', 'vendor', 'skip.js'), 'export {}\n', 'utf8')
      await writeFile(join(dir, 'pkg', 'kept.js'), 'export {}\n', 'utf8')
      await writeJson(join(dir, '.n-rules.json'), { ignore: ['pkg/vendor'] })

      const r = await collectPathScopedChangedFiles(dir, 'pkg')

      expect(r.files).toEqual(['pkg/kept.js'])
    })
  })

  test('немає main/origin/main → baseResolved:false, без файлів', async () => {
    await withTmpDir(async dir => {
      await initRepo(dir, 'trunk')
      await writeFile(join(dir, 'pkg', 'a.js'), 'export const a = 2\n', 'utf8')

      const r = await collectPathScopedChangedFiles(dir, 'pkg')

      expect(r).toEqual({ files: [], baseResolved: false })
    })
  })

  test('--base: явний ref замість каскаду main→origin/main', async () => {
    await withTmpDir(async dir => {
      await initRepo(dir, 'trunk')
      await writeFile(join(dir, 'pkg', 'b.js'), 'export const b = 1\n', 'utf8')
      spawnSync('git', ['add', '.'], { cwd: dir })
      spawnSync('git', ['commit', '-qm', 'add b'], { cwd: dir })

      const r = await collectPathScopedChangedFiles(dir, 'pkg', { baseRef: 'HEAD~1' })

      expect(r.baseResolved).toBe(true)
      expect(r.files).toEqual(['pkg/b.js'])
    })
  })

  test('порожній перетин → порожній список, baseResolved:true', async () => {
    await withTmpDir(async dir => {
      await initRepo(dir)
      await writeFile(join(dir, 'outside.js'), 'export const o = 2\n', 'utf8')

      const r = await collectPathScopedChangedFiles(dir, 'pkg')

      expect(r).toEqual({ files: [], baseResolved: true })
    })
  })

  test('traversal через .. поза cwd → помилка', async () => {
    await withTmpDir(async dir => {
      await initRepo(dir)
      await expect(collectPathScopedChangedFiles(dir, '../etc')).rejects.toThrow(RE_OUTSIDE_CWD)
    })
  })
})

import { describe, expect, test } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { collectPathScopedFiles } from '../path-scope.mjs'
import { withTmpDir, writeJson } from '../../../utils/test-helpers.mjs'

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

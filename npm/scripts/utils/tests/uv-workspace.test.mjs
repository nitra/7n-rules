/**
 * Тести `uv-workspace.mjs`: резолв `[tool.uv.workspace].members`-glob-патернів у каталоги
 * (спільна утиліта `python/workspace_root`, дзеркало `cargo-workspace.mjs`).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import { readPyprojectManifest, resolveUvWorkspaceMemberDirs } from '../uv-workspace.mjs'
import { withTmpDir } from '../test-helpers.mjs'

/**
 * Пише pyproject.toml у `root/relDir`.
 * @param {string} root корінь тимчасового репозиторію
 * @param {string} relDir відносний каталог
 * @param {string} content вміст pyproject.toml
 */
function writeManifest(root, relDir, content) {
  const dir = join(root, relDir)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'pyproject.toml'), content)
}

describe('resolveUvWorkspaceMemberDirs', () => {
  test('літеральні шляхи резолвляться в абсолютні каталоги з pyproject.toml', async () => {
    await withTmpDir(async root => {
      writeManifest(root, 'a', '[project]\nname="a"\nversion="0.1.0"\n')
      writeManifest(root, 'b', '[project]\nname="b"\nversion="0.1.0"\n')
      const dirs = await resolveUvWorkspaceMemberDirs(root, ['a', 'b'])
      expect(new Set(dirs)).toEqual(new Set([join(root, 'a'), join(root, 'b')]))
    })
  })

  test('glob `packages/*` резолвиться в усі підкаталоги з pyproject.toml', async () => {
    await withTmpDir(async root => {
      writeManifest(root, 'packages/a', '[project]\nname="a"\nversion="0.1.0"\n')
      writeManifest(root, 'packages/b', '[project]\nname="b"\nversion="0.1.0"\n')
      mkdirSync(join(root, 'packages', 'no-manifest'), { recursive: true })
      const dirs = await resolveUvWorkspaceMemberDirs(root, ['packages/*'])
      expect(new Set(dirs)).toEqual(new Set([join(root, 'packages', 'a'), join(root, 'packages', 'b')]))
    })
  })

  test('патерн без відповідного pyproject.toml — не потрапляє в результат', async () => {
    await withTmpDir(async root => {
      mkdirSync(join(root, 'ghost'), { recursive: true })
      const dirs = await resolveUvWorkspaceMemberDirs(root, ['ghost'])
      expect(dirs).toEqual([])
    })
  })
})

describe('readPyprojectManifest', () => {
  test('null для відсутнього файлу', async () => {
    await withTmpDir(async root => {
      expect(await readPyprojectManifest(join(root, 'pyproject.toml'))).toBe(null)
    })
  })

  test('розпарсений TOML для валідного файлу', async () => {
    await withTmpDir(async root => {
      writeManifest(root, '', '[project]\nname="root"\nversion="0.1.0"\n')
      const parsed = await readPyprojectManifest(join(root, 'pyproject.toml'))
      expect(parsed?.project?.name).toBe('root')
    })
  })
})

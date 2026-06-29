/**
 * Тести rules/python/js/tooling.mjs: FS-перевірки uv-проєкту (pyproject.toml,
 * uv.lock, package.json, workflow) і заборона Poetry-артефактів.
 *
 * Використовує `withTmpDir` + `check(dir)` — без `process.chdir` (контракт test-helpers).
 */
import { describe, expect, test } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { main as check } from '../main.mjs'
import { withTmpDir, writeJson, ensureDir } from '../../../../scripts/utils/test-helpers.mjs'

/**
 * Створює мінімальний валідний uv-проєкт у каталозі.
 * @param {string} dir абсолютний шлях каталогу
 * @returns {Promise<void>}
 */
async function writeValidUvProject(dir) {
  await writeFile(join(dir, 'pyproject.toml'), '[project]\nname = "demo"\nversion = "0.1.0"\n', 'utf8')
  await writeFile(join(dir, 'uv.lock'), 'version = 1\n', 'utf8')
  await writeJson(join(dir, 'package.json'), { name: 'demo', private: true, scripts: { 'lint-python': 'bun' } })
  await ensureDir(join(dir, '.github', 'workflows'))
  await writeFile(join(dir, '.github', 'workflows', 'lint-python.yml'), 'name: Lint Python\n', 'utf8')
}

describe('check (tooling)', () => {
  test('0 — не Python-проєкт (без pyproject.toml)', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'x', private: true })
      expect(check(dir)).toBe(0)
    })
  })

  test('0 — валідний uv-проєкт (PEP 621 + uv.lock + workflow)', async () => {
    await withTmpDir(async dir => {
      await writeValidUvProject(dir)
      expect(check(dir)).toBe(0)
    })
  })

  test('1 — присутній poetry.lock', async () => {
    await withTmpDir(async dir => {
      await writeValidUvProject(dir)
      await writeFile(join(dir, 'poetry.lock'), '', 'utf8')
      expect(check(dir)).toBe(1)
    })
  })

  test('1 — присутній poetry.toml', async () => {
    await withTmpDir(async dir => {
      await writeValidUvProject(dir)
      await writeFile(join(dir, 'poetry.toml'), '', 'utf8')
      expect(check(dir)).toBe(1)
    })
  })

  test('1 — відсутній uv.lock', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'pyproject.toml'), '[project]\nname = "demo"\nversion = "0.1.0"\n', 'utf8')
      await writeJson(join(dir, 'package.json'), { name: 'demo', private: true })
      await ensureDir(join(dir, '.github', 'workflows'))
      await writeFile(join(dir, '.github', 'workflows', 'lint-python.yml'), 'name: Lint Python\n', 'utf8')
      expect(check(dir)).toBe(1)
    })
  })

  test('1 — відсутній workflow lint-python.yml', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'pyproject.toml'), '[project]\nname = "demo"\nversion = "0.1.0"\n', 'utf8')
      await writeFile(join(dir, 'uv.lock'), 'version = 1\n', 'utf8')
      await writeJson(join(dir, 'package.json'), { name: 'demo', private: true })
      expect(check(dir)).toBe(1)
    })
  })
})

/**
 * Тести концерну `python/workspace_root` (workspace_root.mdc): один кореневий uv
 * workspace на репозиторій — дзеркало `rust/workspace_root` на бік Python/uv.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import {
  MISSING_ROOT_WORKSPACE,
  NESTED_LOCKFILE,
  NESTED_WORKSPACE,
  PACKAGE_NOT_WORKSPACE_MEMBER,
  lint
} from '../main.mjs'
import { withTmpDir } from '@7n/rules/scripts/utils/test-helpers.mjs'

/**
 * Пише pyproject.toml у `root/relDir` (порожній `relDir` — кореневий файл).
 * @param {string} root корінь тимчасового репозиторію
 * @param {string} relDir відносний каталог (`''` — корінь)
 * @param {string} content вміст pyproject.toml
 */
function writeManifest(root, relDir, content) {
  const dir = relDir ? join(root, relDir) : root
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'pyproject.toml'), content)
}

/**
 * Пише uv.lock у `root/relDir`.
 * @param {string} root корінь тимчасового репозиторію
 * @param {string} relDir відносний каталог (`''` — корінь)
 */
function writeLock(root, relDir) {
  const dir = relDir ? join(root, relDir) : root
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'uv.lock'), 'version = 1\n')
}

/**
 * @param {string} dir корінь репозиторію
 * @returns {Promise<import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintViolation[]>} violations
 */
async function run(dir) {
  const { violations } = await lint({ cwd: dir, ruleId: 'python', concernId: 'workspace_root', files: undefined })
  return violations
}

describe('python/workspace_root', () => {
  test('a) кореневий [tool.uv.workspace] покриває всіх members — чисто', async () => {
    await withTmpDir(async root => {
      writeManifest(root, '', '[tool.uv.workspace]\nmembers = ["packages/a", "packages/b"]\n')
      writeManifest(root, 'packages/a', '[project]\nname = "a"\nversion = "0.1.0"\n')
      writeManifest(root, 'packages/b', '[project]\nname = "b"\nversion = "0.1.0"\n')
      writeLock(root, '')
      const violations = await run(root)
      expect(violations).toEqual([])
    })
  })

  test('b) вкладений package без кореневого workspace взагалі → missing-root-workspace', async () => {
    await withTmpDir(async root => {
      writeManifest(root, 'packages/a', '[project]\nname = "a"\nversion = "0.1.0"\n')
      const violations = await run(root)
      expect(violations.some(v => v.reason === MISSING_ROOT_WORKSPACE)).toBe(true)
    })
  })

  test('c) єдиний кореневий [project] без нащадків — чисто (неявний workspace root)', async () => {
    await withTmpDir(async root => {
      writeManifest(root, '', '[project]\nname = "solo"\nversion = "0.1.0"\n')
      writeLock(root, '')
      const violations = await run(root)
      expect(violations).toEqual([])
    })
  })

  test('d) вкладений [tool.uv.workspace] глибше кореня → nested-workspace violation', async () => {
    await withTmpDir(async root => {
      writeManifest(root, '', '[tool.uv.workspace]\nmembers = ["packages/a"]\n')
      writeManifest(root, 'packages/a', '[project]\nname = "a"\nversion = "0.1.0"\n')
      writeManifest(root, 'nested', '[tool.uv.workspace]\nmembers = ["sub"]\n')
      writeManifest(root, 'nested/sub', '[project]\nname = "sub"\nversion = "0.1.0"\n')
      const violations = await run(root)
      expect(violations.some(v => v.reason === NESTED_WORKSPACE && v.file === 'nested/pyproject.toml')).toBe(true)
    })
  })

  test('e) package не покритий members кореня (і не excluded) → package-not-workspace-member violation', async () => {
    await withTmpDir(async root => {
      writeManifest(root, '', '[tool.uv.workspace]\nmembers = ["packages/a"]\n')
      writeManifest(root, 'packages/a', '[project]\nname = "a"\nversion = "0.1.0"\n')
      writeManifest(root, 'packages/orphan', '[project]\nname = "orphan"\nversion = "0.1.0"\n')
      const violations = await run(root)
      expect(
        violations.some(v => v.reason === PACKAGE_NOT_WORKSPACE_MEMBER && v.file === 'packages/orphan/pyproject.toml')
      ).toBe(true)
    })
  })

  test('f) вкладений uv.lock у не-excluded member → nested-lockfile violation', async () => {
    await withTmpDir(async root => {
      writeManifest(root, '', '[tool.uv.workspace]\nmembers = ["packages/a"]\n')
      writeManifest(root, 'packages/a', '[project]\nname = "a"\nversion = "0.1.0"\n')
      writeLock(root, '')
      writeLock(root, 'packages/a')
      const violations = await run(root)
      expect(violations.some(v => v.reason === NESTED_LOCKFILE && v.file === 'packages/a/uv.lock')).toBe(true)
    })
  })

  test('g) вкладений uv.lock у EXCLUDED member — чисто (escape hatch для конфліктних залежностей)', async () => {
    await withTmpDir(async root => {
      writeManifest(root, '', '[tool.uv.workspace]\nmembers = ["packages/*"]\nexclude = ["packages/conflicting"]\n')
      writeManifest(root, 'packages/a', '[project]\nname = "a"\nversion = "0.1.0"\n')
      writeManifest(root, 'packages/conflicting', '[project]\nname = "conflicting"\nversion = "0.1.0"\n')
      writeLock(root, '')
      writeLock(root, 'packages/conflicting')
      const violations = await run(root)
      expect(violations).toEqual([])
    })
  })

  test('немає жодного pyproject.toml з [project] — концерн не застосовний', async () => {
    await withTmpDir(async root => {
      mkdirSync(root, { recursive: true })
      writeFileSync(join(root, 'app.py'), 'print("hi")\n')
      const violations = await run(root)
      expect(violations).toEqual([])
    })
  })

  test('віртуальний кореневий workspace (без [project]) покриває всіх members — чисто', async () => {
    await withTmpDir(async root => {
      writeManifest(root, '', '[tool.uv.workspace]\nmembers = ["packages/a"]\n')
      writeManifest(root, 'packages/a', '[project]\nname = "a"\nversion = "0.1.0"\n')
      writeLock(root, '')
      const violations = await run(root)
      expect(violations).toEqual([])
    })
  })

  test('.venv/ і node_modules/ пропускаються обходом', async () => {
    await withTmpDir(async root => {
      writeManifest(root, '', '[tool.uv.workspace]\nmembers = ["packages/a"]\n')
      writeManifest(root, 'packages/a', '[project]\nname = "a"\nversion = "0.1.0"\n')
      writeManifest(root, '.venv/lib/site-packages/foo', '[project]\nname = "ignored"\nversion = "0.1.0"\n')
      writeManifest(root, 'node_modules/pkg', '[project]\nname = "ignored2"\nversion = "0.1.0"\n')
      const violations = await run(root)
      expect(violations).toEqual([])
    })
  })
})

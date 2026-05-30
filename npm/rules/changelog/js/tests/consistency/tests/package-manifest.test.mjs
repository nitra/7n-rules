/**
 * Тести package-manifest.mjs — парсинг pyproject.toml і readPackageManifest.
 */
import { describe, expect, test } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { parsePyprojectFields, readPackageManifest } from '../../../../lib/package-manifest.mjs'
import { withTmpDir } from '../../../../../../scripts/utils/test-helpers.mjs'

describe('parsePyprojectFields', () => {
  test('PEP 621 [project]', () => {
    const fields = parsePyprojectFields(`[project]\nname = "x"\nversion = "1.2.3"\n`)
    expect(fields).toEqual({ name: 'x', version: '1.2.3' })
  })

  test('Poetry [tool.poetry]', () => {
    const fields = parsePyprojectFields(`[tool.poetry]\nname = "poetry-pkg"\nversion = "0.9.0"\n`)
    expect(fields).toEqual({ name: 'poetry-pkg', version: '0.9.0' })
  })

  test('invalid TOML → { name: null, version: null } (line 69)', () => {
    const fields = parsePyprojectFields('NOT VALID = = = TOML')
    expect(fields).toEqual({ name: null, version: null })
  })

  test('TOML без [project] і без [tool.poetry] → { name: null, version: null } (line 58)', () => {
    const fields = parsePyprojectFields('[other]\nfoo = "bar"\n')
    expect(fields).toEqual({ name: null, version: null })
  })
})

describe('readPackageManifest', () => {
  test('python без package.json', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'pyproject.toml'), '[project]\nversion = "1.0.0"\n', 'utf8')
      const m = await readPackageManifest('.', dir)
      expect(m?.kind).toBe('python')
      expect(m?.version).toBe('1.0.0')
      expect(m?.registryPublishable).toBe(false)
    })
  })

  test('npm має пріоритет над pyproject у тому ж каталозі', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'package.json'), '{"name":"a","version":"2.0.0","private":true}\n', 'utf8')
      await writeFile(join(dir, 'pyproject.toml'), '[project]\nname = "py"\nversion = "9.0.0"\n', 'utf8')
      const m = await readPackageManifest('.', dir)
      expect(m?.kind).toBe('npm')
      expect(m?.version).toBe('2.0.0')
    })
  })

  test('package.json є масивом → null (line 84)', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'package.json'), '[]', 'utf8')
      const m = await readPackageManifest('.', dir)
      expect(m).toBeNull()
    })
  })

  test('package.json з невалідним JSON → null (line 99)', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'package.json'), 'NOT JSON', 'utf8')
      const m = await readPackageManifest('.', dir)
      expect(m).toBeNull()
    })
  })

  test('немає ні package.json ні pyproject.toml → null (line 105)', async () => {
    await withTmpDir(async dir => {
      const m = await readPackageManifest('.', dir)
      expect(m).toBeNull()
    })
  })
})

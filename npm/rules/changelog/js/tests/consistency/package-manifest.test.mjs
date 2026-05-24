/**
 * Тести package-manifest.mjs — парсинг pyproject.toml і readPackageManifest.
 */
import { describe, expect, test } from 'bun:test'
import { writeFile } from 'node:fs/promises'

import { parsePyprojectFields, readPackageManifest } from '../../../utils/package-manifest.mjs'
import { withTmpCwd } from '../../../../../scripts/utils/test-helpers.mjs'

describe('parsePyprojectFields', () => {
  test('PEP 621 [project]', () => {
    const fields = parsePyprojectFields(`[project]\nname = "x"\nversion = "1.2.3"\n`)
    expect(fields).toEqual({ name: 'x', version: '1.2.3' })
  })

  test('Poetry [tool.poetry]', () => {
    const fields = parsePyprojectFields(`[tool.poetry]\nname = "poetry-pkg"\nversion = "0.9.0"\n`)
    expect(fields).toEqual({ name: 'poetry-pkg', version: '0.9.0' })
  })
})

describe('readPackageManifest', () => {
  test('python без package.json', async () => {
    await withTmpCwd(async () => {
      await writeFile('pyproject.toml', '[project]\nversion = "1.0.0"\n', 'utf8')
      const m = await readPackageManifest('.')
      expect(m?.kind).toBe('python')
      expect(m?.version).toBe('1.0.0')
      expect(m?.registryPublishable).toBe(false)
    })
  })

  test('npm має пріоритет над pyproject у тому ж каталозі', async () => {
    await withTmpCwd(async () => {
      await writeFile('package.json', '{"name":"a","version":"2.0.0","private":true}\n', 'utf8')
      await writeFile('pyproject.toml', '[project]\nname = "py"\nversion = "9.0.0"\n', 'utf8')
      const m = await readPackageManifest('.')
      expect(m?.kind).toBe('npm')
      expect(m?.version).toBe('2.0.0')
    })
  })
})

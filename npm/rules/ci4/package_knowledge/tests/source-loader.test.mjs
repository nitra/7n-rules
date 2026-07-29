import { mkdir, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

import { withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'
import { discoverDomainCodeExtensions, loadDomainSources } from '../source-loader.mjs'

/**
 * Створює resolved domain fixture.
 * @param {string} root absolute domain root
 * @param {Record<string, unknown>} [overrides] field overrides
 * @returns {Record<string, unknown>} domain
 */
function domain(root, overrides = {}) {
  return {
    id: 'npm:@fixture/root',
    root,
    sourceRoot: '.',
    excludedSourceRoots: ['packages/nested'],
    ...overrides
  }
}

describe('loadDomainSources', () => {
  test('loads stable source order and excludes nested package/build trees', async () => {
    await withTmpDir(async root => {
      await mkdir(join(root, 'src'), { recursive: true })
      await mkdir(join(root, 'packages', 'nested'), { recursive: true })
      await mkdir(join(root, 'dist'), { recursive: true })
      await writeFile(join(root, 'src', 'z.mjs'), 'z')
      await writeFile(join(root, 'src', 'a.ts'), 'a')
      await writeFile(join(root, 'packages', 'nested', 'hidden.mjs'), 'nested')
      await writeFile(join(root, 'dist', 'generated.mjs'), 'generated')

      await expect(loadDomainSources({ domain: domain(root), extensions: ['.mjs', '.ts'] })).resolves.toEqual({
        ok: true,
        sources: [
          { path: 'src/a.ts', content: 'a' },
          { path: 'src/z.mjs', content: 'z' }
        ]
      })
    })
  })

  test('does not follow a symlink outside the domain', async () => {
    await withTmpDir(async parent => {
      const root = join(parent, 'domain')
      const outside = join(parent, 'outside')
      await mkdir(root)
      await mkdir(outside)
      await writeFile(join(outside, 'secret.mjs'), 'secret')
      await symlink(outside, join(root, 'linked'))

      await expect(loadDomainSources({ domain: domain(root), extensions: ['.mjs'] })).resolves.toEqual({
        ok: true,
        sources: []
      })
    })
  })

  test('rejects invalid roots and extension contracts', async () => {
    await expect(loadDomainSources({ domain: domain('relative'), extensions: ['.mjs'] })).resolves.toMatchObject({
      ok: false,
      diagnostics: [{ code: 'invalid-domain-root' }]
    })
    await withTmpDir(async root => {
      await expect(loadDomainSources({ domain: domain(root), extensions: ['mjs'] })).resolves.toMatchObject({
        ok: false,
        diagnostics: [{ code: 'invalid-source-extensions' }]
      })
    })
  })
})

describe('discoverDomainCodeExtensions', () => {
  test('returns sorted extensions across supported language ecosystems', async () => {
    await withTmpDir(async root => {
      await mkdir(join(root, 'src'), { recursive: true })
      await Promise.all([
        writeFile(join(root, 'src', 'server.js'), ''),
        writeFile(join(root, 'src', 'legacy.cjs'), ''),
        writeFile(join(root, 'src', 'module.mjs'), ''),
        writeFile(join(root, 'src', 'component.jsx'), ''),
        writeFile(join(root, 'src', 'component.tsx'), ''),
        writeFile(join(root, 'src', 'types.ts'), ''),
        writeFile(join(root, 'src', 'view.vue'), ''),
        writeFile(join(root, 'src', 'worker.rs'), ''),
        writeFile(join(root, 'src', 'worker.py'), ''),
        writeFile(join(root, 'src', 'endpoint.php'), '')
      ])

      await expect(discoverDomainCodeExtensions({ domain: domain(root) })).resolves.toEqual({
        ok: true,
        extensions: ['.cjs', '.js', '.jsx', '.mjs', '.php', '.py', '.rs', '.ts', '.tsx', '.vue']
      })
    })
  })

  test('excludes nested domains and returns an empty inventory when no code exists', async () => {
    await withTmpDir(async root => {
      await mkdir(join(root, 'packages', 'nested'), { recursive: true })
      await writeFile(join(root, 'packages', 'nested', 'hidden.py'), '')

      await expect(discoverDomainCodeExtensions({ domain: domain(root) })).resolves.toEqual({ ok: true, extensions: [] })
    })
  })

  test('does not inventory a symlinked code tree outside the domain', async () => {
    await withTmpDir(async parent => {
      const root = join(parent, 'domain')
      const outside = join(parent, 'outside')
      await mkdir(root)
      await mkdir(outside)
      await writeFile(join(outside, 'secret.ts'), '')
      await symlink(outside, join(root, 'linked'))

      await expect(discoverDomainCodeExtensions({ domain: domain(root) })).resolves.toEqual({ ok: true, extensions: [] })
    })
  })
})

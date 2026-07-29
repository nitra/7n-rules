import { mkdir, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

import { withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'
import { loadDomainSources } from '../source-loader.mjs'

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

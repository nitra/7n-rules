/** Tests for deterministic package-owned structured config and contract ingestion. */
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import { withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'
import { loadStructuredSources, mergeStructuredFragments } from '../structured-sources.mjs'

/** Returns a resolved root-domain fixture with one explicitly excluded nested package. */
function domain(root) {
  return {
    id: 'npm:@fixture/orders',
    ecosystem: 'npm',
    name: '@fixture/orders',
    root,
    rootManifest: 'package.json',
    sourceRoot: '.',
    excludedSourceRoots: ['packages/nested']
  }
}

/** Writes the smallest package manifest accepted as a package-owned config source. */
async function packageManifest(root) {
  await writeFile(join(root, 'package.json'), '{"name":"@fixture/orders","version":"1.0.0"}\n', 'utf8')
}

describe('structured package knowledge sources', () => {
  test('ingests manifest, config and OpenAPI contract with exact content evidence', async () => {
    await withTmpDir(async root => {
      await mkdir(join(root, 'config'), { recursive: true })
      await mkdir(join(root, 'contracts'), { recursive: true })
      await packageManifest(root)
      await writeFile(join(root, 'config', 'service.json'), '{"enabled":true}\n', 'utf8')
      const openapi = 'openapi: 3.1.0\ninfo:\n  title: Payments API\n  version: 1.0.0\npaths: {}\n'
      await writeFile(join(root, 'contracts', 'openapi.yaml'), openapi, 'utf8')

      const result = await loadStructuredSources({ domain: domain(root) })

      expect(result).toMatchObject({ ok: true })
      expect(result.fragments.map(fragment => fragment.file.path)).toEqual([
        'config/service.json',
        'contracts/openapi.yaml',
        'package.json'
      ])
      const contract = result.fragments.find(fragment => fragment.file.path === 'contracts/openapi.yaml')
      expect(contract.nodes).toContainEqual(
        expect.objectContaining({ kind: 'config', visibility: 'public', attributes: expect.objectContaining({ artifact: 'schema' }) })
      )
      expect(contract.nodes).toContainEqual(
        expect.objectContaining({ kind: 'integration', name: 'Payments API', visibility: 'external' })
      )
      expect(contract.evidence).toEqual([
        expect.objectContaining({
          kind: 'schema',
          path: 'contracts/openapi.yaml',
          contentHash: `sha256:${createHash('sha256').update(openapi).digest('hex')}`
        })
      ])
      const merged = mergeStructuredFragments({
        domain: domain(root),
        graph: { nodes: [], edges: [], evidence: [] },
        fragments: result.fragments
      })
      expect(merged).toMatchObject({ ok: true })
      expect(merged.graph.edges).toContainEqual(expect.objectContaining({ kind: 'implements' }))
    })
  })

  test('fails closed for a malformed recognized contract', async () => {
    await withTmpDir(async root => {
      await mkdir(join(root, 'contracts'), { recursive: true })
      await packageManifest(root)
      await writeFile(join(root, 'contracts', 'openapi.yaml'), 'openapi: [\n', 'utf8')

      await expect(loadStructuredSources({ domain: domain(root) })).resolves.toEqual({
        ok: false,
        diagnostics: [expect.objectContaining({ code: 'structured-parse-failed', path: 'contracts/openapi.yaml' })]
      })
    })
  })

  test('does not read contracts or manifests from an excluded nested domain', async () => {
    await withTmpDir(async root => {
      await mkdir(join(root, 'packages', 'nested'), { recursive: true })
      await packageManifest(root)
      await writeFile(join(root, 'packages', 'nested', 'package.json'), '{"name":"@fixture/nested"}\n', 'utf8')
      await writeFile(
        join(root, 'packages', 'nested', 'openapi.yaml'),
        'openapi: 3.1.0\ninfo:\n  title: Nested API\n  version: 1.0.0\npaths: {}\n',
        'utf8'
      )

      const result = await loadStructuredSources({ domain: domain(root) })

      expect(result).toMatchObject({ ok: true })
      expect(result.fragments.map(fragment => fragment.file.path)).toEqual(['package.json'])
    })
  })
})

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
      await writeFile(join(root, 'config', 'service.json'), '{"enabled":true,"apiToken":"not-for-manifest"}\n', 'utf8')
      const openapi = [
        'openapi: 3.1.0',
        'info:',
        '  title: Payments API',
        '  version: 1.0.0',
        'paths:',
        '  /payments:',
        '    post:',
        '      responses:',
        "        '200':",
        '          description: accepted'
      ].join('\n')
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
        expect.objectContaining({
          kind: 'config',
          visibility: 'public',
          attributes: expect.objectContaining({ artifact: 'schema' })
        })
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
      expect(result.evidenceContentById[contract.evidence[0].id]).toBe(openapi)
      const merged = mergeStructuredFragments({
        domain: domain(root),
        graph: { nodes: [], edges: [], evidence: [] },
        fragments: result.fragments
      })
      expect(merged).toMatchObject({ ok: true })
      expect(merged.graph.edges).toContainEqual(expect.objectContaining({ kind: 'implements' }))
      expect(merged.graph.claims).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ predicate: 'declares-artifact', value: { artifact: 'config', format: 'json' } }),
          expect.objectContaining({
            predicate: 'declares-openapi-operation',
            value: { path: '/payments', method: 'post' }
          })
        ])
      )
      expect(JSON.stringify(merged.graph.claims)).not.toContain('not-for-manifest')
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

  test('rejects a schema node kind that graph schema v1 does not allow', () => {
    const result = mergeStructuredFragments({
      domain: { id: 'npm:@fixture/orders' },
      graph: { nodes: [], edges: [], evidence: [] },
      fragments: [
        {
          ok: true,
          file: { path: 'schema.json', contentHash: 'sha256:schema' },
          nodes: [{ id: 'schema:forbidden', kind: 'schema', visibility: 'public', domainId: 'npm:@fixture/orders' }],
          edges: [],
          evidence: []
        }
      ]
    })

    expect(result).toEqual({ ok: false, diagnostics: [expect.objectContaining({ code: 'invalid-structured-node' })] })
  })

  test('projects only deterministic OpenAPI, AsyncAPI, GraphQL and JSON Schema surface claims', async () => {
    await withTmpDir(async root => {
      await mkdir(join(root, 'contracts'), { recursive: true })
      await packageManifest(root)
      await writeFile(
        join(root, 'contracts', 'openapi.yaml'),
        'openapi: 3.1.0\ninfo:\n  title: Orders API\n  version: 1.0.0\npaths:\n  /orders:\n    get: {}\n    post: {}\n',
        'utf8'
      )
      await writeFile(
        join(root, 'contracts', 'asyncapi.yaml'),
        'asyncapi: 3.0.0\ninfo:\n  title: Orders events\n  version: 1.0.0\nchannels:\n  orders.created: {}\n  orders.cancelled: {}\n',
        'utf8'
      )
      await writeFile(
        join(root, 'contracts', 'schema.graphql'),
        'type Order { id: ID! }\nquery GetOrder { order { id } }\n',
        'utf8'
      )
      await writeFile(
        join(root, 'contracts', 'orders.schema.json'),
        '{"$schema":"https://json-schema.org/draft/2020-12/schema","title":"Order","type":["null","object"]}\n',
        'utf8'
      )

      const first = await loadStructuredSources({ domain: domain(root) })
      const second = await loadStructuredSources({ domain: domain(root) })
      const claims = first.fragments.flatMap(fragment => fragment.claims)

      expect(first.fragments.map(fragment => fragment.file.path)).toEqual(
        second.fragments.map(fragment => fragment.file.path)
      )
      for (const fragment of first.fragments) {
        const claimIds = fragment.claims.map(claim => claim.id)
        expect(claimIds).toEqual(claimIds.toSorted())
      }
      expect(claims).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            predicate: 'declares-openapi-operation',
            value: { path: '/orders', method: 'get' }
          }),
          expect.objectContaining({
            predicate: 'declares-openapi-operation',
            value: { path: '/orders', method: 'post' }
          }),
          expect.objectContaining({ predicate: 'declares-asyncapi-channel', value: { channel: 'orders.created' } }),
          expect.objectContaining({
            predicate: 'declares-graphql-definition',
            value: { definition: 'ObjectTypeDefinition', name: 'Order' }
          }),
          expect.objectContaining({
            predicate: 'declares-graphql-definition',
            value: { definition: 'operation', operation: 'query', name: 'GetOrder' }
          }),
          expect.objectContaining({
            predicate: 'declares-json-schema',
            value: { title: 'Order', type: ['null', 'object'] }
          })
        ])
      )
      expect(JSON.stringify(claims)).not.toContain('description: accepted')

      const fragment = first.fragments.find(item => item.claims.length > 0)
      const duplicate = mergeStructuredFragments({
        domain: domain(root),
        graph: { nodes: [], edges: [], claims: [], evidence: [] },
        fragments: [{ ...fragment, claims: [...fragment.claims, fragment.claims[0]] }]
      })
      expect(duplicate).toEqual({
        ok: false,
        diagnostics: [expect.objectContaining({ code: 'duplicate-structured-claim' })]
      })
    })
  })

  test('rejects a non-deterministic structured claim and duplicate claim identity', () => {
    const fragment = {
      ok: true,
      file: { path: 'config/service.json', contentHash: 'sha256:config' },
      nodes: [
        {
          id: 'config:npm:@fixture/orders:service',
          kind: 'config',
          name: 'config/service.json',
          visibility: 'package',
          domainId: 'npm:@fixture/orders',
          attributes: { sourcePath: 'config/service.json' },
          sourceFingerprint: 'sha256:config'
        }
      ],
      edges: [],
      evidence: [{ id: 'evidence:config', kind: 'config', path: 'config/service.json', contentHash: 'sha256:config' }],
      claims: [
        {
          id: 'claim:not-deterministic',
          subjectId: 'config:npm:@fixture/orders:service',
          layer: 'implemented',
          predicate: 'declares-artifact',
          value: { artifact: 'config', format: 'json', secret: 'leak' },
          evidenceIds: ['evidence:config'],
          confidence: 1,
          sourceFingerprint: 'sha256:config'
        }
      ]
    }
    const result = mergeStructuredFragments({
      domain: { id: 'npm:@fixture/orders' },
      graph: { nodes: [], edges: [], claims: [], evidence: [] },
      fragments: [fragment]
    })

    expect(result).toEqual({ ok: false, diagnostics: [expect.objectContaining({ code: 'invalid-structured-claim' })] })
  })
})

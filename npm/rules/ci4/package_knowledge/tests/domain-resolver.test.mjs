/** Tests for deterministic package knowledge domain discovery and schema. */
import { cp, readdir, readFile, rename } from 'node:fs/promises'
import { join } from 'node:path'

import Ajv2020 from 'ajv/dist/2020.js'
import { describe, expect, test } from 'vitest'

import { canonicalDomainName, resolveDocumentationDomains, resolveDomainForPath } from '../domain-resolver.mjs'
import { withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'

const FIXTURES = join(import.meta.dirname, 'fixtures', 'domains')

/** Materializes neutral fixture manifests under a temporary repository root. */
async function materializeFixture(name, dir) {
  await cp(join(FIXTURES, name), dir, { recursive: true })
  const entries = await readdir(dir, { recursive: true, withFileTypes: true })
  const manifests = entries.filter(entry => entry.isFile() && entry.name.endsWith('.fixture'))
  for (const manifest of manifests) {
    const source = join(manifest.parentPath, manifest.name)
    await rename(source, join(manifest.parentPath, manifest.name.slice(0, -'.fixture'.length)))
  }
}

/** Runs an assertion against an isolated materialized fixture repository. */
async function withDomainFixture(name, callback) {
  await withTmpDir(async dir => {
    await materializeFixture(name, dir)
    await callback(dir)
  })
}

describe('package knowledge domain resolver', () => {
  test('discovers every supported manifest with path-independent canonical identity', async () => {
    await withDomainFixture('monorepo', async root => {
      const { domains, diagnostics } = await resolveDocumentationDomains(root)

      expect(diagnostics).toEqual([])
      expect(domains).toEqual([
        expect.objectContaining({ id: 'cargo:fixture-engine', ecosystem: 'cargo', name: 'fixture-engine', rootManifest: 'packages/engine/Cargo.toml' }),
        expect.objectContaining({ id: 'composer:fixture/library', ecosystem: 'composer', name: 'fixture/library', rootManifest: 'tools/library/composer.json' }),
        expect.objectContaining({ id: 'npm:@fixture/root', ecosystem: 'npm', name: '@fixture/root', rootManifest: 'package.json' }),
        expect.objectContaining({ id: 'npm:@fixture/web', ecosystem: 'npm', name: '@fixture/web', rootManifest: 'packages/web/package.json' }),
        expect.objectContaining({ id: 'python:orders-api', ecosystem: 'python', name: 'orders-api', rootManifest: 'services/orders/pyproject.toml' })
      ])
    })
  })

  test('excludes nested roots from the parent and resolves the deepest domain', async () => {
    await withDomainFixture('monorepo', async root => {
      const { domains } = await resolveDocumentationDomains(root)
      const parent = domains.find(domain => domain.id === 'npm:@fixture/root')

      expect(parent?.sourceRoots).toEqual(['.'])
      expect(parent?.excludedSourceRoots).toEqual(['packages/engine', 'packages/web', 'services/orders', 'tools/library'])
      expect(resolveDomainForPath(domains, 'packages/web/src/app.mjs', root)?.id).toBe('npm:@fixture/web')
      expect(resolveDomainForPath(domains, 'src/index.mjs', root)?.id).toBe('npm:@fixture/root')
      expect(resolveDomainForPath(domains, join(root, '..', 'outside.mjs'), root)).toBeNull()
    })
  })

  test('emits stable blocking diagnostics instead of path-based fallback identities', async () => {
    await withDomainFixture('diagnostics', async root => {
      const { domains, diagnostics } = await resolveDocumentationDomains(root)

      expect(domains.map(domain => domain.id)).toEqual(['python:orders-api', 'python:orders-api'])
      expect(diagnostics).toEqual([
        expect.objectContaining({ code: 'duplicate-domain-id', domainId: 'python:orders-api', manifests: ['python-one/pyproject.toml', 'python-two/pyproject.toml'] }),
        expect.objectContaining({ code: 'manifest-name-missing', manifest: 'missing/Cargo.toml' }),
        expect.objectContaining({ code: 'manifest-parse-failed', manifest: 'bad/package.json' })
      ])
    })
  })

  test('canonicalizes only ecosystem-defined name variants', () => {
    expect(canonicalDomainName('python', 'Orders_API')).toBe('orders-api')
    expect(canonicalDomainName('composer', 'Fixture/Library')).toBe('fixture/library')
    expect(canonicalDomainName('npm', '@fixture/pkg')).toBe('@fixture/pkg')
    expect(canonicalDomainName('cargo', '')).toBeNull()
  })
})

describe('knowledge graph v1 schema', () => {
  test('accepts an evidence-backed minimal graph and rejects evidence-free edges', async () => {
    const schemaPath = join(import.meta.dirname, '..', 'schema', 'knowledge-graph-v1.schema.json')
    const schema = JSON.parse(await readFile(schemaPath, 'utf8'))
    const validate = new Ajv2020({ strict: false }).compile(schema)
    const graph = {
      schemaVersion: 1,
      domain: { id: 'npm:@fixture/root', ecosystem: 'npm', name: '@fixture/root', rootManifest: 'package.json', sourceFingerprint: 'sha256:root' },
      nodes: [{ id: 'node:entry', kind: 'capability', name: 'Root capability', visibility: 'public', domainId: 'npm:@fixture/root', attributes: {}, sourceFingerprint: 'sha256:node' }],
      edges: [{ id: 'edge:contains', fromId: 'node:entry', toId: 'node:entry', kind: 'contains', evidenceIds: ['evidence:code'] }],
      claims: [{ id: 'claim:implemented', subjectId: 'node:entry', layer: 'implemented', predicate: 'does', value: 'work', evidenceIds: ['evidence:code'], confidence: 1, sourceFingerprint: 'sha256:claim' }],
      topics: [{ id: 'topic:root', kind: 'capability', title: 'Root capability', domainId: 'npm:@fixture/root', anchorIds: ['node:entry'] }],
      gaps: [],
      evidence: [{ id: 'evidence:code', kind: 'code', path: 'src/index.mjs', contentHash: 'sha256:evidence' }]
    }

    expect(validate(graph)).toBe(true)
    graph.edges[0].evidenceIds = []
    expect(validate(graph)).toBe(false)
  })
})

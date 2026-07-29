/** Tests end-to-end SHADOW/publish generation with fully injected parser and LLM transport. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'

import { withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'
import { buildPackageKnowledge } from '../runner.mjs'
import { compareClaimMappings } from '../gap-mappings.mjs'

const DOMAIN_ID = 'npm:@fixture/orders'

/** Створює one-file domain fixture, який resolver повертає без filesystem scan. */
function domain(root) {
  return {
    id: DOMAIN_ID,
    ecosystem: 'npm',
    name: '@fixture/orders',
    root,
    rootManifest: 'package.json',
    sourceRoot: '.',
    sourceRoots: ['.'],
    excludedSourceRoots: []
  }
}

/** Повертає complete JS extractor або parser failure для atomicity test. */
function extractor({ fails = false, evidenceSpan, extensions = ['.mjs'] } = {}) {
  return {
    id: 'fixture-js',
    apiVersion: 1,
    extensions,
    parser: { id: 'fixture', grammarVersion: '1', runtimeVersion: '1' },
    collectTestScenarios: vi.fn(() => ({ ok: true, scenarios: [] })),
    analyzeFile: vi.fn(({ file }) => {
      if (fails) throw new Error('fixture parser failed')
      return {
        ok: true,
        file: { path: file.path, language: 'js', contentHash: file.contentHash },
        units: [
          {
            localId: 'submit',
            qualifiedPath: `${file.path}#submit`,
            kind: 'function',
            name: 'submit',
            visibility: 'public',
            span: { startByte: 0, endByte: Buffer.byteLength(file.content) }
          }
        ],
        edges: [
          {
            kind: 'invokes',
            fromLocalId: 'submit',
            to: { unresolvedSpecifier: 'fixture-transport', opaque: true },
            evidence: [{ span: evidenceSpan ?? { startByte: 0, endByte: Buffer.byteLength(file.content) }, role: 'syntax' }]
          }
        ],
        coverage: { requiredUnits: 1, coveredUnits: 1, requiredEdges: 1, coveredEdges: 1, complete: true }
      }
    })
  }
}

/** Відповідає strict claims contract на всі map/reduce items без реального LLM. */
function successfulBatch() {
  return vi.fn((tier, items) =>
    Promise.resolve(
      items.map(item => {
        const nodes = JSON.parse(item.prompt.match(/Required node IDs: (\[[^\n]+\])\./u)[1])
        const edges = JSON.parse(item.prompt.match(/Required edge IDs: (\[[^\n]+\])\./u)[1])
        const evidence = JSON.parse(item.prompt.match(/Allowed evidence IDs: (\[[^\n]+\])\./u)[1])
        return {
          customId: item.customId,
          ok: JSON.stringify({
            claims: nodes.map(subjectId => ({
              subjectId,
              predicate: 'outcome',
              value: true,
              evidenceIds: [evidence[0]],
              confidence: 1
            })),
            coveredNodeIds: nodes,
            coveredEdgeIds: edges
          })
        }
      })
    )
  )
}

/** Повертає transport, який розрізняє claims і semantic gap-comparison prompts. */
function comparisonBatch() {
  return vi.fn((tier, items) =>
    Promise.resolve(
      items.map(item => {
        if (item.prompt.includes('implementedCandidates')) {
          const candidates = JSON.parse(item.prompt.split('\n').at(-1)).implementedCandidates
          return {
            customId: item.customId,
            ok: JSON.stringify({
              expectedClaimId: item.customId,
              comparisons: [{ implementedClaimId: candidates[0].id, relation: 'contradicts' }],
              unresolved: false
            })
          }
        }
        const nodes = JSON.parse(item.prompt.match(/Required node IDs: (\[[^\n]+\])\./u)[1])
        const edges = JSON.parse(item.prompt.match(/Required edge IDs: (\[[^\n]+\])\./u)[1])
        const evidence = JSON.parse(item.prompt.match(/Allowed evidence IDs: (\[[^\n]+\])\./u)[1])
        return {
          customId: item.customId,
          ok: JSON.stringify({
            claims: nodes.map(subjectId => ({ subjectId, predicate: 'outcome', value: true, evidenceIds: [evidence[0]], confidence: 1 })),
            coveredNodeIds: nodes,
            coveredEdgeIds: edges
          })
        }
      })
    )
  )
}

/** Створює інʼєкції real core pipeline поверх контрольованих domain/adapters/sources. */
function inputs(root, adapter, extra = {}) {
  return {
    repoRoot: root,
    domainId: DOMAIN_ID,
    resolveDomainsImpl: vi.fn(async () => ({ domains: [domain(root)], diagnostics: [] })),
    discoverDomainCodeExtensionsImpl: vi.fn(async () => ({ ok: true, extensions: ['.mjs'] })),
    loadAdaptersImpl: vi.fn(async () => ({ blocked: false, diagnostics: [], adapters: { domain: [], extractor: [adapter] } })),
    loadSourcesImpl: vi.fn(async () => ({ ok: true, sources: [{ path: 'src/orders.mjs', content: 'export function submit() {}' }] })),
    loadStructuredSourcesImpl: vi.fn(async () => ({ ok: true, fragments: [] })),
    verifyEntailmentImpl: vi.fn(async ({ graph }) => ({ ok: true, claims: graph.claims, cache: { version: 1, entries: {} } })),
    ...extra
  }
}

/** Створює explicit Expected source fixture з local evidence content. */
function expectedSource() {
  return {
    id: 'source:expected',
    content: 'Orders must be accepted.',
    evidence: { id: 'evidence:expected', kind: 'spec', path: 'docs/specs/orders.md', contentHash: 'sha256:expected' }
  }
}

/** Повертає mapped Expected overlay для current implemented graph. */
function mappedExpected(graph) {
  return {
    ok: true,
    overlay: {
      evidence: [{ id: 'evidence:expected', kind: 'spec', path: 'docs/specs/orders.md', contentHash: 'sha256:expected' }],
      claims: [{ id: 'claim:expected', subjectId: graph.nodes[0].id, predicate: 'outcome', value: true, evidenceIds: ['evidence:expected'], confidence: 1, sourceFingerprint: 'sha256:expected' }]
    }
  }
}

/** Returns one schema-evidenced external contract fragment for runner injection. */
function structuredContract() {
  const configId = `config:${DOMAIN_ID}:openapi`
  const contractId = `contract:${DOMAIN_ID}:orders-api`
  const evidenceId = 'evidence:orders-openapi'
  return {
    ok: true,
    evidenceContentById: { 'evidence:orders-openapi': 'openapi: 3.1.0\n' },
    fragments: [
      {
        ok: true,
        file: { path: 'contracts/openapi.yaml', contentHash: 'sha256:openapi' },
        nodes: [
          {
            id: configId,
            kind: 'config',
            name: 'Orders API schema',
            visibility: 'public',
            domainId: DOMAIN_ID,
            attributes: { sourcePath: 'contracts/openapi.yaml', artifact: 'schema' },
            sourceFingerprint: 'sha256:openapi'
          },
          {
            id: contractId,
            kind: 'integration',
            name: 'Orders API',
            visibility: 'external',
            domainId: DOMAIN_ID,
            attributes: { sourcePath: 'contracts/openapi.yaml', boundary: 'contract' },
            sourceFingerprint: 'sha256:openapi'
          }
        ],
        edges: [
          { id: 'edge:orders-openapi', kind: 'implements', fromId: configId, toId: contractId, evidenceIds: [evidenceId] }
        ],
        evidence: [
          {
            id: evidenceId,
            kind: 'schema',
            path: 'contracts/openapi.yaml',
            symbolId: configId,
            contentHash: 'sha256:openapi'
          }
        ]
      }
    ]
  }
}

describe('buildPackageKnowledge', () => {
  test('passes the discovered inventory to adapter and source loaders before candidate work', async () => {
    await withTmpDir(async root => {
      const inventory = vi.fn(async () => ({ ok: true, extensions: ['.py', '.ts'] }))
      const adapters = vi.fn(async () => ({ blocked: false, diagnostics: [], adapters: { domain: [], extractor: [extractor({ extensions: ['.py', '.ts'] })] } }))
      const sources = vi.fn(async () => ({
        ok: true,
        sources: [
          { path: 'src/orders.py', content: 'def submit(): pass\n' },
          { path: 'src/orders.ts', content: 'export function submit() {}' }
        ]
      }))
      const result = await buildPackageKnowledge(
        inputs(root, extractor(), {
          discoverDomainCodeExtensionsImpl: inventory,
          loadAdaptersImpl: adapters,
          loadSourcesImpl: sources,
          submitBatchImpl: successfulBatch()
        })
      )

      expect(result).toMatchObject({ ok: true, mode: 'shadow' })
      expect(inventory).toHaveBeenCalledWith({ domain: expect.objectContaining({ id: DOMAIN_ID }) })
      expect(adapters).toHaveBeenCalledWith(expect.objectContaining({ requiredExtensions: ['.py', '.ts'] }))
      expect(sources).toHaveBeenCalledWith({ domain: expect.objectContaining({ id: DOMAIN_ID }), extensions: ['.py', '.ts'] })
    })
  })

  test('blocks inventory diagnostics before adapters, source loading and LLM work', async () => {
    await withTmpDir(async root => {
      const adapters = vi.fn()
      const sources = vi.fn()
      const batch = successfulBatch()
      const result = await buildPackageKnowledge(
        inputs(root, extractor(), {
          discoverDomainCodeExtensionsImpl: vi.fn(async () => ({ ok: false, diagnostics: [{ code: 'source-read-failed' }] })),
          loadAdaptersImpl: adapters,
          loadSourcesImpl: sources,
          submitBatchImpl: batch
        })
      )

      expect(result).toMatchObject({ ok: false, stage: 'source-inventory', diagnostics: [{ code: 'source-read-failed' }] })
      expect(adapters).not.toHaveBeenCalled()
      expect(sources).not.toHaveBeenCalled()
      expect(batch).not.toHaveBeenCalled()
    })
  })

  test('blocks a discovered extension when its adapter plugin is missing', async () => {
    await withTmpDir(async root => {
      const sources = vi.fn()
      const result = await buildPackageKnowledge(
        inputs(root, extractor(), {
          discoverDomainCodeExtensionsImpl: vi.fn(async () => ({ ok: true, extensions: ['.rs'] })),
          loadAdaptersImpl: vi.fn(async () => ({
            blocked: true,
            diagnostics: [{ code: 'missing-extractor-extension', extension: '.rs' }],
            adapters: null
          })),
          loadSourcesImpl: sources
        })
      )

      expect(result).toMatchObject({ ok: false, stage: 'adapters', diagnostics: [{ code: 'missing-extractor-extension' }] })
      expect(sources).not.toHaveBeenCalled()
    })
  })

  test('builds a contract-only package without extractors, source loader or LLM claims', async () => {
    await withTmpDir(async root => {
      const sources = vi.fn()
      const batch = successfulBatch()
      const result = await buildPackageKnowledge(
        inputs(root, extractor(), {
          discoverDomainCodeExtensionsImpl: vi.fn(async () => ({ ok: true, extensions: [] })),
          loadAdaptersImpl: vi.fn(async () => ({ blocked: false, diagnostics: [], adapters: { domain: [], extractor: [] } })),
          loadSourcesImpl: sources,
          loadStructuredSourcesImpl: vi.fn(async () => structuredContract()),
          submitBatchImpl: batch
        })
      )

      expect(result).toMatchObject({ ok: true, mode: 'shadow' })
      expect(sources).not.toHaveBeenCalled()
      expect(batch).not.toHaveBeenCalled()
      expect(await readFile(join(result.stagingPath, 'docs', '.docgen', 'manifest.json'), 'utf8')).toContain('Orders API')
    })
  })

  test('SHADOW validates and stages candidate, then unchanged cache performs zero LLM calls', async () => {
    await withTmpDir(async root => {
      const cache = { entries: {} }
      const firstBatch = successfulBatch()
      const first = await buildPackageKnowledge(inputs(root, extractor(), { cache, submitBatchImpl: firstBatch }))
      const secondBatch = successfulBatch()
      const second = await buildPackageKnowledge(inputs(root, extractor(), { cache, submitBatchImpl: secondBatch }))

      expect(first).toMatchObject({ ok: true, mode: 'shadow', domainId: DOMAIN_ID })
      expect(firstBatch).toHaveBeenCalledTimes(1)
      expect(second).toMatchObject({ ok: true, mode: 'shadow', domainId: DOMAIN_ID })
      expect(secondBatch).not.toHaveBeenCalled()
      expect(await readFile(join(first.stagingPath, 'docs', '.docgen', 'manifest.json'), 'utf8')).toContain(DOMAIN_ID)
      await expect(readFile(join(root, 'docs', 'index.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    })
  })

  test('parser failure is fail-closed and does not replace existing docs', async () => {
    await withTmpDir(async root => {
      await mkdir(join(root, 'docs'), { recursive: true })
      await writeFile(join(root, 'docs', 'index.md'), 'legacy document\n', 'utf8')
      const batch = successfulBatch()
      const result = await buildPackageKnowledge(inputs(root, extractor({ fails: true }), { submitBatchImpl: batch }))

      expect(result).toMatchObject({ ok: false, stage: 'candidate', diagnostics: [{ code: 'extractor-threw' }] })
      expect(batch).not.toHaveBeenCalled()
      expect(await readFile(join(root, 'docs', 'index.md'), 'utf8')).toBe('legacy document\n')
    })
  })

  test('passes structured fragments into the candidate and rendered manifest', async () => {
    await withTmpDir(async root => {
      const loader = vi.fn(async () => structuredContract())
      const result = await buildPackageKnowledge(
        inputs(root, extractor(), { loadStructuredSourcesImpl: loader, submitBatchImpl: successfulBatch() })
      )

      expect(result).toMatchObject({ ok: true, mode: 'shadow' })
      expect(loader).toHaveBeenCalledWith({ domain: expect.objectContaining({ id: DOMAIN_ID }) })
      const manifest = await readFile(join(result.stagingPath, 'docs', '.docgen', 'manifest.json'), 'utf8')
      expect(manifest).toContain('Orders API')
      expect(manifest).toContain('contracts/openapi.yaml')
    })
  })

  test('blocks malformed structured sources before candidate work and preserves committed docs', async () => {
    await withTmpDir(async root => {
      await mkdir(join(root, 'docs'), { recursive: true })
      await writeFile(join(root, 'docs', 'index.md'), 'legacy document\n', 'utf8')
      const batch = successfulBatch()
      const result = await buildPackageKnowledge(
        inputs(root, extractor(), {
          loadStructuredSourcesImpl: vi.fn(async () => ({ ok: false, diagnostics: [{ code: 'structured-parse-failed' }] })),
          submitBatchImpl: batch
        })
      )

      expect(result).toMatchObject({ ok: false, stage: 'structured-sources', diagnostics: [{ code: 'structured-parse-failed' }] })
      expect(batch).not.toHaveBeenCalled()
      await expect(readFile(join(root, 'docs', 'index.md'), 'utf8')).resolves.toBe('legacy document\n')
    })
  })

  test('explicit publish atomically adds generated views and preserves unrelated legacy docs', async () => {
    await withTmpDir(async root => {
      await mkdir(join(root, 'docs'), { recursive: true })
      await writeFile(join(root, 'docs', 'legacy.md'), 'keep legacy file documentation\n', 'utf8')
      const result = await buildPackageKnowledge(inputs(root, extractor(), { publish: true, submitBatchImpl: successfulBatch() }))

      expect(result).toMatchObject({ ok: true, mode: 'published', domainId: DOMAIN_ID })
      expect(await readFile(join(root, 'docs', 'legacy.md'), 'utf8')).toBe('keep legacy file documentation\n')
      expect(await readFile(join(root, 'docs', 'index.md'), 'utf8')).toContain('Package knowledge')
      expect(await readFile(join(root, 'docs', '.docgen', 'manifest.json'), 'utf8')).toContain(DOMAIN_ID)
    })
  })

  test('makes an exact automatic Expected match satisfied with zero comparison LLM calls', async () => {
    await withTmpDir(async root => {
      const discovered = vi.fn(() => Promise.resolve({ ok: true, sources: [expectedSource()] }))
      const mapped = vi.fn(({ graph }) => Promise.resolve(mappedExpected(graph)))
      const batch = successfulBatch()
      let comparisonResult
      const comparator = vi.fn(async input => {
        comparisonResult = await compareClaimMappings(input)
        return comparisonResult
      })
      const cache = { entries: {} }
      const gapCache = { entries: {} }
      const result = await buildPackageKnowledge(
        inputs(root, extractor(), {
          submitBatchImpl: batch,
          cache,
          gapCache,
          discoverExpectedSourcesImpl: discovered,
          mapExpectedSourcesImpl: mapped,
          compareGapMappingsImpl: comparator
        })
      )

      expect(result).toMatchObject({ ok: true, mode: 'shadow' })
      expect(discovered).toHaveBeenCalledWith(
        expect.objectContaining({ repoRoot: root, domain: expect.objectContaining({ id: DOMAIN_ID }) })
      )
      expect(mapped.mock.calls[0][0].graph.claims).toHaveLength(1)
      expect(comparator).toHaveBeenCalledTimes(1)
      expect(comparisonResult.mappings[0]).toMatchObject({ relation: 'equivalent' })
      expect(batch).toHaveBeenCalledTimes(1)
      const manifest = JSON.parse(await readFile(join(result.stagingPath, 'docs', '.docgen', 'manifest.json'), 'utf8'))
      expect(manifest.gaps).toEqual([expect.objectContaining({ expectedClaimId: 'claim:expected', status: 'satisfied' })])
    })
  })

  test('renders semantic comparator contradiction as diverged', async () => {
    await withTmpDir(async root => {
      const comparator = vi.fn(async ({ graph }) => {
        const implemented = graph.claims.find(claim => claim.layer === 'implemented')
        const expected = graph.claims.find(claim => claim.layer === 'expected')
        return {
          ok: true,
          mappings: [{ expectedClaimId: expected.id, implementedClaimId: implemented.id, relation: 'contradicts', evidenceIds: [...expected.evidenceIds, ...implemented.evidenceIds].toSorted() }],
          unresolvedExpectedClaimIds: [],
          cache: { version: 1, entries: {} }
        }
      })
      const result = await buildPackageKnowledge(
        inputs(root, extractor(), {
          submitBatchImpl: successfulBatch(),
          expectedOverlay: { claims: [{ id: 'claim:expected:diverged', subjectId: 'code-unit:npm:@fixture/orders:js:src/orders.mjs#submit', predicate: 'outcome', value: false, evidenceIds: ['evidence:expected'], confidence: 1, sourceFingerprint: 'sha256:expected' }], evidence: [{ id: 'evidence:expected', kind: 'spec', path: 'docs/spec.md', contentHash: 'sha256:expected' }] },
          compareGapMappingsImpl: comparator
        })
      )

      expect(result).toMatchObject({ ok: true, mode: 'shadow' })
      expect(await readFile(join(result.stagingPath, 'docs', 'implementation-gaps.md'), 'utf8')).toContain('Status: diverged')
    })
  })

  test('renders explicit ambiguous comparison as unresolved', async () => {
    await withTmpDir(async root => {
      const expected = { id: 'claim:expected:ambiguous', subjectId: 'code-unit:npm:@fixture/orders:js:src/orders.mjs#submit', predicate: 'outcome', value: false, evidenceIds: ['evidence:expected'], confidence: 1, sourceFingerprint: 'sha256:expected' }
      const result = await buildPackageKnowledge(
        inputs(root, extractor(), {
          submitBatchImpl: successfulBatch(),
          expectedOverlay: { claims: [expected], evidence: [{ id: 'evidence:expected', kind: 'spec', path: 'docs/spec.md', contentHash: 'sha256:expected' }] },
          compareGapMappingsImpl: vi.fn(async () => ({ ok: true, mappings: [], unresolvedExpectedClaimIds: [expected.id], cache: { version: 1, entries: {} } }))
        })
      )

      expect(result).toMatchObject({ ok: true, mode: 'shadow' })
      expect(await readFile(join(result.stagingPath, 'docs', 'implementation-gaps.md'), 'utf8')).toContain('Status: unresolved')
    })
  })

  test('blocks malformed comparison before rendering or publishing', async () => {
    await withTmpDir(async root => {
      const render = vi.fn()
      const publish = vi.fn()
      const result = await buildPackageKnowledge(
        inputs(root, extractor(), {
          publish: true,
          submitBatchImpl: successfulBatch(),
          compareGapMappingsImpl: vi.fn(async () => ({ ok: false, diagnostics: [{ code: 'invalid-comparison-json' }] })),
          renderImpl: render,
          publishImpl: publish
        })
      )

      expect(result).toMatchObject({ ok: false, stage: 'gap-mappings', diagnostics: [{ code: 'invalid-comparison-json' }] })
      expect(render).not.toHaveBeenCalled()
      expect(publish).not.toHaveBeenCalled()
    })
  })

  test('blocks duplicate explicit mapping instead of silently overriding automatic relation', async () => {
    await withTmpDir(async root => {
      const mapping = {
        expectedClaimId: 'claim:expected',
        implementedClaimId: 'claim:implemented',
        relation: 'equivalent',
        evidenceIds: ['evidence:expected']
      }
      const render = vi.fn()
      const result = await buildPackageKnowledge(
        inputs(root, extractor(), {
          submitBatchImpl: successfulBatch(),
          gapMappings: [mapping],
          compareGapMappingsImpl: vi.fn(async () => ({ ok: true, mappings: [mapping], unresolvedExpectedClaimIds: [], cache: { version: 1, entries: {} } })),
          renderImpl: render
        })
      )

      expect(result).toMatchObject({ ok: false, stage: 'gap-mappings', diagnostics: [{ code: 'duplicate-gap-mapping' }] })
      expect(render).not.toHaveBeenCalled()
    })
  })

  test('passes unchanged gap cache to comparator for zero-call repeat', async () => {
    await withTmpDir(async root => {
      const expected = { id: 'claim:expected:cached', subjectId: 'code-unit:npm:@fixture/orders:js:src/orders.mjs#submit', predicate: 'outcome', value: false, evidenceIds: ['evidence:expected'], confidence: 1, sourceFingerprint: 'sha256:expected' }
      const cache = { entries: {} }
      const gapCache = { entries: {} }
      const firstBatch = comparisonBatch()
      const first = await buildPackageKnowledge(
        inputs(root, extractor(), {
          cache,
          gapCache,
          expectedOverlay: { claims: [expected], evidence: [{ id: 'evidence:expected', kind: 'spec', path: 'docs/spec.md', contentHash: 'sha256:expected' }] },
          submitBatchImpl: firstBatch
        })
      )
      const secondBatch = vi.fn()
      const second = await buildPackageKnowledge(
        inputs(root, extractor(), {
          cache,
          gapCache,
          expectedOverlay: { claims: [expected], evidence: [{ id: 'evidence:expected', kind: 'spec', path: 'docs/spec.md', contentHash: 'sha256:expected' }] },
          submitBatchImpl: secondBatch
        })
      )

      expect(first).toMatchObject({ ok: true, mode: 'shadow' })
      expect(second).toMatchObject({ ok: true, mode: 'shadow' })
      expect(firstBatch).toHaveBeenCalledTimes(2)
      expect(secondBatch).not.toHaveBeenCalled()
    })
  })

  test('passes exact code, structured and Expected evidence privately to entailment', async () => {
    await withTmpDir(async root => {
      const code = "export const status = '🙂';\nexport function submit() {}"
      const codeEvidence = 'export function submit() {}'
      const codeEvidenceStart = Buffer.byteLength("export const status = '🙂';\n")
      const batch = successfulBatch()
      const verifier = vi.fn(async input => {
        expect(Object.values(input.evidenceContentById)).toContain(codeEvidence)
        const semanticClaims = input.graph.claims.filter(claim => claim.layer === 'implemented' || claim.layer === 'expected')
        for (const claim of semanticClaims) {
          for (const evidenceId of claim.evidenceIds) expect(input.evidenceContentById[evidenceId]).toEqual(expect.any(String))
        }
        expect(input.evidenceContentById).toMatchObject({
          'evidence:orders-openapi': 'openapi: 3.1.0\n',
          'evidence:expected': 'Orders must be accepted.'
        })
        expect(input.submitBatchImpl).toBe(batch)
        return { ok: true, claims: input.graph.claims, cache: { version: 1, entries: {} } }
      })
      const result = await buildPackageKnowledge(
        inputs(root, extractor({ evidenceSpan: { startByte: codeEvidenceStart, endByte: codeEvidenceStart + Buffer.byteLength(codeEvidence) } }), {
          loadSourcesImpl: vi.fn(async () => ({ ok: true, sources: [{ path: 'src/orders.mjs', content: code }] })),
          loadStructuredSourcesImpl: vi.fn(async () => structuredContract()),
          discoverExpectedSourcesImpl: vi.fn(async () => ({ ok: true, sources: [expectedSource()] })),
          mapExpectedSourcesImpl: vi.fn(async ({ graph }) => mappedExpected(graph)),
          verifyEntailmentImpl: verifier,
          submitBatchImpl: batch
        })
      )

      expect(result).toMatchObject({ ok: true, mode: 'shadow' })
      expect(result).not.toHaveProperty('evidenceContentById')
      expect(verifier).toHaveBeenCalledTimes(1)
    })
  })

  test('blocks entailment before rendering or publish', async () => {
    await withTmpDir(async root => {
      const render = vi.fn()
      const publish = vi.fn()
      const result = await buildPackageKnowledge(
        inputs(root, extractor(), {
          publish: true,
          submitBatchImpl: successfulBatch(),
          verifyEntailmentImpl: vi.fn(async () => ({ ok: false, diagnostics: [{ code: 'claim-not-entailed' }] })),
          renderImpl: render,
          publishImpl: publish
        })
      )

      expect(result).toMatchObject({ ok: false, stage: 'entailment', diagnostics: [{ code: 'claim-not-entailed' }] })
      expect(render).not.toHaveBeenCalled()
      expect(publish).not.toHaveBeenCalled()
    })
  })
})

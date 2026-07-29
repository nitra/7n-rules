import { describe, expect, test, vi } from 'vitest'

import { buildKnowledgeCandidate } from '../candidate.mjs'

const DOMAIN = {
  id: 'npm:@fixture/orders',
  ecosystem: 'npm',
  name: '@fixture/orders',
  rootManifest: 'package.json',
  sourceFingerprint: 'sha256:domain'
}

/**
 * Створює test extractor із complete coverage.
 * @returns {Record<string, unknown>} knowledge.extractor@1 fixture
 */
function extractor() {
  return {
    id: 'fixture-js',
    apiVersion: 1,
    extensions: ['.mjs'],
    parser: { id: 'fixture', grammarVersion: '1', runtimeVersion: '1' },
    analyzeFile: vi.fn(({ file }) => ({
      ok: true,
      file: { path: file.path, language: 'js', contentHash: file.contentHash },
      units: [
        {
          localId: 'submit',
          qualifiedPath: `${file.path}#submit`,
          kind: 'function',
          name: 'submit',
          visibility: 'public',
          span: { startByte: 0, endByte: 6 }
        }
      ],
      edges: [],
      coverage: { requiredUnits: 1, coveredUnits: 1, requiredEdges: 0, coveredEdges: 0, complete: true }
    }))
  }
}

describe('buildKnowledgeCandidate', () => {
  test('builds a complete graph in stable source order', async () => {
    const adapter = extractor()
    const result = await buildKnowledgeCandidate({
      domain: DOMAIN,
      sources: [
        { path: 'src/z.mjs', content: 'export function submit() {}' },
        { path: 'src/a.mjs', content: 'export function submit() {}' }
      ],
      extractors: [adapter]
    })

    expect(result.ok).toBe(true)
    expect(adapter.analyzeFile.mock.calls.map(call => call[0].file.path)).toEqual(['src/a.mjs', 'src/z.mjs'])
    expect(result.graph.topics).toHaveLength(2)
    expect(result.graph.gaps).toEqual([])
  })

  test('applies explicit expectations and deterministic gaps', async () => {
    const result = await buildKnowledgeCandidate({
      domain: DOMAIN,
      sources: [{ path: 'src/order.mjs', content: 'export function submit() {}' }],
      extractors: [extractor()],
      expectedOverlay: {
        evidence: [
          {
            id: 'evidence:expected',
            kind: 'spec',
            path: 'docs/spec.md',
            contentHash: 'sha256:expected'
          }
        ],
        claims: [
          {
            id: 'claim:expected-submit',
            subjectId: 'code-unit:npm:@fixture/orders:js:src/order.mjs#submit',
            predicate: 'produces',
            value: 'order',
            evidenceIds: ['evidence:expected'],
            confidence: 1,
            sourceFingerprint: 'sha256:expected'
          }
        ]
      }
    })

    expect(result.ok).toBe(true)
    expect(result.graph.gaps).toEqual([
      expect.objectContaining({ expectedClaimId: 'claim:expected-submit', status: 'missing' })
    ])
  })

  test('blocks missing extractors and thrown parser calls without partial graph', async () => {
    const missing = await buildKnowledgeCandidate({
      domain: DOMAIN,
      sources: [{ path: 'src/order.py', content: 'def submit(): pass' }],
      extractors: [extractor()]
    })
    const adapter = extractor()
    adapter.analyzeFile = vi.fn(() => {
      throw new Error('parse crash')
    })
    const thrown = await buildKnowledgeCandidate({
      domain: DOMAIN,
      sources: [{ path: 'src/order.mjs', content: 'invalid' }],
      extractors: [adapter]
    })

    expect(missing).toEqual({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'extractor-missing', path: 'src/order.py' })]
    })
    expect(thrown).toEqual({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'extractor-threw', path: 'src/order.mjs' })]
    })
  })

  test('blocks incomplete extractor coverage at the final candidate gate', async () => {
    const adapter = extractor()
    const original = adapter.analyzeFile
    adapter.analyzeFile = vi.fn(async input => {
      const fragment = await original(input)
      fragment.coverage.complete = false
      return fragment
    })

    const result = await buildKnowledgeCandidate({
      domain: DOMAIN,
      sources: [{ path: 'src/order.mjs', content: 'export function submit() {}' }],
      extractors: [adapter]
    })

    expect(result.ok).toBe(false)
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'coverage-incomplete' }))
  })
})

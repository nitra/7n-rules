import { describe, expect, test } from 'vitest'

import { validateKnowledgeGraph } from '../validator.mjs'

/**
 * Створює schema-valid knowledge graph fixture.
 * @returns {Record<string, unknown>} fixture
 */
function graph() {
  return {
    schemaVersion: 1,
    domain: {
      id: 'npm:@fixture/orders',
      ecosystem: 'npm',
      name: '@fixture/orders',
      rootManifest: 'package.json',
      sourceFingerprint: 'sha256:domain'
    },
    nodes: [
      {
        id: 'code:submit',
        kind: 'code-unit',
        name: 'submitOrder',
        visibility: 'public',
        domainId: 'npm:@fixture/orders',
        attributes: {},
        sourceFingerprint: 'sha256:submit'
      },
      {
        id: 'code:secret',
        kind: 'code-unit',
        name: 'privateSecret',
        visibility: 'private',
        domainId: 'npm:@fixture/orders',
        attributes: {},
        sourceFingerprint: 'sha256:secret'
      }
    ],
    edges: [
      {
        id: 'edge:submit-secret',
        fromId: 'code:submit',
        toId: 'code:secret',
        kind: 'invokes',
        evidenceIds: ['evidence:submit']
      }
    ],
    claims: [
      {
        id: 'claim:submit',
        subjectId: 'code:submit',
        layer: 'implemented',
        predicate: 'produces',
        value: 'order',
        evidenceIds: ['evidence:submit'],
        confidence: 1,
        sourceFingerprint: 'sha256:claim'
      }
    ],
    topics: [
      {
        id: 'process:submit',
        kind: 'process',
        title: 'Submit order',
        domainId: 'npm:@fixture/orders',
        anchorIds: ['code:submit']
      }
    ],
    gaps: [],
    evidence: [
      {
        id: 'evidence:submit',
        kind: 'code',
        path: 'src/submit.mjs',
        contentHash: 'sha256:evidence'
      }
    ]
  }
}

/**
 * Створює complete extractor fragment fixture.
 * @returns {Record<string, unknown>} fixture
 */
function fragment() {
  return {
    ok: true,
    file: { path: 'src/submit.mjs' },
    coverage: { requiredUnits: 2, coveredUnits: 2, requiredEdges: 1, coveredEdges: 1, complete: true }
  }
}

describe('validateKnowledgeGraph', () => {
  test('accepts a schema-valid, complete and private-safe graph', async () => {
    await expect(
      validateKnowledgeGraph({
        graph: graph(),
        fragments: [fragment()],
        expectedDomainId: 'npm:@fixture/orders',
        humanProjection: 'Submit order persists an order.'
      })
    ).resolves.toEqual({ ok: true, diagnostics: [] })
  })

  test('blocks incomplete extractor coverage without converting it to a gap', async () => {
    const incomplete = fragment()
    incomplete.coverage.coveredEdges = 0
    const result = await validateKnowledgeGraph({ graph: graph(), fragments: [incomplete] })

    expect(result.ok).toBe(false)
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'coverage-incomplete' }))
    expect(result.diagnostics.some(item => item.code.includes('gap'))).toBe(false)
  })

  test('blocks broken references and domain identity mismatch', async () => {
    const candidate = graph()
    candidate.edges[0].toId = 'code:missing'
    const result = await validateKnowledgeGraph({
      graph: candidate,
      fragments: [fragment()],
      expectedDomainId: 'npm:@fixture/other'
    })

    expect(result.ok).toBe(false)
    expect(result.diagnostics.map(item => item.code)).toEqual(['domain-identity-mismatch', 'edge-target-missing'])
  })

  test('blocks private names in human projection but keeps them legal in graph', async () => {
    const result = await validateKnowledgeGraph({
      graph: graph(),
      fragments: [fragment()],
      humanProjection: 'submitOrder calls privateSecret.'
    })

    expect(result.ok).toBe(false)
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'private-symbol-leak', id: 'code:secret' })
    )
  })

  test('returns schema diagnostics before semantic traversal', async () => {
    const candidate = graph()
    delete candidate.domain.sourceFingerprint
    const result = await validateKnowledgeGraph({ graph: candidate })

    expect(result.ok).toBe(false)
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'schema-invalid' })])
  })
})

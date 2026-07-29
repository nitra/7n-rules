import { describe, expect, it } from 'vitest'

import { buildNormalizedGraph, createCodeUnitId, serializeKnowledgeGraph } from '../normalized-graph.mjs'

const domain = {
  id: 'npm:@fixture/orders',
  ecosystem: 'npm',
  name: '@fixture/orders',
  rootManifest: 'package.json',
  sourceFingerprint: 'domain-hash'
}

function fragment(path, units, edges = []) {
  return {
    ok: true,
    parser: { id: 'fixture', grammarVersion: '1', runtimeVersion: '1' },
    file: { path, language: 'js', contentHash: `hash:${path}` },
    units,
    edges,
    entryPoints: [],
    imports: [],
    chunks: [],
    coverage: { requiredUnits: units.length, requiredEdges: edges.length }
  }
}

describe('buildNormalizedGraph', () => {
  it('gives byte-identical output for differently ordered fragments and attributes', () => {
    const first = fragment('src/a.mjs', [
      {
        localId: 'submit',
        kind: 'function',
        name: 'submitOrder',
        qualifiedPath: 'submitOrder',
        visibility: 'public',
        signature: 'submitOrder(input)',
        attributes: { z: true, a: false }
      }
    ])
    const second = fragment('src/b.mjs', [
      {
        localId: 'persist',
        kind: 'function',
        name: 'persistOrder',
        qualifiedPath: 'persistOrder',
        visibility: 'private',
        attributes: { b: 2, a: 1 }
      }
    ])

    const left = buildNormalizedGraph({ domain, fragments: [first, second] })
    const right = buildNormalizedGraph({ domain, fragments: [second, first] })

    expect(left.ok).toBe(true)
    expect(right.ok).toBe(true)
    expect(serializeKnowledgeGraph(left.graph)).toBe(serializeKnowledgeGraph(right.graph))
  })

  it('keeps private units in traceability graph without changing their visibility', () => {
    const result = buildNormalizedGraph({
      domain,
      fragments: [
        fragment('src/internal.mjs', [
          {
            localId: 'helper',
            kind: 'function',
            name: 'internalHelper',
            qualifiedPath: 'internalHelper',
            visibility: 'private'
          }
        ])
      ]
    })

    expect(result.ok).toBe(true)
    expect(result.graph.nodes).toContainEqual(
      expect.objectContaining({
        id: createCodeUnitId(domain.id, 'js', 'internalHelper'),
        visibility: 'private'
      })
    )
  })

  it('represents external dependencies as opaque contract nodes', () => {
    const result = buildNormalizedGraph({
      domain,
      fragments: [
        fragment(
          'src/submit.mjs',
          [
            {
              localId: 'submit',
              kind: 'function',
              name: 'submitOrder',
              qualifiedPath: 'submitOrder',
              visibility: 'public'
            }
          ],
          [
            {
              kind: 'integrates',
              fromLocalId: 'submit',
              to: { unresolvedSpecifier: '@fixture/payments', opaque: true },
              evidence: [{ path: 'src/submit.mjs', role: 'syntax', span: { startByte: 10, endByte: 30 } }]
            }
          ]
        )
      ]
    })

    expect(result.ok).toBe(true)
    expect(result.graph.nodes).toContainEqual(
      expect.objectContaining({
        kind: 'integration',
        name: '@fixture/payments',
        visibility: 'opaque',
        attributes: { opaque: true, specifier: '@fixture/payments' }
      })
    )
    expect(result.graph.edges[0].evidenceIds).toHaveLength(1)
  })

  it('fails the complete graph when any extractor result failed', () => {
    const result = buildNormalizedGraph({
      domain,
      fragments: [
        fragment('src/valid.mjs', []),
        {
          ok: false,
          diagnostics: [{ code: 'parse-error', path: 'src/broken.mjs', detail: 'Unexpected token' }]
        }
      ]
    })

    expect(result).toEqual({
      ok: false,
      diagnostics: [{ code: 'parse-error', path: 'src/broken.mjs', detail: 'Unexpected token' }]
    })
    expect(result).not.toHaveProperty('graph')
  })

  it('rejects semantic edges without evidence instead of publishing assumptions', () => {
    const result = buildNormalizedGraph({
      domain,
      fragments: [
        fragment(
          'src/submit.mjs',
          [
            {
              localId: 'submit',
              kind: 'function',
              name: 'submitOrder',
              qualifiedPath: 'submitOrder',
              visibility: 'public'
            },
            {
              localId: 'persist',
              kind: 'function',
              name: 'persistOrder',
              qualifiedPath: 'persistOrder',
              visibility: 'private'
            }
          ],
          [{ kind: 'invokes', fromLocalId: 'submit', to: { localId: 'persist' }, evidence: [] }]
        )
      ]
    })

    expect(result.ok).toBe(false)
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'edge-without-evidence', path: 'src/submit.mjs' })
    )
  })
})

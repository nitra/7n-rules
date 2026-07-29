import { describe, expect, it } from 'vitest'

import { planSemanticChunks } from '../chunk-planner.mjs'

const DOMAIN = { id: 'npm:@fixture/orders' }

/**
 * Створює code-unit node із byte span у fixture source.
 * @param {string} id stable node ID
 * @param {string} path source path
 * @param {number} startByte half-open span start
 * @param {number} endByte half-open span end
 * @returns {Record<string, unknown>} normalized graph node
 */
function node(id, path, startByte, endByte) {
  return {
    id,
    kind: 'code-unit',
    domainId: DOMAIN.id,
    attributes: { sourcePath: path, span: { startByte, endByte } }
  }
}

/**
 * Створює provenance-bearing graph edge.
 * @param {string} id stable edge ID
 * @param {string} fromId caller node ID
 * @param {string} toId dependency node ID
 * @param {string} evidenceId evidence ID
 * @returns {Record<string, unknown>} normalized graph edge
 */
function edge(id, fromId, toId, evidenceId) {
  return { id, kind: 'invokes', fromId, toId, evidenceIds: [evidenceId] }
}

/**
 * Створює graph із provided nodes, edges та exact evidence spans.
 * @param {Record<string, unknown>[]} nodes graph nodes
 * @param {Record<string, unknown>[]} edges graph edges
 * @param {Record<string, unknown>[]} evidence graph evidence
 * @returns {Record<string, unknown>} normalized graph fixture
 */
function graph(nodes, edges = [], evidence = []) {
  return { schemaVersion: 1, domain: DOMAIN, nodes, edges, evidence }
}

describe('planSemanticChunks', () => {
  it('uses exact UTF-8 byte slices and rejects a span through a unicode code point', () => {
    const source = '😀run()'
    const valid = planSemanticChunks({
      graph: graph([node('node:run', 'src/run.mjs', 0, Buffer.byteLength(source))]),
      sources: [{ path: 'src/run.mjs', content: source }],
      maxTokens: 100
    })
    const invalid = planSemanticChunks({
      graph: graph([node('node:run', 'src/run.mjs', 1, Buffer.byteLength(source))]),
      sources: [{ path: 'src/run.mjs', content: source }],
      maxTokens: 100
    })

    expect(valid.ok).toBe(true)
    expect(valid.plan.chunks[0].unitSlices).toEqual([
      expect.objectContaining({ nodeId: 'node:run', text: source, span: { startByte: 0, endByte: 9 } })
    ])
    expect(invalid).toEqual({ ok: false, diagnostics: [expect.objectContaining({ code: 'span-invalid' })] })
  })

  it('keeps cycles in one SCC chunk and schedules dependencies before callers', () => {
    const source = 'alpha(); beta(); gamma();'
    const nodes = [
      node('node:alpha', 'src/a.mjs', 0, 8),
      node('node:beta', 'src/a.mjs', 9, 16),
      node('node:gamma', 'src/a.mjs', 17, 25)
    ]
    const evidence = [
      { id: 'e:alpha-beta', path: 'src/a.mjs', span: { startByte: 0, endByte: 8 } },
      { id: 'e:beta-alpha', path: 'src/a.mjs', span: { startByte: 9, endByte: 16 } },
      { id: 'e:gamma-alpha', path: 'src/a.mjs', span: { startByte: 17, endByte: 25 } }
    ]
    const result = planSemanticChunks({
      graph: graph(
        nodes,
        [
          edge('edge:alpha-beta', 'node:alpha', 'node:beta', 'e:alpha-beta'),
          edge('edge:beta-alpha', 'node:beta', 'node:alpha', 'e:beta-alpha'),
          edge('edge:gamma-alpha', 'node:gamma', 'node:alpha', 'e:gamma-alpha')
        ],
        evidence
      ),
      sources: [{ path: 'src/a.mjs', content: source }],
      maxTokens: 100
    })

    expect(result.ok).toBe(true)
    expect(result.plan.chunks).toHaveLength(2)
    expect(result.plan.chunks[0].nodeIds).toEqual(['node:alpha', 'node:beta'])
    expect(result.plan.chunks[1].nodeIds).toEqual(['node:gamma'])
    expect(result.plan.chunks[1].dependsOnChunkIds).toEqual([result.plan.chunks[0].id])
    expect(result.plan.coverage).toMatchObject({
      complete: true,
      coveredNodeIds: ['node:alpha', 'node:beta', 'node:gamma']
    })
  })

  it('is byte-stable across input order and fingerprints all cache policy inputs', () => {
    const sourceA = 'a()'
    const sourceB = 'b()'
    const baseGraph = graph([node('node:a', 'src/a.mjs', 0, 3), node('node:b', 'src/b.mjs', 0, 3)], [], [])
    const input = {
      graph: baseGraph,
      maxTokens: 15,
      parser: { id: 'oxc', version: '1' },
      schema: { version: 1 },
      prompt: { version: 'map-v1' },
      modelPolicy: { tiers: ['local-min', 'cloud'] }
    }
    const left = planSemanticChunks({
      ...input,
      sources: [
        { path: 'src/a.mjs', content: sourceA },
        { path: 'src/b.mjs', content: sourceB }
      ]
    })
    const right = planSemanticChunks({
      ...input,
      graph: graph(baseGraph.nodes.toReversed(), [], []),
      sources: [
        { path: 'src/b.mjs', content: sourceB },
        { path: 'src/a.mjs', content: sourceA }
      ]
    })
    const changedPolicy = planSemanticChunks({
      ...input,
      sources: [
        { path: 'src/a.mjs', content: sourceA },
        { path: 'src/b.mjs', content: sourceB }
      ],
      prompt: { version: 'map-v2' }
    })

    expect(left).toEqual(right)
    expect(left.ok).toBe(true)
    expect(left.plan.chunks[0].cacheFingerprint).not.toBe(changedPolicy.plan.chunks[0].cacheFingerprint)
    expect(left.plan.reduce.levels).not.toEqual([])
  })

  it('covers every required node and edge instead of truncating a tail for the budget', () => {
    const source = 'a();b();c();'
    const nodes = [
      node('node:a', 'src/a.mjs', 0, 4),
      node('node:b', 'src/a.mjs', 4, 8),
      node('node:c', 'src/a.mjs', 8, 12)
    ]
    const evidence = [
      { id: 'e:a-b', path: 'src/a.mjs', span: { startByte: 0, endByte: 4 } },
      { id: 'e:b-c', path: 'src/a.mjs', span: { startByte: 4, endByte: 8 } }
    ]
    const result = planSemanticChunks({
      graph: graph(
        nodes,
        [edge('edge:a-b', 'node:a', 'node:b', 'e:a-b'), edge('edge:b-c', 'node:b', 'node:c', 'e:b-c')],
        evidence
      ),
      sources: [{ path: 'src/a.mjs', content: source }],
      maxTokens: 30
    })

    expect(result.ok).toBe(true)
    expect(result.plan.chunks).toHaveLength(3)
    expect(result.plan.coverage).toEqual({
      requiredNodeIds: ['node:a', 'node:b', 'node:c'],
      requiredEdgeIds: ['edge:a-b', 'edge:b-c'],
      coveredNodeIds: ['node:a', 'node:b', 'node:c'],
      coveredEdgeIds: ['edge:a-b', 'edge:b-c'],
      complete: true
    })
  })

  it('fails explicitly for an oversized unit and an oversized SCC rather than clipping source', () => {
    const source = 'veryLongUnit();'
    const unit = planSemanticChunks({
      graph: graph([node('node:large', 'src/a.mjs', 0, Buffer.byteLength(source))]),
      sources: [{ path: 'src/a.mjs', content: source }],
      maxTokens: 2
    })
    const cycle = planSemanticChunks({
      graph: graph(
        [node('node:a', 'src/a.mjs', 0, 4), node('node:b', 'src/a.mjs', 4, 8)],
        [edge('edge:a-b', 'node:a', 'node:b', 'e:a-b'), edge('edge:b-a', 'node:b', 'node:a', 'e:b-a')],
        [
          { id: 'e:a-b', path: 'src/a.mjs', span: { startByte: 0, endByte: 4 } },
          { id: 'e:b-a', path: 'src/a.mjs', span: { startByte: 4, endByte: 8 } }
        ]
      ),
      sources: [{ path: 'src/a.mjs', content: 'a();b();' }],
      maxTokens: 20
    })

    expect(unit).toEqual({ ok: false, diagnostics: [expect.objectContaining({ code: 'oversized-unit' })] })
    expect(cycle).toEqual({ ok: false, diagnostics: [expect.objectContaining({ code: 'oversized-scc' })] })
  })
})

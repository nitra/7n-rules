import { describe, expect, test, vi } from 'vitest'

import { buildStructuredClaims, createImplementedClaimId } from '../claims.mjs'

const GRAPH = {
  domain: { id: 'npm:@fixture/orders' },
  nodes: [{ id: 'node:submit' }, { id: 'node:notify' }],
  edges: [{ id: 'edge:submit-notify' }],
  evidence: [{ id: 'evidence:submit' }, { id: 'evidence:notify' }]
}

const CHUNKS = [
  {
    id: 'chunk:submit',
    prompt: 'submit flow',
    contentHash: 'sha256:submit',
    requiredNodeIds: ['node:submit'],
    requiredEdgeIds: [],
    allowedEvidenceIds: ['evidence:submit'],
    wave: 0,
    dependsOnChunkIds: []
  },
  {
    id: 'chunk:notify',
    prompt: 'notify flow',
    contentHash: 'sha256:notify',
    requiredNodeIds: ['node:notify'],
    requiredEdgeIds: ['edge:submit-notify'],
    allowedEvidenceIds: ['evidence:notify'],
    wave: 1,
    dependsOnChunkIds: ['chunk:submit']
  }
]

/**
 * Створює strict successful LLM JSON для одного batch item.
 * @param {object} item submitted item
 * @returns {string} valid JSON result
 */
function validResult(item) {
  const coveredNodeIds = JSON.parse(item.prompt.match(/Required node IDs: (\[[^\n]+\])\./u)[1])
  const coveredEdgeIds = JSON.parse(item.prompt.match(/Required edge IDs: (\[[^\n]*\])\./u)[1])
  return JSON.stringify({
    claims: coveredNodeIds.map(subjectId => ({
      subjectId,
      predicate: 'outcome',
      value: subjectId,
      evidenceIds: [subjectId === 'node:notify' ? 'evidence:notify' : 'evidence:submit'],
      confidence: 1
    })),
    coveredNodeIds,
    coveredEdgeIds
  })
}

/**
 * Повертає batch double з відповідями в зворотному порядку.
 * @returns {ReturnType<typeof vi.fn>} injectable submitBatch
 */
function successfulBatch() {
  return vi.fn((tier, items) =>
    Promise.resolve(items.toReversed().map(item => ({ customId: item.customId, ok: validResult(item) })))
  )
}

describe('buildStructuredClaims', () => {
  test('executes map waves in dependency order and injects canonical dependency summaries', async () => {
    const submitBatchImpl = successfulBatch()
    const result = await buildStructuredClaims({
      graph: GRAPH,
      chunks: CHUNKS,
      parserVersion: 'oxc@1',
      submitBatchImpl
    })

    expect(result.ok).toBe(true)
    expect(submitBatchImpl).toHaveBeenCalledTimes(3)
    expect(submitBatchImpl.mock.calls[0][0]).toBe('min')
    expect(submitBatchImpl.mock.calls[0][1].map(item => item.customId)).toEqual(['chunk:submit'])
    expect(submitBatchImpl.mock.calls[1][1].map(item => item.customId)).toEqual(['chunk:notify'])
    expect(submitBatchImpl.mock.calls[1][1][0].prompt).toContain('"id":"chunk:submit"')
    expect(submitBatchImpl.mock.calls[2][1][0].customId).toBe('reduce:0:0')
    expect(result.claims.map(claim => claim.id)).toContain(
      createImplementedClaimId({
        domainId: 'npm:@fixture/orders',
        subjectId: 'node:submit',
        predicate: 'outcome',
        value: 'node:submit',
        evidenceIds: ['evidence:submit']
      })
    )
  })

  test('uses successful map and reduce cache entries without any LLM call', async () => {
    const cache = { entries: {} }
    const first = successfulBatch()
    const initial = await buildStructuredClaims({
      graph: GRAPH,
      chunks: CHUNKS,
      parserVersion: 'oxc@1',
      cache,
      submitBatchImpl: first
    })
    const second = vi.fn()
    const cached = await buildStructuredClaims({
      graph: GRAPH,
      chunks: CHUNKS,
      parserVersion: 'oxc@1',
      cache,
      submitBatchImpl: second
    })

    expect(initial.ok).toBe(true)
    expect(cached).toEqual(initial)
    expect(second).not.toHaveBeenCalled()
  })

  test('escalates only failed chunk to next universal tier', async () => {
    const submitBatchImpl = vi.fn((tier, items) => {
      if (tier === 'min') {
        return Promise.resolve(
          items.map(item =>
            item.customId === 'chunk:notify'
              ? { customId: item.customId, error: 'transient' }
              : { customId: item.customId, ok: validResult(item) }
          )
        )
      }
      return Promise.resolve(items.map(item => ({ customId: item.customId, ok: validResult(item) })))
    })

    const result = await buildStructuredClaims({
      graph: GRAPH,
      chunks: CHUNKS,
      parserVersion: 'oxc@1',
      submitBatchImpl
    })

    expect(result.ok).toBe(true)
    expect(submitBatchImpl.mock.calls[0][1].map(item => item.customId)).toEqual(['chunk:submit'])
    expect(submitBatchImpl.mock.calls[1][0]).toBe('min')
    expect(submitBatchImpl.mock.calls[1][1].map(item => item.customId)).toEqual(['chunk:notify'])
    expect(submitBatchImpl.mock.calls[2][0]).toBe('avg')
    expect(submitBatchImpl.mock.calls[2][1].map(item => item.customId)).toEqual(['chunk:notify'])
  })

  test('fails closed after invalid JSON instead of accepting unverified claims', async () => {
    const submitBatchImpl = vi.fn((tier, items) =>
      Promise.resolve(items.map(item => ({ customId: item.customId, ok: 'not JSON' })))
    )

    const result = await buildStructuredClaims({
      graph: GRAPH,
      chunks: [CHUNKS[0]],
      parserVersion: 'oxc@1',
      modelPolicy: ['min', 'avg'],
      submitBatchImpl
    })

    expect(result).toMatchObject({ ok: false, blockers: [{ code: 'invalid-json', chunkId: 'chunk:submit' }] })
    expect(submitBatchImpl).toHaveBeenCalledTimes(2)
  })

  test('requires a behavioral claim for every required semantic unit and states the stable taxonomy in the prompt', async () => {
    const submitBatchImpl = vi.fn((tier, items) => {
      expect(items[0].prompt).toContain('purpose, actor, trigger, precondition, step, business-rule, state-change, integration, outcome')
      return Promise.resolve(items.map(item => ({
        customId: item.customId,
        ok: JSON.stringify({ claims: [], coveredNodeIds: ['node:submit'], coveredEdgeIds: [] })
      })))
    })

    const result = await buildStructuredClaims({
      graph: GRAPH,
      chunks: [CHUNKS[0]],
      parserVersion: 'oxc@1',
      modelPolicy: ['min'],
      submitBatchImpl
    })

    expect(result).toMatchObject({ ok: false, blockers: [{ code: 'behavioral-coverage-incomplete', chunkId: 'chunk:submit' }] })
  })

  test('blocks missing result and uncovered required edge', async () => {
    const missing = await buildStructuredClaims({
      graph: GRAPH,
      chunks: [CHUNKS[0]],
      parserVersion: 'oxc@1',
      modelPolicy: ['min'],
      submitBatchImpl: vi.fn(() => Promise.resolve([]))
    })
    const uncovered = await buildStructuredClaims({
      graph: GRAPH,
      chunks: [{ ...CHUNKS[1], wave: 0, dependsOnChunkIds: [] }],
      parserVersion: 'oxc@1',
      modelPolicy: ['min'],
      submitBatchImpl: vi.fn((tier, items) =>
        Promise.resolve(
          items.map(item => ({
            customId: item.customId,
            ok: JSON.stringify({
              claims: [
                {
                  subjectId: 'node:notify',
                  predicate: 'outcome',
                  value: 'notice',
                  evidenceIds: ['evidence:notify'],
                  confidence: 1
                }
              ],
              coveredNodeIds: ['node:notify'],
              coveredEdgeIds: []
            })
          }))
        )
      )
    })

    expect(missing).toMatchObject({ ok: false, blockers: [{ code: 'missing-result', chunkId: 'chunk:submit' }] })
    expect(uncovered).toMatchObject({ ok: false, blockers: [{ code: 'coverage-incomplete', chunkId: 'chunk:notify' }] })
  })

  test('rejects graph-global evidence outside the chunk scope', async () => {
    const result = await buildStructuredClaims({
      graph: GRAPH,
      chunks: [CHUNKS[0]],
      parserVersion: 'oxc@1',
      modelPolicy: ['min'],
      submitBatchImpl: vi.fn((tier, items) =>
        Promise.resolve(
          items.map(item => ({
            customId: item.customId,
            ok: JSON.stringify({
              claims: [
                {
                  subjectId: 'node:submit',
                  predicate: 'outcome',
                  value: 'order',
                  evidenceIds: ['evidence:notify'],
                  confidence: 1
                }
              ],
              coveredNodeIds: ['node:submit'],
              coveredEdgeIds: []
            })
          }))
        )
      )
    })

    expect(result).toMatchObject({ ok: false, blockers: [{ code: 'invalid-claim-refs', chunkId: 'chunk:submit' }] })
  })

  test('rejects claim predicates outside the stable behavioral taxonomy', async () => {
    const result = await buildStructuredClaims({
      graph: GRAPH,
      chunks: [CHUNKS[0]],
      parserVersion: 'oxc@1',
      modelPolicy: ['min'],
      submitBatchImpl: vi.fn((tier, items) =>
        Promise.resolve(
          items.map(item => ({
            customId: item.customId,
            ok: JSON.stringify({
              claims: [{
                subjectId: 'node:submit',
                predicate: 'arbitrary-relation',
                value: 'order',
                evidenceIds: ['evidence:submit'],
                confidence: 1
              }],
              coveredNodeIds: ['node:submit'],
              coveredEdgeIds: []
            })
          }))
        )
      )
    })

    expect(result).toMatchObject({ ok: false, blockers: [{ code: 'invalid-claim-refs', chunkId: 'chunk:submit' }] })
  })

  test('blocks missing and cyclic dependency plans before any LLM call', async () => {
    const submitBatchImpl = vi.fn()
    const missing = await buildStructuredClaims({
      graph: GRAPH,
      chunks: [{ ...CHUNKS[0], dependsOnChunkIds: ['chunk:missing'] }],
      parserVersion: 'oxc@1',
      submitBatchImpl
    })
    const cyclic = await buildStructuredClaims({
      graph: GRAPH,
      chunks: [
        { ...CHUNKS[0], dependsOnChunkIds: ['chunk:notify'], wave: 1 },
        { ...CHUNKS[1], dependsOnChunkIds: ['chunk:submit'], wave: 2 }
      ],
      parserVersion: 'oxc@1',
      submitBatchImpl
    })

    expect(missing).toMatchObject({ ok: false, blockers: [{ code: 'unknown-chunk-dependency', chunkId: 'chunk:submit' }] })
    expect(cyclic).toMatchObject({ ok: false })
    expect(cyclic.blockers).toContainEqual(expect.objectContaining({ code: 'cyclic-chunk-dependency' }))
    expect(submitBatchImpl).not.toHaveBeenCalled()
  })

  test('returns byte-stable result despite reversed batch completion order', async () => {
    const left = await buildStructuredClaims({
      graph: GRAPH,
      chunks: CHUNKS,
      parserVersion: 'oxc@1',
      submitBatchImpl: successfulBatch()
    })
    const right = await buildStructuredClaims({
      graph: GRAPH,
      chunks: [...CHUNKS].toReversed(),
      parserVersion: 'oxc@1',
      submitBatchImpl: successfulBatch()
    })

    expect(JSON.stringify(right)).toBe(JSON.stringify(left))
  })
})

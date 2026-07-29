import { describe, expect, test, vi } from 'vitest'

import { buildStructuredClaims, createImplementedClaimId } from '../claims.mjs'

const GRAPH = {
  domain: { id: 'npm:@fixture/orders' },
  nodes: [{ id: 'node:submit' }, { id: 'node:notify' }],
  edges: [{ id: 'edge:submit-notify' }],
  evidence: [{ id: 'evidence:submit' }, { id: 'evidence:notify' }]
}

const CHUNKS = [
  { id: 'chunk:submit', prompt: 'submit flow', contentHash: 'sha256:submit', requiredNodeIds: ['node:submit'], requiredEdgeIds: [] },
  {
    id: 'chunk:notify',
    prompt: 'notify flow',
    contentHash: 'sha256:notify',
    requiredNodeIds: ['node:notify'],
    requiredEdgeIds: ['edge:submit-notify']
  }
]

/**
 * Створює strict successful LLM JSON для одного batch item.
 * @param {object} item submitted item
 * @returns {string} valid JSON result
 */
function validResult(item) {
  const isNotify = item.customId.includes('notify') || item.prompt.includes('node:notify')
  const subjectId = isNotify ? 'node:notify' : 'node:submit'
  const evidenceId = isNotify ? 'evidence:notify' : 'evidence:submit'
  const coveredNodeIds = item.prompt.includes('node:submit') && item.prompt.includes('node:notify') ? ['node:notify', 'node:submit'] : [subjectId]
  const coveredEdgeIds = item.prompt.includes('edge:submit-notify') ? ['edge:submit-notify'] : []
  return JSON.stringify({
    claims: [{ subjectId, predicate: 'produces', value: subjectId, evidenceIds: [evidenceId], confidence: 1 }],
    coveredNodeIds,
    coveredEdgeIds
  })
}

/**
 * Повертає batch double з відповідями в зворотному порядку.
 * @returns {ReturnType<typeof vi.fn>} injectable submitBatch
 */
function successfulBatch() {
  return vi.fn((tier, items) => Promise.resolve(items.toReversed().map(item => ({ customId: item.customId, ok: validResult(item) }))))
}

describe('buildStructuredClaims', () => {
  test('submits one map batch per wave and creates canonical IDs in deterministic core', async () => {
    const submitBatchImpl = successfulBatch()
    const result = await buildStructuredClaims({ graph: GRAPH, chunks: CHUNKS, parserVersion: 'oxc@1', submitBatchImpl })

    expect(result.ok).toBe(true)
    expect(submitBatchImpl).toHaveBeenCalledTimes(2)
    expect(submitBatchImpl.mock.calls[0][0]).toBe('min')
    expect(submitBatchImpl.mock.calls[0][1]).toHaveLength(2)
    expect(submitBatchImpl.mock.calls[1][1]).toHaveLength(1)
    expect(result.claims.map(claim => claim.id)).toContain(
      createImplementedClaimId({
        domainId: 'npm:@fixture/orders',
        subjectId: 'node:submit',
        predicate: 'produces',
        value: 'node:submit',
        evidenceIds: ['evidence:submit']
      })
    )
  })

  test('uses successful map and reduce cache entries without any LLM call', async () => {
    const cache = { entries: {} }
    const first = successfulBatch()
    const initial = await buildStructuredClaims({ graph: GRAPH, chunks: CHUNKS, parserVersion: 'oxc@1', cache, submitBatchImpl: first })
    const second = vi.fn()
    const cached = await buildStructuredClaims({ graph: GRAPH, chunks: CHUNKS, parserVersion: 'oxc@1', cache, submitBatchImpl: second })

    expect(initial.ok).toBe(true)
    expect(cached).toEqual(initial)
    expect(second).not.toHaveBeenCalled()
  })

  test('escalates only failed chunk to next universal tier', async () => {
    const submitBatchImpl = vi.fn((tier, items) => {
      if (tier === 'min') {
        return Promise.resolve(
          items.map(item => (item.customId === 'chunk:notify' ? { customId: item.customId, error: 'transient' } : { customId: item.customId, ok: validResult(item) }))
        )
      }
      return Promise.resolve(items.map(item => ({ customId: item.customId, ok: validResult(item) })))
    })

    const result = await buildStructuredClaims({ graph: GRAPH, chunks: CHUNKS, parserVersion: 'oxc@1', submitBatchImpl })

    expect(result.ok).toBe(true)
    expect(submitBatchImpl.mock.calls[0][1]).toHaveLength(2)
    expect(submitBatchImpl.mock.calls[1][0]).toBe('avg')
    expect(submitBatchImpl.mock.calls[1][1].map(item => item.customId)).toEqual(['chunk:notify'])
  })

  test('fails closed after invalid JSON instead of accepting unverified claims', async () => {
    const submitBatchImpl = vi.fn((tier, items) => Promise.resolve(items.map(item => ({ customId: item.customId, ok: 'not JSON' }))))

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
      chunks: [CHUNKS[1]],
      parserVersion: 'oxc@1',
      modelPolicy: ['min'],
      submitBatchImpl: vi.fn((tier, items) =>
        Promise.resolve(
          items.map(item => ({
            customId: item.customId,
            ok: JSON.stringify({
              claims: [{ subjectId: 'node:notify', predicate: 'produces', value: 'notice', evidenceIds: ['evidence:notify'], confidence: 1 }],
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

  test('returns byte-stable result despite reversed batch completion order', async () => {
    const left = await buildStructuredClaims({ graph: GRAPH, chunks: CHUNKS, parserVersion: 'oxc@1', submitBatchImpl: successfulBatch() })
    const right = await buildStructuredClaims({
      graph: GRAPH,
      chunks: [...CHUNKS].toReversed(),
      parserVersion: 'oxc@1',
      submitBatchImpl: successfulBatch()
    })

    expect(JSON.stringify(right)).toBe(JSON.stringify(left))
  })
})

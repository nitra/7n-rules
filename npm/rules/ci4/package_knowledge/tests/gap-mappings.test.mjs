import { describe, expect, test, vi } from 'vitest'

import { compareClaimMappings } from '../gap-mappings.mjs'
import { evaluateGaps } from '../gap-engine.mjs'

const EXPECTED = {
  id: 'claim:expected:receipt',
  layer: 'expected',
  subjectId: 'node:submit',
  predicate: 'produces',
  value: 'receipt',
  evidenceIds: ['evidence:expected'],
  confidence: 1,
  sourceFingerprint: 'sha256:expected'
}

const IMPLEMENTED = {
  id: 'claim:implemented:receipt',
  layer: 'implemented',
  subjectId: 'node:submit',
  predicate: 'produces',
  value: 'receipt',
  evidenceIds: ['evidence:implemented'],
  confidence: 1,
  sourceFingerprint: 'sha256:implemented'
}

/**
 * Будує мінімальний evidence-backed graph для comparison і gap assertions.
 * @param {object[]} claims graph claims
 * @returns {{claims: object[], evidence: object[]}} comparison graph
 */
function graph(claims) {
  return {
    claims,
    evidence: [{ id: 'evidence:expected' }, { id: 'evidence:implemented' }]
  }
}

/**
 * Створює strict semantic comparator JSON.
 * @param {string} expectedClaimId expected claim identity
 * @param {object[]} comparisons comparison facts
 * @param {boolean} [unresolved] explicit uncertainty marker
 * @returns {string} strict JSON response
 */
function comparison(expectedClaimId, comparisons, unresolved = false) {
  return JSON.stringify({ expectedClaimId, comparisons, unresolved })
}

describe('compareClaimMappings', () => {
  test('derives an exact equivalent mapping with zero LLM calls', async () => {
    const submitBatchImpl = vi.fn()
    const sourceGraph = graph([EXPECTED, IMPLEMENTED])
    const result = await compareClaimMappings({ graph: sourceGraph, submitBatchImpl })

    expect(result).toMatchObject({
      ok: true,
      mappings: [
        {
          expectedClaimId: EXPECTED.id,
          implementedClaimId: IMPLEMENTED.id,
          relation: 'equivalent',
          evidenceIds: ['evidence:expected', 'evidence:implemented']
        }
      ],
      unresolvedExpectedClaimIds: []
    })
    expect(submitBatchImpl).not.toHaveBeenCalled()
    expect(evaluateGaps({ graph: sourceGraph, mappings: result.mappings })).toMatchObject({
      ok: true,
      gaps: [expect.objectContaining({ status: 'satisfied' })]
    })
  })

  test('leaves an expectation missing only when no same-subject implementation exists', async () => {
    const missingImplemented = { ...IMPLEMENTED, subjectId: 'node:other' }
    const submitBatchImpl = vi.fn()
    const sourceGraph = graph([EXPECTED, missingImplemented])
    const result = await compareClaimMappings({ graph: sourceGraph, submitBatchImpl })

    expect(result).toMatchObject({ ok: true, mappings: [], unresolvedExpectedClaimIds: [] })
    expect(submitBatchImpl).not.toHaveBeenCalled()
    expect(evaluateGaps({ graph: sourceGraph, mappings: result.mappings }).gaps[0].status).toBe('missing')
  })

  test('maps a semantic contradiction to diverged with combined evidence IDs', async () => {
    const divergent = { ...IMPLEMENTED, value: 'invoice' }
    const sourceGraph = graph([EXPECTED, divergent])
    const result = await compareClaimMappings({
      graph: sourceGraph,
      submitBatchImpl: vi.fn((tier, items) =>
        Promise.resolve(items.map(item => ({ customId: item.customId, ok: comparison(item.customId, [{ implementedClaimId: divergent.id, relation: 'contradicts' }]) })))
      )
    })

    expect(result).toMatchObject({ ok: true, mappings: [expect.objectContaining({ relation: 'contradicts', evidenceIds: ['evidence:expected', 'evidence:implemented'] })] })
    expect(evaluateGaps({ graph: sourceGraph, mappings: result.mappings }).gaps[0].status).toBe('diverged')
  })

  test('keeps ambiguous same-subject comparison unresolved instead of missing', async () => {
    const divergent = { ...IMPLEMENTED, value: 'invoice' }
    const sourceGraph = graph([EXPECTED, divergent])
    const result = await compareClaimMappings({
      graph: sourceGraph,
      submitBatchImpl: vi.fn((tier, items) =>
        Promise.resolve(items.map(item => ({ customId: item.customId, ok: comparison(item.customId, [], true) })))
      )
    })

    expect(result).toMatchObject({ ok: true, mappings: [], unresolvedExpectedClaimIds: [EXPECTED.id] })
    expect(evaluateGaps({ graph: sourceGraph, mappings: result.mappings, unresolvedExpectedClaimIds: result.unresolvedExpectedClaimIds }).gaps[0].status).toBe('unresolved')
  })

  test('escalates malformed results and reuses the unchanged successful cache', async () => {
    const divergent = { ...IMPLEMENTED, value: 'invoice' }
    const sourceGraph = graph([EXPECTED, divergent])
    const cache = { entries: {} }
    const first = vi.fn((tier, items) =>
      Promise.resolve(items.map(item => ({ customId: item.customId, ok: tier === 'min' ? 'not-json' : comparison(item.customId, [{ implementedClaimId: divergent.id, relation: 'equivalent' }]) })))
    )
    const initial = await compareClaimMappings({ graph: sourceGraph, cache, submitBatchImpl: first })
    const second = vi.fn()
    const cached = await compareClaimMappings({ graph: sourceGraph, cache, submitBatchImpl: second })

    expect(initial.ok).toBe(true)
    expect(first.mock.calls.map(call => call[0])).toEqual(['min', 'avg'])
    expect(cached).toEqual(initial)
    expect(second).not.toHaveBeenCalled()
  })
})

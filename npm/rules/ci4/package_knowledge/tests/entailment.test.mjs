import { describe, expect, test, vi } from 'vitest'

import { verifyEvidenceEntailment } from '../entailment.mjs'

const IMPLEMENTED = {
  id: 'claim:implemented:submit',
  layer: 'implemented',
  subjectId: 'node:submit',
  predicate: 'produces',
  value: 'receipt',
  evidenceIds: ['evidence:submit'],
  confidence: 1,
  sourceFingerprint: 'sha256:implemented'
}

const EXPECTED = {
  id: 'claim:expected:notify',
  layer: 'expected',
  subjectId: 'node:notify',
  predicate: 'emits',
  value: 'notification',
  evidenceIds: ['evidence:notify'],
  confidence: 1,
  sourceFingerprint: 'sha256:expected'
}

/**
 * Будує immutable graph з implemented та expected assertion layers.
 * @param {object[]} [claims] evidence-backed claims
 * @returns {{claims: object[]}} verifier graph
 */
function graph(claims = [IMPLEMENTED, EXPECTED]) {
  return { claims }
}

const EVIDENCE_CONTENT = {
  'evidence:submit': 'submitOrder creates a receipt before returning it.',
  'evidence:notify': 'notifyOrder emits a notification after submission.'
}

/**
 * Повертає strict successful semantic verification response.
 * @param {string} claimId canonical claim identity
 * @returns {string} strict JSON response
 */
function entailed(claimId) {
  return JSON.stringify({ claimId, entails: true, unsupportedFields: [] })
}

describe('verifyEvidenceEntailment', () => {
  test('passes supported implemented and expected claims without rewriting them', async () => {
    const submitBatchImpl = vi.fn((tier, items) =>
      Promise.resolve(items.map(item => ({ customId: item.customId, ok: entailed(item.customId) })))
    )
    const inputGraph = graph()

    const result = await verifyEvidenceEntailment({
      graph: inputGraph,
      evidenceContentById: EVIDENCE_CONTENT,
      submitBatchImpl
    })

    expect(result).toMatchObject({ ok: true, claims: [IMPLEMENTED, EXPECTED] })
    expect(result.claims).toBe(inputGraph.claims)
    expect(submitBatchImpl).toHaveBeenCalledTimes(1)
    expect(submitBatchImpl.mock.calls[0][0]).toBe('min')
    expect(submitBatchImpl.mock.calls[0][1][0].prompt).toContain(EVIDENCE_CONTENT['evidence:submit'])
  })

  test('blocks unrelated or contradictory claims after the strict ladder', async () => {
    const submitBatchImpl = vi.fn((tier, items) =>
      Promise.resolve(items.map(item => ({ customId: item.customId, ok: JSON.stringify({ claimId: item.customId, entails: false, unsupportedFields: ['value'] }) })))
    )

    const result = await verifyEvidenceEntailment({
      graph: graph(),
      evidenceContentById: EVIDENCE_CONTENT,
      submitBatchImpl
    })

    expect(result).toMatchObject({ ok: false })
    expect(result.diagnostics.map(item => item.code)).toEqual(['claim-not-entailed', 'claim-not-entailed'])
    expect(submitBatchImpl.mock.calls.map(call => call[0])).toEqual(['min', 'avg', 'max'])
  })

  test('escalates malformed responses only for unresolved claims', async () => {
    const submitBatchImpl = vi.fn((tier, items) =>
      Promise.resolve(
        items.map(item => ({ customId: item.customId, ok: tier === 'min' ? '{not json' : entailed(item.customId) }))
      )
    )

    const result = await verifyEvidenceEntailment({
      graph: graph([IMPLEMENTED]),
      evidenceContentById: EVIDENCE_CONTENT,
      submitBatchImpl
    })

    expect(result.ok).toBe(true)
    expect(submitBatchImpl.mock.calls.map(call => call[0])).toEqual(['min', 'avg'])
    expect(submitBatchImpl.mock.calls[1][1].map(item => item.customId)).toEqual([IMPLEMENTED.id])
  })

  test('uses unchanged successful per-claim cache without a model call', async () => {
    const cache = { entries: {} }
    const first = vi.fn((tier, items) =>
      Promise.resolve(items.map(item => ({ customId: item.customId, ok: entailed(item.customId) })))
    )
    const input = { graph: graph(), evidenceContentById: EVIDENCE_CONTENT, cache }
    const initial = await verifyEvidenceEntailment({ ...input, submitBatchImpl: first })
    const second = vi.fn()
    const cached = await verifyEvidenceEntailment({ ...input, submitBatchImpl: second })

    expect(initial.ok).toBe(true)
    expect(cached).toEqual(initial)
    expect(second).not.toHaveBeenCalled()
  })

  test('blocks any claim that lacks local evidence content before model submission', async () => {
    const submitBatchImpl = vi.fn()
    const result = await verifyEvidenceEntailment({
      graph: graph(),
      evidenceContentById: { 'evidence:submit': EVIDENCE_CONTENT['evidence:submit'] },
      submitBatchImpl
    })

    expect(result).toMatchObject({ ok: false, diagnostics: [expect.objectContaining({ code: 'missing-evidence-content', claimId: EXPECTED.id })] })
    expect(submitBatchImpl).not.toHaveBeenCalled()
  })

  test('accepts an empty graph without invoking transport', async () => {
    const submitBatchImpl = vi.fn()
    const result = await verifyEvidenceEntailment({ graph: graph([]), evidenceContentById: {}, submitBatchImpl })

    expect(result).toMatchObject({ ok: true, claims: [] })
    expect(submitBatchImpl).not.toHaveBeenCalled()
  })

  test('fails invalid verifier inputs before transport', async () => {
    const transport = vi.fn()
    const invalidGraph = await verifyEvidenceEntailment({ graph: {}, evidenceContentById: {}, submitBatchImpl: transport })
    const invalidPolicy = await verifyEvidenceEntailment({ graph: graph([IMPLEMENTED]), evidenceContentById: EVIDENCE_CONTENT, modelPolicy: ['min'], submitBatchImpl: transport })
    const invalidVersion = await verifyEvidenceEntailment({ graph: graph([IMPLEMENTED]), evidenceContentById: EVIDENCE_CONTENT, promptVersion: '', submitBatchImpl: transport })
    const blankMapContent = await verifyEvidenceEntailment({ graph: graph([IMPLEMENTED]), evidenceContentById: new Map([['evidence:submit', '']]), submitBatchImpl: transport })

    expect(invalidGraph).toMatchObject({ ok: false, diagnostics: [{ code: 'invalid-entailment-graph' }] })
    expect(invalidPolicy).toMatchObject({ ok: false, diagnostics: [{ code: 'invalid-entailment-model-policy' }] })
    expect(invalidVersion).toMatchObject({ ok: false, diagnostics: [{ code: 'invalid-entailment-version' }] })
    expect(blankMapContent).toMatchObject({ ok: false, diagnostics: [{ code: 'missing-evidence-content' }] })
    expect(transport).not.toHaveBeenCalled()
  })
})

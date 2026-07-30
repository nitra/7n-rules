/** Tests for immutable, evidence-backed expected overlay application. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import { applyExpectedOverlay } from '../expected-overlay.mjs'

const FIXTURE = join(import.meta.dirname, 'fixtures', 'gaps', 'base-graph.json')
const SUBJECT_ID = 'code-unit:npm:@fixture/orders:js:submitOrder'

/**
 * Читає pristine base graph fixture.
 * @returns {Promise<Record<string, unknown>>} graph fixture
 */
async function baseGraph() {
  return JSON.parse(await readFile(FIXTURE, 'utf8'))
}

describe('applyExpectedOverlay', () => {
  test('adds explicit expected claim immutably in stable order', async () => {
    const graph = await baseGraph()
    const result = applyExpectedOverlay(graph, {
      claims: [
        {
          id: 'claim:expected:order-accepted',
          subjectId: SUBJECT_ID,
          predicate: 'order-status',
          value: 'accepted',
          evidenceIds: ['evidence:spec'],
          confidence: 1,
          sourceFingerprint: 'expected-hash'
        }
      ]
    })

    expect(result.ok).toBe(true)
    expect(graph.claims).toHaveLength(1)
    expect(result.graph.claims.map(claim => claim.id)).toEqual([
      'claim:expected:order-accepted',
      'claim:implemented:accepts-order'
    ])
    expect(result.graph.claims[0].layer).toBe('expected')
  })

  test('blocks expectation without evidence instead of publishing unsupported intent', async () => {
    const result = applyExpectedOverlay(await baseGraph(), {
      claims: [
        {
          id: 'claim:expected:no-evidence',
          subjectId: SUBJECT_ID,
          predicate: 'order-status',
          value: 'accepted',
          evidenceIds: [],
          confidence: 1,
          sourceFingerprint: 'expected-hash'
        }
      ]
    })

    expect(result).toEqual({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'expected-without-evidence' })]
    })
  })

  test('blocks references to a subject outside the domain graph', async () => {
    const result = applyExpectedOverlay(await baseGraph(), {
      claims: [
        {
          id: 'claim:expected:outside',
          subjectId: 'code-unit:npm:@other:js:outside',
          predicate: 'order-status',
          value: 'accepted',
          evidenceIds: ['evidence:spec'],
          confidence: 1,
          sourceFingerprint: 'expected-hash'
        }
      ]
    })

    expect(result).toEqual({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'unknown-expected-subject' })]
    })
  })

  test('adds new expectation evidence and rejects malformed overlay contracts', async () => {
    const graph = await baseGraph()
    const added = applyExpectedOverlay(graph, {
      evidence: [{ id: 'evidence:new-spec', kind: 'spec', path: 'docs/new.md', contentHash: 'new-hash' }],
      claims: [
        {
          id: 'claim:expected:new',
          subjectId: SUBJECT_ID,
          predicate: 'order-status',
          value: 'reviewed',
          evidenceIds: ['evidence:new-spec'],
          confidence: 1,
          sourceFingerprint: 'expected-new'
        }
      ]
    })

    expect(added.ok).toBe(true)
    expect(added.graph.evidence).toContainEqual(expect.objectContaining({ id: 'evidence:new-spec' }))
    expect(applyExpectedOverlay(null)).toMatchObject({ ok: false })
    expect(applyExpectedOverlay({})).toMatchObject({ ok: false })
    expect(applyExpectedOverlay(graph, { claims: {}, evidence: [] })).toMatchObject({ ok: false })
  })

  test('blocks duplicate, unknown and invalid expectation evidence', async () => {
    const graph = await baseGraph()
    const baseClaim = {
      id: 'claim:expected:invalid',
      subjectId: SUBJECT_ID,
      predicate: 'order-status',
      value: 'accepted',
      evidenceIds: ['evidence:missing'],
      confidence: 1,
      sourceFingerprint: 'expected-hash'
    }

    expect(
      applyExpectedOverlay(graph, {
        evidence: [{ id: 'evidence:spec' }, { id: 'evidence:duplicate' }, { id: 'evidence:duplicate' }],
        claims: [
          baseClaim,
          { ...baseClaim, id: 'claim:expected:layer', layer: 'implemented', evidenceIds: ['evidence:spec'] },
          { ...baseClaim, id: 'claim:implemented:accepts-order', evidenceIds: ['evidence:spec'] },
          { ...baseClaim, id: 'claim:expected:confidence', confidence: 2, evidenceIds: ['evidence:spec'] }
        ]
      })
    ).toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'duplicate-evidence-id' }),
        expect.objectContaining({ code: 'unknown-expected-evidence' }),
        expect.objectContaining({ code: 'invalid-expected-layer' }),
        expect.objectContaining({ code: 'duplicate-claim-id' }),
        expect.objectContaining({ code: 'invalid-expected-confidence' })
      ])
    })
  })
})

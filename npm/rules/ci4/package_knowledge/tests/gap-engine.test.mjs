/** Tests for deterministic evidence-backed expected versus implemented gaps. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import { applyExpectedOverlay } from '../expected-overlay.mjs'
import { evaluateGaps } from '../gap-engine.mjs'

const FIXTURE = join(import.meta.dirname, 'fixtures', 'gaps', 'base-graph.json')
const EXPECTED_ID = 'claim:expected:order-accepted'
const IMPLEMENTED_ID = 'claim:implemented:accepts-order'
const SUBJECT_ID = 'code-unit:npm:@fixture/orders:js:submitOrder'

/**
 * Створює graph з одним explicit expectation.
 * @param {Record<string, unknown>} [overrides] expected claim overrides
 * @returns {Promise<Record<string, unknown>>} overlaid graph
 */
async function graphWithExpectation(overrides = {}) {
  const graph = JSON.parse(await readFile(FIXTURE, 'utf8'))
  const result = applyExpectedOverlay(graph, {
    claims: [
      {
        id: EXPECTED_ID,
        subjectId: SUBJECT_ID,
        predicate: 'order-status',
        value: 'accepted',
        evidenceIds: ['evidence:spec'],
        confidence: 1,
        sourceFingerprint: 'expected-hash',
        ...overrides
      }
    ]
  })
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics))
  return result.graph
}

describe('evaluateGaps', () => {
  test('returns no gap when graph has no explicit expectation', async () => {
    const graph = JSON.parse(await readFile(FIXTURE, 'utf8'))
    expect(evaluateGaps({ graph })).toEqual({ ok: true, gaps: [] })
  })

  test('marks an exact evidence-backed equivalent mapping as satisfied', async () => {
    const result = evaluateGaps({
      graph: await graphWithExpectation(),
      mappings: [
        {
          expectedClaimId: EXPECTED_ID,
          implementedClaimId: IMPLEMENTED_ID,
          relation: 'equivalent',
          evidenceIds: ['evidence:mapping']
        }
      ]
    })

    expect(result).toEqual({
      ok: true,
      gaps: [
        expect.objectContaining({
          id: `gap:${EXPECTED_ID}`,
          status: 'satisfied',
          expectedClaimId: EXPECTED_ID,
          implementedClaimIds: [IMPLEMENTED_ID],
          evidenceIds: ['evidence:code', 'evidence:mapping', 'evidence:spec']
        })
      ]
    })
  })

  test('marks an evidence-backed expectation without mapping as missing', async () => {
    const result = evaluateGaps({ graph: await graphWithExpectation() })
    expect(result.gaps[0]).toMatchObject({ status: 'missing', implementedClaimIds: [] })
  })

  test('marks an exact contradictory mapping as diverged', async () => {
    const result = evaluateGaps({
      graph: await graphWithExpectation(),
      mappings: [
        {
          expectedClaimId: EXPECTED_ID,
          implementedClaimId: IMPLEMENTED_ID,
          relation: 'contradicts',
          evidenceIds: ['evidence:mapping']
        }
      ]
    })
    expect(result.gaps[0].status).toBe('diverged')
  })

  test('keeps low-confidence implementation and ambiguous mappings unresolved', async () => {
    const lowConfidenceGraph = await graphWithExpectation()
    lowConfidenceGraph.claims.find(claim => claim.id === IMPLEMENTED_ID).confidence = 0.5
    const lowConfidence = evaluateGaps({
      graph: lowConfidenceGraph,
      mappings: [
        {
          expectedClaimId: EXPECTED_ID,
          implementedClaimId: IMPLEMENTED_ID,
          relation: 'equivalent',
          evidenceIds: ['evidence:mapping']
        }
      ]
    })
    const ambiguous = evaluateGaps({
      graph: await graphWithExpectation(),
      mappings: [
        {
          expectedClaimId: EXPECTED_ID,
          implementedClaimId: IMPLEMENTED_ID,
          relation: 'equivalent',
          evidenceIds: ['evidence:mapping']
        },
        {
          expectedClaimId: EXPECTED_ID,
          implementedClaimId: IMPLEMENTED_ID,
          relation: 'contradicts',
          evidenceIds: ['evidence:mapping']
        }
      ]
    })

    expect(lowConfidence.gaps[0].status).toBe('unresolved')
    expect(ambiguous.gaps[0].status).toBe('unresolved')
  })

  test('returns parser and coverage blockers instead of unresolved gaps', async () => {
    const parser = evaluateGaps({
      graph: await graphWithExpectation(),
      validation: { parser: { ok: false, message: 'Syntax error' } }
    })
    const coverage = evaluateGaps({
      graph: await graphWithExpectation(),
      validation: { coverage: { ok: false, message: 'Required edge missing' } }
    })

    expect(parser).toEqual({ ok: false, diagnostics: [{ code: 'parser-blocked', message: 'Syntax error' }] })
    expect(coverage).toEqual({
      ok: false,
      diagnostics: [{ code: 'coverage-blocked', message: 'Required edge missing' }]
    })
  })
})

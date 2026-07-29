/** Tests for immutable, evidence-backed expected overlay application. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import { applyExpectedOverlay } from '../expected-overlay.mjs'

const FIXTURE = join(import.meta.dirname, 'fixtures', 'gaps', 'base-graph.json')
const SUBJECT_ID = 'code-unit:npm:@fixture/orders:js:submitOrder'

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
})

/** Tests for deterministic Expected source discovery and strict graph mapping. */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, test, vi } from 'vitest'

import { withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'
import { collectActiveTestScenarios, discoverExpectedSources, mapExpectedSources, parseExpectedSourceResult } from '../expected-sources.mjs'

const DOMAIN_ID = 'npm:@fixture/orders'
const SUBJECT_ID = 'code-unit:npm:@fixture/orders:js:submit'

/**
 * Створює graph з canonical node/evidence IDs для strict Expected mapping.
 * @returns {object} minimal graph
 */
function graph() {
  return {
    domain: { id: DOMAIN_ID },
    nodes: [{ id: SUBJECT_ID }],
    evidence: [{ id: 'evidence:code' }]
  }
}

/**
 * Створює один explicit source зі власним evidence reference.
 * @returns {object} source fixture
 */
function source() {
  return {
    id: 'source:spec:orders',
    content: 'Orders must be accepted.',
    anchor: 'spec:orders',
    evidence: { id: 'evidence:expected:spec', kind: 'spec', path: 'docs/specs/orders.md', contentHash: 'sha256:spec' }
  }
}

describe('Expected source discovery', () => {
  test('collects EXPECTED zone, scoped accepted ADR/spec and active assertion scenario in stable order', async () => {
    await withTmpDir(async root => {
      await mkdir(join(root, 'docs', 'adr'), { recursive: true })
      await mkdir(join(root, 'docs', 'specs'), { recursive: true })
      await mkdir(join(root, 'tests'), { recursive: true })
      await writeFile(join(root, 'docs', 'index.md'), '<!-- EXPECTED:start id="accept-order" -->Order must be accepted.<!-- EXPECTED:end id="accept-order" -->')
      await writeFile(join(root, 'docs', 'adr', 'accepted.md'), `<!-- PACKAGE-KNOWLEDGE:domain id="${DOMAIN_ID}" -->\n**Status:** Accepted\n\nUse accepted orders.\n`)
      await writeFile(join(root, 'docs', 'adr', 'draft.md'), `<!-- PACKAGE-KNOWLEDGE:domain id="${DOMAIN_ID}" -->\n**Status:** Proposed\n`)
      await writeFile(join(root, 'docs', 'specs', 'orders.md'), `<!-- PACKAGE-KNOWLEDGE:domain id="${DOMAIN_ID}" -->\n# Orders\n\nOrders need review.\n`)
      await writeFile(join(root, 'tests', 'orders.test.mjs'), "test('accepts an order', () => { expect(save()).toBe(true) })\ntest.skip('disabled alone', () => { expect(save()).toBe(true) })\n")

      const result = await discoverExpectedSources({ repoRoot: root, domain: { id: DOMAIN_ID, root } })

      expect(result).toMatchObject({ ok: true })
      expect(result.sources.map(item => item.evidence.kind).toSorted()).toEqual(['adr', 'manual', 'spec', 'test'])
      expect(result.sources.map(item => item.evidence.path)).toContain('tests/orders.test.mjs')
      expect(result.sources).toHaveLength(4)
    })
  })

  test('does not turn disabled tests into expectation without a corroborating source', () => {
    const result = collectActiveTestScenarios("test.skip('disabled', () => { expect(save()).toBe(true) })", 'tests/orders.test.mjs')

    expect(result).toEqual({ ok: true, scenarios: [] })
  })

  test('blocks a non-JS test until its language adapter supplies a full parser', async () => {
    await withTmpDir(async root => {
      await mkdir(join(root, 'tests'), { recursive: true })
      await writeFile(join(root, 'tests', 'orders.py'), 'def test_accepts_order():\n    assert save()\n')

      const result = await discoverExpectedSources({ repoRoot: root, domain: { id: DOMAIN_ID, root } })

      expect(result).toEqual({
        ok: false,
        diagnostics: [expect.objectContaining({ code: 'expected-test-parser-missing', path: 'tests/orders.py' })]
      })
    })
  })
})

describe('Expected source mapping', () => {
  test('returns empty overlay without sources and makes no model call', async () => {
    const transport = vi.fn()
    const result = await mapExpectedSources({ graph: graph(), sources: [], submitBatchImpl: transport })

    expect(result).toMatchObject({ ok: true, overlay: { claims: [], evidence: [] } })
    expect(transport).not.toHaveBeenCalled()
  })

  test('maps one source locally, rejects unknown references, and reuses deterministic cache', async () => {
    const cache = { entries: {} }
    const transport = vi.fn(() =>
      Promise.resolve([
        {
          customId: 'source:spec:orders',
          ok: JSON.stringify({
            claims: [{ subjectId: SUBJECT_ID, predicate: 'order-status', value: 'accepted', evidenceIds: ['evidence:expected:spec'], confidence: 1 }]
          })
        }
      ])
    )
    const first = await mapExpectedSources({ graph: graph(), sources: [source()], cache, submitBatchImpl: transport })
    const secondTransport = vi.fn()
    const second = await mapExpectedSources({ graph: graph(), sources: [source()], cache, submitBatchImpl: secondTransport })

    expect(first).toMatchObject({ ok: true, overlay: { claims: [expect.objectContaining({ subjectId: SUBJECT_ID })], evidence: [expect.objectContaining({ id: 'evidence:expected:spec' })] } })
    expect(transport).toHaveBeenCalledWith('min', expect.any(Array))
    expect(second).toMatchObject({ ok: true, overlay: { claims: [expect.any(Object)] } })
    expect(secondTransport).not.toHaveBeenCalled()
    expect(
      parseExpectedSourceResult(
        JSON.stringify({ claims: [{ subjectId: 'code-unit:unknown', predicate: 'x', value: true, evidenceIds: ['evidence:unknown'], confidence: 1 }] }),
        { nodeIds: new Set([SUBJECT_ID]), evidenceIds: new Set(['evidence:expected:spec']) },
        source()
      )
    ).toEqual({ ok: false, reason: 'unknown-expected-mapping-reference' })
  })
})

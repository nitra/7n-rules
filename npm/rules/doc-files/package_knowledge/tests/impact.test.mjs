import { describe, expect, test } from 'vitest'

import { createImpactSlice } from '../impact.mjs'
import { discoverTopics } from '../topic-discovery.mjs'

const DOMAIN_ID = 'npm:@fixture/orders'
const SUBMIT_ID = `code-unit:${DOMAIN_ID}:js:src/orders.mjs#submitOrder`
const PRIVATE_ID = `code-unit:${DOMAIN_ID}:js:src/orders.mjs#persistOrder`
const CONTRACT_ID = 'contract:payments'

/**
 * Створює graph, де private helper впливає на public flow, але не має витекти
 * до impact output як symbol name або identifier.
 * @returns {Record<string, unknown>} fixture graph
 */
function graphFixture() {
  return {
    domain: { id: DOMAIN_ID },
    nodes: [
      {
        id: SUBMIT_ID,
        kind: 'code-unit',
        name: 'submitOrder',
        visibility: 'public',
        domainId: DOMAIN_ID,
        attributes: { sourcePath: 'src/orders.mjs' }
      },
      {
        id: PRIVATE_ID,
        kind: 'code-unit',
        name: 'persistOrder',
        visibility: 'private',
        domainId: DOMAIN_ID,
        attributes: { sourcePath: 'src/persistence.mjs' }
      },
      {
        id: CONTRACT_ID,
        kind: 'integration',
        name: 'payments',
        visibility: 'external',
        domainId: DOMAIN_ID,
        attributes: {}
      },
      {
        id: 'config:orders',
        kind: 'config',
        name: 'orders config',
        visibility: 'private',
        domainId: DOMAIN_ID,
        attributes: { sourcePath: 'config/orders.json' }
      },
      {
        id: 'code-unit:foreign:js:outside',
        kind: 'code-unit',
        name: 'outside',
        visibility: 'public',
        domainId: 'npm:foreign',
        attributes: { sourcePath: '../outside.mjs' }
      }
    ],
    edges: [
      { id: 'edge:submit-private', fromId: SUBMIT_ID, toId: PRIVATE_ID, evidenceIds: ['e:code'] },
      { id: 'edge:private-contract', fromId: PRIVATE_ID, toId: CONTRACT_ID, evidenceIds: ['e:contract'] },
      { id: 'edge:private-config', fromId: PRIVATE_ID, toId: 'config:orders', evidenceIds: ['e:config'] }
    ],
    evidence: [
      { id: 'e:code', kind: 'code', path: 'src/orders.mjs', symbolId: SUBMIT_ID },
      { id: 'e:contract', kind: 'code', path: 'src/persistence.mjs', symbolId: PRIVATE_ID },
      { id: 'e:config', kind: 'config', path: 'config/orders.json', symbolId: PRIVATE_ID },
      { id: 'e:test', kind: 'test', path: 'tests/orders.test.mjs', symbolId: PRIVATE_ID },
      { id: 'e:outside', kind: 'test', path: '../outside.test.mjs', symbolId: PRIVATE_ID }
    ]
  }
}

describe('createImpactSlice', () => {
  test('returns domain-contained impact sets without private symbol names', () => {
    const graph = graphFixture()
    const topic = discoverTopics(graph)[0]
    const result = createImpactSlice({ graph, topics: [topic], topicId: topic.id })

    expect(result).toEqual({
      ok: true,
      slice: {
        domain: { id: DOMAIN_ID },
        topics: [{ id: topic.id, kind: 'process', title: 'submitOrder', aliases: [] }],
        files: ['src/orders.mjs', 'src/persistence.mjs'],
        tests: ['tests/orders.test.mjs'],
        contracts: [{ id: CONTRACT_ID, name: 'payments' }],
        configs: ['config/orders.json']
      }
    })
    expect(JSON.stringify(result)).not.toContain('persistOrder')
  })

  test('accepts topic alias and rejects a topic from another domain', () => {
    const graph = graphFixture()
    const topic = { ...discoverTopics(graph)[0], aliases: ['process:legacy-order'] }

    expect(createImpactSlice({ graph, topics: [topic], topicId: 'process:legacy-order' })).toMatchObject({ ok: true })
    expect(
      createImpactSlice({ graph, topics: [{ ...topic, domainId: 'npm:foreign' }], topicId: topic.id })
    ).toMatchObject({ ok: false, code: 'topic-outside-domain' })
  })
})

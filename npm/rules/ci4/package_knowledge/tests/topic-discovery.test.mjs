import { describe, expect, test } from 'vitest'

import { collectReachableNodeIds, discoverTopics, resolveTopic } from '../topic-discovery.mjs'

const DOMAIN_ID = 'npm:@fixture/orders'
const SUBMIT_ID = `code-unit:${DOMAIN_ID}:js:src/orders.mjs#submitOrder`
const PRIVATE_ID = `code-unit:${DOMAIN_ID}:js:src/orders.mjs#persistOrder`
const OUTCOME_ID = 'outcome:order-created'
const CONTRACT_ID = 'contract:payments'

/**
 * Створює малий evidence-backed graph із public entry point та private detail.
 * @param {string} [publicName] змінний display name для перевірки stable topic ID
 * @returns {Record<string, unknown>} deterministic graph fixture
 */
function graphFixture(publicName = 'submitOrder') {
  return {
    domain: { id: DOMAIN_ID },
    nodes: [
      { id: SUBMIT_ID, kind: 'code-unit', name: publicName, visibility: 'public', domainId: DOMAIN_ID },
      { id: PRIVATE_ID, kind: 'code-unit', name: 'persistOrder', visibility: 'private', domainId: DOMAIN_ID },
      { id: OUTCOME_ID, kind: 'outcome', name: 'Order created', visibility: 'public', domainId: DOMAIN_ID },
      { id: CONTRACT_ID, kind: 'integration', name: 'payments', visibility: 'external', domainId: DOMAIN_ID },
      {
        id: 'code-unit:foreign:js:outside',
        kind: 'code-unit',
        name: 'outside',
        visibility: 'public',
        domainId: 'npm:foreign'
      }
    ],
    edges: [
      { id: 'edge:submit-private', fromId: SUBMIT_ID, toId: PRIVATE_ID, evidenceIds: ['e:submit-private'] },
      { id: 'edge:private-outcome', fromId: PRIVATE_ID, toId: OUTCOME_ID, evidenceIds: ['e:private-outcome'] },
      { id: 'edge:private-contract', fromId: PRIVATE_ID, toId: CONTRACT_ID, evidenceIds: ['e:private-contract'] },
      { id: 'edge:without-evidence', fromId: PRIVATE_ID, toId: 'code-unit:foreign:js:outside', evidenceIds: [] }
    ]
  }
}

describe('discoverTopics', () => {
  test('uses public flow anchors and title-independent stable identity', () => {
    const initial = discoverTopics(graphFixture())
    const renamed = discoverTopics(graphFixture('placeOrder'))

    expect(initial).toHaveLength(1)
    expect(initial[0]).toMatchObject({
      kind: 'process',
      title: 'submitOrder',
      domainId: DOMAIN_ID,
      anchorIds: [SUBMIT_ID, OUTCOME_ID, CONTRACT_ID].toSorted()
    })
    expect(renamed[0]).toMatchObject({ id: initial[0].id, title: 'placeOrder' })
    expect(initial[0].id).not.toContain('submitOrder')
    expect(collectReachableNodeIds(graphFixture(), [SUBMIT_ID])).toEqual(
      [CONTRACT_ID, OUTCOME_ID, PRIVATE_ID, SUBMIT_ID].toSorted()
    )
  })

  test('keeps explicit aliases and resolves them to the canonical topic', () => {
    const canonical = discoverTopics(graphFixture())[0]
    const topics = discoverTopics(graphFixture(), { aliasesByTopicId: { [canonical.id]: ['process:legacy-order'] } })

    expect(topics[0].aliases).toEqual(['process:legacy-order'])
    expect(resolveTopic(topics, 'process:legacy-order')).toMatchObject({ id: canonical.id })
  })
})

import { describe, expect, test } from 'vitest'

import { reconcileTopicIdentities } from '../identity-migration.mjs'

const DOMAIN_ID = 'npm:@fixture/orders'
const OUTCOME_ID = 'outcome:order-created'

/**
 * Створює semantic graph для topic identity migration fixtures.
 * @param {{ publicId: string, publicName?: string, publicFingerprint?: string, topicId: string, title?: string }} input graph variation
 * @returns {Record<string, unknown>} graph з одним public process topic
 */
function graph({
  publicId,
  publicName = 'submitOrder',
  publicFingerprint = 'sha256:submit',
  topicId,
  title = publicName
}) {
  return {
    domain: { id: DOMAIN_ID },
    nodes: [
      {
        id: publicId,
        kind: 'code-unit',
        name: publicName,
        visibility: 'public',
        domainId: DOMAIN_ID,
        attributes: { unitKind: 'function', signature: `${publicName}(order)` },
        sourceFingerprint: publicFingerprint
      },
      {
        id: OUTCOME_ID,
        kind: 'outcome',
        name: 'Order created',
        visibility: 'public',
        domainId: DOMAIN_ID,
        attributes: {},
        sourceFingerprint: 'sha256:outcome'
      }
    ],
    edges: [{ id: `edge:${publicId}`, fromId: publicId, toId: OUTCOME_ID, kind: 'produces', evidenceIds: ['e:flow'] }],
    topics: [
      { id: topicId, kind: 'process', title, domainId: DOMAIN_ID, anchorIds: [publicId, OUTCOME_ID], aliases: [] }
    ]
  }
}

/**
 * Повертає topic migration result між old manifest і fresh graph.
 * @param {Record<string, unknown>} previousManifest committed graph/manifest
 * @param {Record<string, unknown>} nextGraph newly discovered graph
 * @param {Record<string, unknown>} [options] optional protected registry
 * @returns {ReturnType<typeof reconcileTopicIdentities>} reconciliation result
 */
function reconcile(previousManifest, nextGraph, options = {}) {
  return reconcileTopicIdentities({
    previousManifest,
    graph: nextGraph,
    topics: nextGraph.topics,
    ...options
  })
}

describe('reconcileTopicIdentities', () => {
  test('keeps topic ID, aliases and narrative mapping when an unchanged file moves', () => {
    const oldId = 'process:order-submit'
    const previous = graph({
      publicId: `code-unit:${DOMAIN_ID}:js:src/orders.mjs#submitOrder`,
      topicId: oldId
    })
    previous.topics[0].aliases = ['process:legacy-submit']
    const next = graph({
      publicId: `code-unit:${DOMAIN_ID}:js:src/flows/order-submit.mjs#submitOrder`,
      topicId: 'process:generated-new',
      title: 'Submit an order'
    })

    const result = reconcile(previous, next)

    expect(result).toMatchObject({ ok: true, migrationPlan: { status: 'resolved' } })
    expect(result.topics).toEqual([
      expect.objectContaining({ id: oldId, title: 'Submit an order', aliases: ['process:legacy-submit'] })
    ])
  })

  test('recognizes a symbol rename from semantic signature and graph neighborhood', () => {
    const oldId = 'process:order-submit'
    const previous = graph({
      publicId: `code-unit:${DOMAIN_ID}:js:src/orders.mjs#submitOrder`,
      topicId: oldId
    })
    const next = graph({
      publicId: `code-unit:${DOMAIN_ID}:js:src/orders.mjs#placeOrder`,
      publicName: 'placeOrder',
      publicFingerprint: 'sha256:changed-source',
      topicId: 'process:generated-new'
    })

    const result = reconcile(previous, next)

    expect(result).toMatchObject({ ok: true })
    expect(result.topics[0]).toMatchObject({ id: oldId, title: 'placeOrder' })
    expect(result.migrationPlan.mappings).toContainEqual(
      expect.objectContaining({ fromTopicId: oldId, reason: 'semantic-rename' })
    )
  })

  test('blocks ambiguous splits and merges with an explicit migration plan', () => {
    const previous = graph({
      publicId: `code-unit:${DOMAIN_ID}:js:src/orders.mjs#submitOrder`,
      topicId: 'process:old'
    })
    const split = {
      ...graph({
        publicId: `code-unit:${DOMAIN_ID}:js:src/orders.mjs#submitDomesticOrder`,
        publicName: 'submitDomesticOrder',
        topicId: 'process:domestic'
      }),
      nodes: [],
      edges: [],
      topics: []
    }
    const first = graph({
      publicId: `code-unit:${DOMAIN_ID}:js:src/orders.mjs#submitDomesticOrder`,
      publicName: 'submitDomesticOrder',
      topicId: 'process:domestic'
    })
    const second = graph({
      publicId: `code-unit:${DOMAIN_ID}:js:src/orders.mjs#submitInternationalOrder`,
      publicName: 'submitInternationalOrder',
      topicId: 'process:international'
    })
    split.nodes = [...first.nodes.filter(node => node.id !== OUTCOME_ID), ...second.nodes]
    split.edges = [...first.edges, ...second.edges]
    split.topics = [...first.topics, ...second.topics]

    const splitResult = reconcile(previous, split)
    const mergePrevious = {
      ...split,
      topics: split.topics.map(topic => ({ ...topic, aliases: [] }))
    }
    const merged = graph({
      publicId: `code-unit:${DOMAIN_ID}:js:src/orders.mjs#submitOrder`,
      topicId: 'process:merged'
    })

    expect(splitResult).toMatchObject({ ok: false, migrationPlan: { status: 'blocked' } })
    expect(splitResult.diagnostics).toContainEqual(expect.objectContaining({ code: 'ambiguous-topic-split' }))
    const mergeResult = reconcile(mergePrevious, merged)
    expect(mergeResult).toMatchObject({ ok: false, migrationPlan: { status: 'blocked' } })
    expect(mergeResult.diagnostics).toContainEqual(expect.objectContaining({ code: 'ambiguous-topic-merge' }))
  })

  test('preserves a protected MANUAL/EXPECTED registry only through an unambiguous mapping', () => {
    const oldId = 'process:order-submit'
    const previous = graph({
      publicId: `code-unit:${DOMAIN_ID}:js:src/orders.mjs#submitOrder`,
      topicId: oldId
    })
    const next = graph({
      publicId: `code-unit:${DOMAIN_ID}:js:src/flows/order-submit.mjs#submitOrder`,
      topicId: 'process:generated-new'
    })
    const registry = {
      [oldId]: [
        { id: 'order-context', kind: 'MANUAL', content: 'Keep the operational context.' },
        { id: 'must-create', kind: 'EXPECTED', content: 'Must create an order.' }
      ]
    }

    const result = reconcile(previous, next, { protectedZonesByTopicId: registry })

    expect(result).toMatchObject({ ok: true, protectedZonesByTopicId: registry })
    const unmatched = graph({
      publicId: `code-unit:${DOMAIN_ID}:js:src/other.mjs#cancelOrder`,
      publicName: 'cancelOrder',
      publicFingerprint: 'sha256:cancel',
      topicId: 'process:cancel-order'
    })
    unmatched.topics[0].kind = 'contract'
    expect(reconcile(previous, unmatched, { protectedZonesByTopicId: registry })).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'protected-zone-migration-unresolved' })]
    })
  })

  test('orders mappings and topics identically regardless of input ordering', () => {
    const first = graph({ publicId: `code-unit:${DOMAIN_ID}:js:src/a.mjs#submitOrder`, topicId: 'process:old-a' })
    const second = graph({ publicId: `code-unit:${DOMAIN_ID}:js:src/b.mjs#submitOrder`, topicId: 'process:old-b' })
    const previous = {
      ...first,
      nodes: [...first.nodes.filter(node => node.id !== OUTCOME_ID), ...second.nodes],
      edges: [...first.edges, ...second.edges],
      topics: [...first.topics, ...second.topics]
    }
    const nextFirst = graph({
      publicId: `code-unit:${DOMAIN_ID}:js:src/new-a.mjs#submitOrder`,
      topicId: 'process:new-a'
    })
    const nextSecond = graph({
      publicId: `code-unit:${DOMAIN_ID}:js:src/new-b.mjs#submitOrder`,
      topicId: 'process:new-b'
    })
    const next = {
      ...nextFirst,
      nodes: [...nextFirst.nodes.filter(node => node.id !== OUTCOME_ID), ...nextSecond.nodes],
      edges: [...nextFirst.edges, ...nextSecond.edges],
      topics: [...nextFirst.topics, ...nextSecond.topics]
    }

    expect(reconcile(previous, next)).toEqual(
      reconcile(
        {
          ...previous,
          nodes: [...previous.nodes].toReversed(),
          edges: [...previous.edges].toReversed(),
          topics: [...previous.topics].toReversed()
        },
        {
          ...next,
          nodes: [...next.nodes].toReversed(),
          edges: [...next.edges].toReversed(),
          topics: [...next.topics].toReversed()
        }
      )
    )
  })
})

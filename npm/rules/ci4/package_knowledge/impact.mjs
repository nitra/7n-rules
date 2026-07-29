/**
 * Будує privacy-safe impact slice для одного package-knowledge topic.
 *
 * Slice використовує private units лише як внутрішні traversal vertices. Назви
 * та identifiers private symbols не повертаються, тоді як affected files,
 * tests, configs і external contracts лишаються доступними для change plan.
 */

import { collectReachableNodeIds, resolveTopic } from './topic-discovery.mjs'

/**
 * Порівнює strings у stable order.
 * @param {string} left перше значення
 * @param {string} right друге значення
 * @returns {number} comparison result
 */
function compareStrings(left, right) {
  return left.localeCompare(right)
}

/**
 * Перевіряє, що projected path лишається в межах domain root.
 * @param {unknown} path repo-relative evidence path
 * @returns {path is string} true для safe relative path
 */
function isDomainPath(path) {
  return (
    typeof path === 'string' &&
    path !== '' &&
    !path.startsWith('/') &&
    !path.split('/').some(segment => segment === '..' || segment === '')
  )
}

/**
 * Вибирає evidence, що належить reachable topic closure.
 * @param {Record<string, unknown>} graph normalized graph
 * @param {Set<string>} reachableIds closure node IDs
 * @returns {Array<Record<string, unknown>>} evidence у deterministic order
 */
function reachableEvidence(graph, reachableIds) {
  const edgeEvidenceIds = new Set(
    (Array.isArray(graph?.edges) ? graph.edges : [])
      .filter(edge => reachableIds.has(edge?.fromId) && reachableIds.has(edge?.toId))
      .flatMap(edge => (Array.isArray(edge.evidenceIds) ? edge.evidenceIds : []))
  )
  return (Array.isArray(graph?.evidence) ? graph.evidence : [])
    .filter(
      item => item && (reachableIds.has(item.symbolId) || edgeEvidenceIds.has(item.id)) && isDomainPath(item.path)
    )
    .toSorted((left, right) => String(left.id).localeCompare(String(right.id)))
}

/**
 * Формує compact public topic projection без symbol-level anchors.
 * @param {Record<string, unknown>} topic selected topic
 * @returns {{ id: string, kind: string, title: string, aliases: string[] }} safe topic metadata
 */
function publicTopic(topic) {
  return {
    id: topic.id,
    kind: topic.kind,
    title: topic.title,
    aliases: [
      ...new Set(Array.isArray(topic.aliases) ? topic.aliases.filter(alias => typeof alias === 'string') : [])
    ].toSorted(compareStrings)
  }
}

/**
 * Повертає domain-contained impact set за topic ID або alias.
 * @param {{ graph: Record<string, unknown>, topics: Array<Record<string, unknown>>, topicId: string }} input graph, topics і target
 * @returns {{ ok: true, slice: Record<string, unknown> } | { ok: false, code: string, detail: string }} slice або structured failure
 */
export function createImpactSlice({ graph, topics, topicId }) {
  const domainId = graph?.domain?.id
  if (typeof domainId !== 'string' || domainId === '') {
    return { ok: false, code: 'invalid-domain', detail: 'Graph не має owning domain ID.' }
  }
  const topic = resolveTopic(topics, topicId)
  if (!topic) return { ok: false, code: 'topic-not-found', detail: `Topic "${String(topicId)}" не знайдено.` }
  if (topic.domainId !== domainId) {
    return { ok: false, code: 'topic-outside-domain', detail: `Topic "${topic.id}" не належить domain "${domainId}".` }
  }

  const nodes = (Array.isArray(graph.nodes) ? graph.nodes : []).filter(node => node?.domainId === domainId)
  const nodeById = new Map(nodes.filter(node => typeof node.id === 'string').map(node => [node.id, node]))
  const reachableIds = new Set(collectReachableNodeIds(graph, Array.isArray(topic.anchorIds) ? topic.anchorIds : []))
  const evidence = reachableEvidence(graph, reachableIds)
  const files = new Set()
  const configs = new Set()
  const tests = new Set(evidence.filter(item => item.kind === 'test').map(item => item.path))
  const contracts = []

  for (const id of reachableIds) {
    const node = nodeById.get(id)
    if (!node) continue
    if (node.kind === 'code-unit' && isDomainPath(node.attributes?.sourcePath)) files.add(node.attributes.sourcePath)
    if (node.kind === 'config' && isDomainPath(node.attributes?.sourcePath)) configs.add(node.attributes.sourcePath)
    if (node.kind === 'test' && isDomainPath(node.attributes?.sourcePath)) tests.add(node.attributes.sourcePath)
    if (node.kind === 'integration' && node.visibility === 'external') {
      contracts.push({ id: node.id, name: typeof node.name === 'string' ? node.name : node.id })
    }
  }
  for (const item of evidence) {
    if (item.kind === 'code') files.add(item.path)
    if (item.kind === 'config') configs.add(item.path)
  }

  return {
    ok: true,
    slice: {
      domain: { id: domainId },
      topics: [publicTopic(topic)],
      files: [...files].toSorted(compareStrings),
      tests: [...tests].toSorted(compareStrings),
      contracts: contracts
        .filter((contract, index, all) => all.findIndex(candidate => candidate.id === contract.id) === index)
        .toSorted((left, right) => compareStrings(left.id, right.id)),
      configs: [...configs].toSorted(compareStrings)
    }
  }
}

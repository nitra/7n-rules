/**
 * Відкриває детерміновані package-knowledge topics із normalized graph.
 *
 * Public entry points є первинними seeds. Outcome та external integration
 * стають окремими seeds лише коли їх не охоплює public flow. Це зберігає
 * компактні process topics, не залежить від LLM title і не вимагає показувати
 * private implementation у наступних projections.
 */

import { createHash } from 'node:crypto'

/**
 * Повертає короткий stable digest для topic identity.
 * @param {unknown} value canonical identity input
 * @returns {string} перші 24 hex-символи SHA-256
 */
function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24)
}

/**
 * Порівнює string identifiers у одному deterministic порядку.
 * @param {string} left перший ID
 * @param {string} right другий ID
 * @returns {number} результат locale comparison
 */
function compareIds(left, right) {
  return left.localeCompare(right)
}

/**
 * Повертає node collection лише для owning domain.
 * @param {Record<string, unknown>} graph normalized graph
 * @returns {Array<Record<string, unknown>>} domain-local nodes у stable order
 */
function domainNodes(graph) {
  const domainId = graph?.domain?.id
  if (typeof domainId !== 'string' || !Array.isArray(graph?.nodes)) return []
  return graph.nodes
    .filter(node => node && node.domainId === domainId && typeof node.id === 'string')
    .toSorted((left, right) => compareIds(left.id, right.id))
}

/**
 * Будує adjacency лише з evidence-backed domain-local edges.
 * @param {Record<string, unknown>} graph normalized graph
 * @returns {Map<string, string[]>} source ID → sorted reachable target IDs
 */
function adjacency(graph) {
  const nodes = domainNodes(graph)
  const ids = new Set(nodes.map(node => node.id))
  const targetsBySource = new Map(nodes.map(node => [node.id, new Set()]))
  for (const edge of Array.isArray(graph?.edges) ? graph.edges : []) {
    if (
      !edge ||
      typeof edge.fromId !== 'string' ||
      typeof edge.toId !== 'string' ||
      !ids.has(edge.fromId) ||
      !ids.has(edge.toId) ||
      !Array.isArray(edge.evidenceIds) ||
      edge.evidenceIds.length === 0
    ) {
      continue
    }
    targetsBySource.get(edge.fromId).add(edge.toId)
  }
  return new Map([...targetsBySource].map(([id, targets]) => [id, [...targets].toSorted(compareIds)]))
}

/**
 * Знаходить directed reachable closure. Cyclic SCC потрапляє цілком, бо обхід
 * продовжується до fixed point тільки за підтвердженими edges.
 * @param {Record<string, unknown>} graph normalized graph
 * @param {string[]} anchors domain-local start IDs
 * @returns {string[]} sorted closure IDs
 */
export function collectReachableNodeIds(graph, anchors) {
  const links = adjacency(graph)
  const pending = [...new Set((Array.isArray(anchors) ? anchors : []).filter(id => links.has(id)))].toSorted(compareIds)
  const visited = new Set()
  while (pending.length > 0) {
    const id = pending.shift()
    if (visited.has(id)) continue
    visited.add(id)
    for (const target of links.get(id) ?? []) {
      if (!visited.has(target)) pending.push(target)
    }
    pending.sort(compareIds)
  }
  return [...visited].toSorted(compareIds)
}

/**
 * Визначає, чи node є externally visible contract boundary.
 * @param {Record<string, unknown>} node graph node
 * @returns {boolean} true для external integration
 */
function isExternalIntegration(node) {
  return node.kind === 'integration' && node.visibility === 'external'
}

/**
 * Формує safe display title без private symbol name.
 * @param {Record<string, unknown>} seed deterministic topic seed
 * @returns {string} human title, що не бере private node name
 */
function titleForSeed(seed) {
  if (seed.visibility === 'public' && typeof seed.name === 'string' && seed.name !== '') return seed.name
  if (isExternalIntegration(seed) && typeof seed.name === 'string' && seed.name !== '') return seed.name
  if (seed.kind === 'outcome' && seed.visibility !== 'private' && typeof seed.name === 'string' && seed.name !== '') {
    return seed.name
  }
  return 'Domain outcome'
}

/**
 * Додає explicit historical aliases до canonical topic без дублювання ID.
 * @param {string} topicId canonical topic ID
 * @param {Record<string, string[]>} aliasesByTopicId topic ID → historical aliases
 * @returns {string[]} stable aliases
 */
function aliasesForTopic(topicId, aliasesByTopicId) {
  const aliases = aliasesByTopicId?.[topicId]
  if (!Array.isArray(aliases)) return []
  return [...new Set(aliases.filter(alias => typeof alias === 'string' && alias !== '' && alias !== topicId))].toSorted(
    compareIds
  )
}

/**
 * Відкриває stable process/contract topics із graph seeds.
 *
 * Integration та outcome не дублюють topic public entry point, якщо він уже
 * evidence-backed досягає відповідної boundary. Інакше вони лишаються
 * standalone seed, що важливо для event-driven або contract-only domain.
 * @param {Record<string, unknown>} graph normalized graph
 * @param {{ aliasesByTopicId?: Record<string, string[]> }} [options] persisted redirects
 * @returns {Array<{ id: string, kind: string, title: string, domainId: string, anchorIds: string[], aliases: string[] }>} topics у stable order
 */
export function discoverTopics(graph, { aliasesByTopicId = {} } = {}) {
  const domainId = graph?.domain?.id
  if (typeof domainId !== 'string' || domainId === '') return []
  const nodes = domainNodes(graph)
  const nodeById = new Map(nodes.map(node => [node.id, node]))
  const publicSeeds = nodes.filter(node => node.kind === 'code-unit' && node.visibility === 'public')
  const covered = new Set(publicSeeds.flatMap(seed => collectReachableNodeIds(graph, [seed.id])))
  const boundarySeeds = nodes.filter(
    node => (node.kind === 'outcome' || isExternalIntegration(node)) && !covered.has(node.id)
  )
  const seeds = [...publicSeeds, ...boundarySeeds].toSorted((left, right) => compareIds(left.id, right.id))

  return seeds
    .map(seed => {
      const closure = collectReachableNodeIds(graph, [seed.id])
      const outcomeIds = closure.filter(id => nodeById.get(id)?.kind === 'outcome')
      const contractIds = closure.filter(id => isExternalIntegration(nodeById.get(id)))
      const anchorIds = [seed.id, ...outcomeIds, ...contractIds]
        .filter((id, index, all) => all.indexOf(id) === index)
        .toSorted(compareIds)
      const kind = isExternalIntegration(seed) ? 'contract' : 'process'
      const id = `${kind}:${domainId}:${digest({ seedId: seed.id, outcomeIds, contractIds })}`
      return {
        id,
        kind,
        title: titleForSeed(seed),
        domainId,
        anchorIds,
        aliases: aliasesForTopic(id, aliasesByTopicId)
      }
    })
    .toSorted((left, right) => compareIds(left.id, right.id))
}

/**
 * Шукає canonical topic за його current ID або historical alias.
 * @param {Array<Record<string, unknown>>} topics topics одного domain
 * @param {string} idOrAlias canonical ID або alias
 * @returns {Record<string, unknown> | null} знайдений topic або null
 */
export function resolveTopic(topics, idOrAlias) {
  if (!Array.isArray(topics) || typeof idOrAlias !== 'string') return null
  return (
    topics.find(
      topic => topic?.id === idOrAlias || (Array.isArray(topic?.aliases) && topic.aliases.includes(idOrAlias))
    ) ?? null
  )
}

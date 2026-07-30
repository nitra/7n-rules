/**
 * Зіставляє previous і newly discovered topics, щоб rename не втрачав stable
 * identity або protected narrative. Невизначений split/merge повертає plan і
 * блокує candidate замість вибору за порядком обходу.
 */

const MINIMUM_MATCH_SCORE = 0.75

/**
 * Порівнює strings у детермінованому порядку.
 * @param {string} left first value
 * @param {string} right second value
 * @returns {number} locale comparison
 */
function compareStrings(left, right) {
  return left.localeCompare(right)
}

/**
 * Повертає унікальні string values у canonical order.
 * @param {unknown} values candidate values
 * @returns {string[]} normalized values
 */
function sortedStrings(values) {
  return [
    ...new Set(Array.isArray(values) ? values.filter(value => typeof value === 'string' && value !== '') : [])
  ].toSorted(compareStrings)
}

/**
 * Нормалізує signature без parser-specific symbol name, тому перейменування
 * function/class не змінює semantic signature.
 * @param {unknown} value parser signature
 * @returns {string} comparable signature
 */
function semanticSignature(value) {
  if (typeof value !== 'string' || value === '') return ''
  return value.replaceAll(/[A-Za-z_$][\w$]*/gu, '<id>')
}

/**
 * Повертає частку спільних елементів двох set-подібних колекцій.
 * @param {string[]} left first collection
 * @param {string[]} right second collection
 * @returns {number} overlap from 0 to 1
 */
function overlap(left, right) {
  const all = new Set([...left, ...right])
  if (all.size === 0) return 0
  const rightSet = new Set(right)
  return left.filter(value => rightSet.has(value)).length / all.size
}

/**
 * Витягує безпечний topic → protected zones registry з compatibility forms.
 * @param {Record<string, unknown>} manifest previous manifest
 * @param {Record<string, unknown> | undefined} supplied explicit registry
 * @returns {Record<string, unknown[]>} canonical topic registry
 */
function protectedRegistry(manifest, supplied) {
  const source = supplied ?? manifest?.protectedZonesByTopicId ?? manifest?.zoneRegistry ?? {}
  if (!source || typeof source !== 'object' || Array.isArray(source)) return {}
  return Object.fromEntries(
    Object.entries(source)
      .filter(([topicId, zones]) => typeof topicId === 'string' && topicId !== '' && Array.isArray(zones))
      .map(([topicId, zones]) => [topicId, zones])
      .toSorted(([left], [right]) => compareStrings(left, right))
  )
}

/**
 * Будує node descriptor без path/name, щоб у fingerprint входила поведінка, а
 * не фізичне розташування або presentation title.
 * @param {Record<string, unknown>} node graph node
 * @returns {string} stable semantic node label
 */
function nodeSemanticKey(node) {
  const attributes = node?.attributes && typeof node.attributes === 'object' ? node.attributes : {}
  return JSON.stringify({
    kind: typeof node?.kind === 'string' ? node.kind : '',
    visibility: typeof node?.visibility === 'string' ? node.visibility : '',
    unitKind: typeof attributes.unitKind === 'string' ? attributes.unitKind : '',
    signature: semanticSignature(attributes.signature)
  })
}

/**
 * Будує adjacency labels незалежно від unstable code-unit IDs.
 * @param {Record<string, unknown>} graph knowledge graph
 * @returns {Map<string, string[]>} node ID to sorted neighborhood labels
 */
function neighborhoods(graph) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : []
  const nodeById = new Map(nodes.filter(node => typeof node?.id === 'string').map(node => [node.id, node]))
  const values = new Map(Array.from(nodeById.keys(), id => [id, []]))
  for (const edge of Array.isArray(graph?.edges) ? graph.edges : []) {
    if (!edge || typeof edge.fromId !== 'string' || typeof edge.toId !== 'string' || typeof edge.kind !== 'string')
      continue
    const from = nodeById.get(edge.fromId)
    const to = nodeById.get(edge.toId)
    if (!from || !to) continue
    values.get(from.id).push(`out:${edge.kind}:${nodeSemanticKey(to)}`)
    values.get(to.id).push(`in:${edge.kind}:${nodeSemanticKey(from)}`)
  }
  return new Map(Array.from(values, ([id, labels]) => [id, sortedStrings(labels)]))
}

/**
 * Профілює topic anchors для rename-preserving comparison.
 * @param {Record<string, unknown>} graph knowledge graph
 * @param {Record<string, unknown>} topic topic record
 * @param {Map<string, string[]>} graphNeighborhoods reusable graph adjacency
 * @returns {{ semantic: string[], fingerprints: string[], neighborhood: string[] }} comparison profile
 */
function topicProfile(graph, topic, graphNeighborhoods) {
  const nodeById = new Map(
    (Array.isArray(graph?.nodes) ? graph.nodes : [])
      .filter(node => typeof node?.id === 'string')
      .map(node => [node.id, node])
  )
  const anchors = sortedStrings(topic?.anchorIds)
  const nodes = anchors.map(id => nodeById.get(id)).filter(Boolean)
  return {
    semantic: sortedStrings(nodes.map(node => nodeSemanticKey(node))),
    fingerprints: sortedStrings(nodes.map(node => node.sourceFingerprint)),
    neighborhood: sortedStrings(nodes.flatMap(node => graphNeighborhoods.get(node.id) ?? []))
  }
}

/**
 * Вимірює достатньо сильну topic similarity. Signature і neighborhood
 * переживають symbol rename, exact implementation fingerprints — file move.
 * @param {Record<string, unknown>} previousGraph previous manifest graph
 * @param {Record<string, unknown>} nextGraph new graph
 * @param {Record<string, unknown>} previousTopic old topic
 * @param {Record<string, unknown>} nextTopic new topic
 * @param {Map<string, string[]>} previousNeighborhoods old adjacency
 * @param {Map<string, string[]>} nextNeighborhoods new adjacency
 * @returns {number} weighted similarity from 0 to 1
 */
function similarity(previousGraph, nextGraph, previousTopic, nextTopic, previousNeighborhoods, nextNeighborhoods) {
  const left = topicProfile(previousGraph, previousTopic, previousNeighborhoods)
  const right = topicProfile(nextGraph, nextTopic, nextNeighborhoods)
  const semantic = overlap(left.semantic, right.semantic)
  const fingerprints = overlap(left.fingerprints, right.fingerprints)
  const neighborhood = overlap(left.neighborhood, right.neighborhood)
  return Number((semantic * 0.4 + fingerprints * 0.35 + neighborhood * 0.25).toFixed(6))
}

/**
 * Формує machine-readable migration diagnostic.
 * @param {string} code stable failure code
 * @param {string} detail human explanation
 * @param {string[]} previousTopicIds old candidates
 * @param {string[]} nextTopicIds new candidates
 * @returns {{code: string, detail: string, previousTopicIds: string[], nextTopicIds: string[]}} diagnostic
 */
function diagnostic(code, detail, previousTopicIds, nextTopicIds) {
  return { code, detail, previousTopicIds: sortedStrings(previousTopicIds), nextTopicIds: sortedStrings(nextTopicIds) }
}

/**
 * Нормалізує topics із manifest або discovery до stable ID order.
 * @param {unknown} value candidate topic collection
 * @returns {Array<Record<string, unknown>>} valid topics
 */
function validTopics(value) {
  return (Array.isArray(value) ? value : [])
    .filter(topic => typeof topic?.id === 'string')
    .toSorted((left, right) => compareStrings(left.id, right.id))
}

/**
 * Зберігає вже однакові stable IDs як безумовні mappings.
 * @param {Array<Record<string, unknown>>} previousTopics old topics
 * @param {Array<Record<string, unknown>>} nextTopics new topics
 * @returns {{ mappings: Array<Record<string, unknown>>, previousIds: Set<string>, nextIds: Set<string> }} exact mappings
 */
function stableMappings(previousTopics, nextTopics) {
  const nextIds = new Set(nextTopics.map(topic => topic.id))
  const mappings = previousTopics
    .filter(topic => nextIds.has(topic.id))
    .map(topic => ({ fromTopicId: topic.id, toTopicId: topic.id, score: 1, reason: 'stable-id' }))
  return {
    mappings,
    previousIds: new Set(mappings.map(mapping => mapping.fromTopicId)),
    nextIds: new Set(mappings.map(mapping => mapping.toTopicId))
  }
}

/**
 * Знаходить усі sufficiently strong rename candidates без вибору winner.
 * @param {{ previousManifest: Record<string, unknown>, graph: Record<string, unknown>, previousTopics: Array<Record<string, unknown>>, nextTopics: Array<Record<string, unknown>>, resolvedPreviousIds: Set<string>, resolvedNextIds: Set<string> }} input comparison inputs
 * @returns {Array<Record<string, unknown>>} deterministic candidate mappings
 */
function migrationCandidates({
  previousManifest,
  graph,
  previousTopics,
  nextTopics,
  resolvedPreviousIds,
  resolvedNextIds
}) {
  const previousNeighborhoods = neighborhoods(previousManifest)
  const nextNeighborhoods = neighborhoods(graph)
  const candidates = []
  for (const previousTopic of previousTopics) {
    if (resolvedPreviousIds.has(previousTopic.id)) continue
    for (const nextTopic of nextTopics) {
      if (resolvedNextIds.has(nextTopic.id) || previousTopic.kind !== nextTopic.kind) continue
      const score = similarity(
        previousManifest,
        graph,
        previousTopic,
        nextTopic,
        previousNeighborhoods,
        nextNeighborhoods
      )
      if (score >= MINIMUM_MATCH_SCORE)
        candidates.push({ fromTopicId: previousTopic.id, toTopicId: nextTopic.id, score })
    }
  }
  return candidates.toSorted(
    (left, right) =>
      left.fromTopicId.localeCompare(right.fromTopicId) ||
      left.toTopicId.localeCompare(right.toTopicId) ||
      right.score - left.score
  )
}

/**
 * Повертає blocking split/merge diagnostics без залежності від input order.
 * @param {Array<Record<string, unknown>>} candidates potential rename mappings
 * @returns {Array<Record<string, unknown>>} ambiguity diagnostics
 */
function ambiguityDiagnostics(candidates) {
  const byPrevious = new Map()
  const byNext = new Map()
  for (const candidate of candidates) {
    byPrevious.set(candidate.fromTopicId, [...(byPrevious.get(candidate.fromTopicId) ?? []), candidate])
    byNext.set(candidate.toTopicId, [...(byNext.get(candidate.toTopicId) ?? []), candidate])
  }
  const diagnostics = []
  for (const [topicId, matches] of byPrevious) {
    if (matches.length > 1)
      diagnostics.push(
        diagnostic(
          'ambiguous-topic-split',
          `Topic ${topicId} має кілька однаково придатних successor topics; потрібен explicit migration plan.`,
          [topicId],
          matches.map(match => match.toTopicId)
        )
      )
  }
  for (const [topicId, matches] of byNext) {
    if (matches.length > 1)
      diagnostics.push(
        diagnostic(
          'ambiguous-topic-merge',
          `Topic ${topicId} має кілька predecessor topics; потрібен explicit migration plan.`,
          matches.map(match => match.fromTopicId),
          [topicId]
        )
      )
  }
  return diagnostics
}

/**
 * Гарантує, що protected registry не лишається без canonical topic owner.
 * @param {Record<string, unknown[]>} registry previous protected zones
 * @param {Array<Record<string, unknown>>} mappings accepted mappings
 * @returns {Array<Record<string, unknown>>} blocking diagnostics
 */
function protectedZoneDiagnostics(registry, mappings) {
  const mapped = new Set(mappings.map(mapping => mapping.fromTopicId))
  return Object.entries(registry)
    .filter(([topicId, zones]) => zones.length > 0 && !mapped.has(topicId))
    .map(([topicId]) =>
      diagnostic(
        'protected-zone-migration-unresolved',
        `Protected MANUAL/EXPECTED zones topic ${topicId} не мають однозначного topic mapping.`,
        [topicId],
        []
      )
    )
}

/**
 * Повертає fresh topics зі старими canonical IDs та aliases.
 * @param {Array<Record<string, unknown>>} nextTopics newly discovered topics
 * @param {Map<string, Record<string, unknown>>} previousById old topics index
 * @param {Array<Record<string, unknown>>} mappings accepted mappings
 * @returns {Array<Record<string, unknown>>} reconciled topics
 */
function applyMappings(nextTopics, previousById, mappings) {
  const canonicalTopics = new Map(
    nextTopics.map(topic => [topic.id, { ...topic, aliases: sortedStrings(topic.aliases) }])
  )
  for (const mapping of mappings) {
    const previousTopic = previousById.get(mapping.fromTopicId)
    const nextTopic = canonicalTopics.get(mapping.toTopicId)
    if (!previousTopic || !nextTopic) continue
    canonicalTopics.delete(mapping.toTopicId)
    canonicalTopics.set(mapping.fromTopicId, {
      ...nextTopic,
      id: mapping.fromTopicId,
      aliases: sortedStrings([...(previousTopic.aliases ?? []), ...(nextTopic.aliases ?? [])])
    })
  }
  return canonicalTopics
    .values()
    .toArray()
    .toSorted((left, right) => compareStrings(left.id, right.id))
}

/**
 * Reconciles newly discovered topics against a committed manifest. Exact IDs
 * remain unchanged; a unique high-confidence rename receives the old canonical
 * ID and retains its aliases. Split/merge and protected-zone uncertainty return
 * an explicit plan without silently selecting a topic.
 * @param {{ previousManifest?: Record<string, unknown>, graph: Record<string, unknown>, topics: Array<Record<string, unknown>>, protectedZonesByTopicId?: Record<string, unknown[]> }} input migration inputs
 * @returns {{ ok: true, topics: Array<Record<string, unknown>>, protectedZonesByTopicId: Record<string, unknown[]>, migrationPlan: { status: 'resolved', mappings: Array<Record<string, unknown>> } } | { ok: false, diagnostics: Array<Record<string, unknown>>, migrationPlan: { status: 'blocked', mappings: Array<Record<string, unknown>> } }} reconciled topics or blocking plan
 */
export function reconcileTopicIdentities({ previousManifest, graph, topics, protectedZonesByTopicId } = {}) {
  const nextTopics = validTopics(topics)
  if (!previousManifest) {
    return {
      ok: true,
      topics: nextTopics,
      protectedZonesByTopicId: {},
      migrationPlan: { status: 'resolved', mappings: [] }
    }
  }
  const previousTopics = validTopics(previousManifest.topics)
  const registry = protectedRegistry(previousManifest, protectedZonesByTopicId)
  const previousById = new Map(previousTopics.map(topic => [topic.id, topic]))
  const stable = stableMappings(previousTopics, nextTopics)
  const candidates = migrationCandidates({
    previousManifest,
    graph,
    previousTopics,
    nextTopics,
    resolvedPreviousIds: stable.previousIds,
    resolvedNextIds: stable.nextIds
  })
  const ambiguity = ambiguityDiagnostics(candidates)
  const mappings =
    ambiguity.length === 0
      ? [...stable.mappings, ...candidates.map(candidate => ({ ...candidate, reason: 'semantic-rename' }))]
      : stable.mappings
  const diagnostics = [...ambiguity, ...protectedZoneDiagnostics(registry, mappings)]
  if (diagnostics.length > 0) {
    return {
      ok: false,
      diagnostics: diagnostics.toSorted((left, right) =>
        `${left.code}:${left.previousTopicIds.join(',')}`.localeCompare(
          `${right.code}:${right.previousTopicIds.join(',')}`
        )
      ),
      migrationPlan: {
        status: 'blocked',
        mappings: mappings.toSorted((left, right) => compareStrings(left.fromTopicId, right.fromTopicId))
      }
    }
  }

  const transferredZones = {}
  for (const [topicId, zones] of Object.entries(registry)) transferredZones[topicId] = zones
  return {
    ok: true,
    topics: applyMappings(nextTopics, previousById, mappings),
    protectedZonesByTopicId: transferredZones,
    migrationPlan: {
      status: 'resolved',
      mappings: mappings.toSorted((left, right) => compareStrings(left.fromTopicId, right.fromTopicId))
    }
  }
}

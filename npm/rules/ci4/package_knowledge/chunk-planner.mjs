/**
 * Планує bounded semantic chunks і dependency waves для package knowledge.
 *
 * Planner працює лише з already-normalized graph і точними UTF-8 source spans.
 * Він не виконує LLM calls і не публікує документацію: результат є
 * детермінованим execution plan для map/reduce orchestration.
 */

import { createHash } from 'node:crypto'

const DEFAULT_MAX_TOKENS = 1200
const DEFAULT_REDUCE_INPUTS = 8

/**
 * Повертає stable blocking diagnostic.
 * @param {string} code machine-readable code
 * @param {string} detail human-readable explanation
 * @param {string | null} [path] related source path
 * @returns {{code: string, detail: string, path: string | null}} diagnostic
 */
function diagnostic(code, detail, path = null) {
  return { code, detail, path }
}

/**
 * Створює SHA-256 fingerprint для stable IDs і cache keys.
 * @param {unknown} value canonical input
 * @returns {string} prefixed SHA-256 hash
 */
function fingerprint(value) {
  return `sha256:${createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex')}`
}

/**
 * Рекурсивно стабілізує object keys перед hashing і serialization.
 * @param {unknown} value arbitrary value
 * @returns {unknown} canonical value
 */
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(item => canonicalize(item))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)])
  )
}

/**
 * Порівнює IDs у canonical lexical order.
 * @param {{id: string}} left left item
 * @param {{id: string}} right right item
 * @returns {number} sort result
 */
function compareById(left, right) {
  return left.id.localeCompare(right.id)
}

/**
 * Перевіряє, чи byte offset не розрізає UTF-8 continuation byte.
 * @param {Buffer} bytes UTF-8 source bytes
 * @param {number} offset requested boundary
 * @returns {boolean} whether the offset is a code-point boundary
 */
function isUtf8Boundary(bytes, offset) {
  const byte = bytes[offset]
  return offset === 0 || offset === bytes.length || byte < 128 || byte > 191
}

/**
 * Оцінює upper-bound-like prompt cost без tokenizer-specific drift.
 * @param {number} byteLength UTF-8 byte length
 * @param {number} [overhead] deterministic structural token allowance
 * @returns {number} estimated token count
 */
function estimateTokens(byteLength, overhead = 0) {
  return Math.max(1, Math.ceil(byteLength / 4) + overhead)
}

/**
 * Нормалізує source texts у path index і блокує некоректні inputs.
 * @param {unknown} sources source inputs
 * @returns {{ok: true, byPath: Map<string, {path: string, content: string, bytes: Buffer, contentHash: string}>} | {ok: false, diagnostics: Array<Record<string, unknown>>}} normalized sources or diagnostics
 */
function indexSources(sources) {
  if (!Array.isArray(sources)) {
    return { ok: false, diagnostics: [diagnostic('invalid-sources', 'sources мусить бути масивом.')] }
  }
  const byPath = new Map()
  const diagnostics = []
  for (const source of sources) {
    if (!source || typeof source.path !== 'string' || source.path === '' || typeof source.content !== 'string') {
      diagnostics.push(diagnostic('invalid-source', 'Кожен source мусить мати непорожній path і string content.'))
      continue
    }
    if (byPath.has(source.path)) {
      diagnostics.push(diagnostic('duplicate-source', `Повторний source path "${source.path}".`, source.path))
      continue
    }
    const bytes = Buffer.from(source.content, 'utf8')
    byPath.set(source.path, {
      path: source.path,
      content: source.content,
      bytes,
      contentHash: fingerprint({ path: source.path, content: source.content })
    })
  }
  return diagnostics.length > 0 ? { ok: false, diagnostics: sortDiagnostics(diagnostics) } : { ok: true, byPath }
}

/**
 * Витягає exact source slice і блокує відсутній, out-of-range або broken UTF-8 span.
 * @param {Map<string, {path: string, content: string, bytes: Buffer, contentHash: string}>} sources source index
 * @param {unknown} path source path
 * @param {unknown} span half-open UTF-8 byte span
 * @param {string} owner source node or edge identifier
 * @returns {{ok: true, slice: Record<string, unknown>} | {ok: false, diagnostic: Record<string, unknown>}} slice or diagnostic
 */
function sourceSlice(sources, path, span, owner) {
  if (typeof path !== 'string' || path === '' || !sources.has(path)) {
    return {
      ok: false,
      diagnostic: diagnostic(
        'source-missing',
        `Не знайдено source для ${owner}.`,
        typeof path === 'string' ? path : null
      )
    }
  }
  if (
    !span ||
    typeof span !== 'object' ||
    !Number.isSafeInteger(span.startByte) ||
    !Number.isSafeInteger(span.endByte) ||
    span.startByte < 0 ||
    span.endByte < span.startByte
  ) {
    return { ok: false, diagnostic: diagnostic('span-invalid', `${owner} не має валідного UTF-8 byte span.`, path) }
  }
  const source = sources.get(path)
  if (
    span.endByte > source.bytes.length ||
    !isUtf8Boundary(source.bytes, span.startByte) ||
    !isUtf8Boundary(source.bytes, span.endByte)
  ) {
    return {
      ok: false,
      diagnostic: diagnostic('span-invalid', `${owner} span виходить за межі або розрізає UTF-8 code point.`, path)
    }
  }
  const text = source.bytes.subarray(span.startByte, span.endByte).toString('utf8')
  return {
    ok: true,
    slice: {
      path,
      span: { startByte: span.startByte, endByte: span.endByte },
      text,
      contentHash: source.contentHash
    }
  }
}

/**
 * Повертає required code-unit IDs або перевіряє explicit required set.
 * @param {Record<string, unknown>} graph normalized graph
 * @param {unknown} requiredNodeIds optional caller-defined required IDs
 * @returns {{ok: true, ids: string[]} | {ok: false, diagnostics: Array<Record<string, unknown>>}} IDs or diagnostics
 */
function resolveRequiredNodes(graph, requiredNodeIds) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : null
  if (!nodes) return { ok: false, diagnostics: [diagnostic('invalid-graph', 'graph.nodes мусить бути масивом.')] }
  const nodeById = new Map()
  const diagnostics = []
  for (const node of nodes) {
    if (!node || typeof node.id !== 'string' || node.id === '') {
      diagnostics.push(diagnostic('node-invalid', 'Кожен graph node мусить мати stable id.'))
      continue
    }
    if (nodeById.has(node.id)) diagnostics.push(diagnostic('node-duplicate', `Повторний node ID "${node.id}".`))
    nodeById.set(node.id, node)
  }
  const requested =
    requiredNodeIds === undefined
      ? nodes.filter(node => node?.kind === 'code-unit').map(node => node.id)
      : requiredNodeIds
  if (!Array.isArray(requested) || requested.some(id => typeof id !== 'string' || id === '')) {
    diagnostics.push(diagnostic('required-nodes-invalid', 'requiredNodeIds мусить бути масивом непорожніх IDs.'))
  }
  const ids = [...new Set(Array.isArray(requested) ? requested : [])].toSorted()
  for (const id of ids) {
    if (!nodeById.has(id))
      diagnostics.push(diagnostic('required-node-missing', `Required node "${id}" відсутній у graph.`))
  }
  return diagnostics.length > 0 ? { ok: false, diagnostics: sortDiagnostics(diagnostics) } : { ok: true, ids, nodeById }
}

/**
 * Нормалізує required edges і забезпечує, що їх source належить planned units.
 * @param {Record<string, unknown>} graph normalized graph
 * @param {Set<string>} requiredNodes planned node IDs
 * @param {unknown} requiredEdgeIds optional caller-defined required IDs
 * @returns {{ok: true, edges: Array<Record<string, unknown>>} | {ok: false, diagnostics: Array<Record<string, unknown>>}} edges or diagnostics
 */
function resolveRequiredEdges(graph, requiredNodes, requiredEdgeIds) {
  const edges = Array.isArray(graph?.edges) ? graph.edges : null
  if (!edges) return { ok: false, diagnostics: [diagnostic('invalid-graph', 'graph.edges мусить бути масивом.')] }
  const edgeById = new Map()
  const diagnostics = []
  for (const edge of edges) {
    if (!edge || typeof edge.id !== 'string' || edge.id === '') {
      diagnostics.push(diagnostic('edge-invalid', 'Кожен graph edge мусить мати stable id.'))
      continue
    }
    if (edgeById.has(edge.id)) diagnostics.push(diagnostic('edge-duplicate', `Повторний edge ID "${edge.id}".`))
    edgeById.set(edge.id, edge)
  }
  const requested = requiredEdgeIds === undefined ? edges.map(edge => edge?.id) : requiredEdgeIds
  if (!Array.isArray(requested) || requested.some(id => typeof id !== 'string' || id === '')) {
    diagnostics.push(diagnostic('required-edges-invalid', 'requiredEdgeIds мусить бути масивом непорожніх IDs.'))
  }
  const selected = []
  for (const id of [...new Set(Array.isArray(requested) ? requested : [])].toSorted()) {
    const edge = edgeById.get(id)
    if (!edge) {
      diagnostics.push(diagnostic('required-edge-missing', `Required edge "${id}" відсутній у graph.`))
      continue
    }
    if (typeof edge.fromId !== 'string' || !requiredNodes.has(edge.fromId)) {
      diagnostics.push(diagnostic('edge-source-not-planned', `Edge "${id}" має source поза required nodes.`))
      continue
    }
    selected.push(edge)
  }
  return diagnostics.length > 0
    ? { ok: false, diagnostics: sortDiagnostics(diagnostics) }
    : { ok: true, edges: selected }
}

/**
 * Матеріалізує source slice одного required unit.
 * @param {string} nodeId graph node ID
 * @param {Map<string, Record<string, unknown>>} nodeById node index
 * @param {Map<string, Record<string, unknown>>} sources source index
 * @returns {{ok: true, unit: Record<string, unknown>} | {ok: false, diagnostic: Record<string, unknown>}} unit input or diagnostic
 */
function materializeUnit(nodeId, nodeById, sources) {
  const node = nodeById.get(nodeId)
  const result = sourceSlice(sources, node?.attributes?.sourcePath, node?.attributes?.span, `node "${nodeId}"`)
  if (!result.ok) return result
  return {
    ok: true,
    unit: { id: nodeId, slice: result.slice, cost: estimateTokens(Buffer.byteLength(result.slice.text, 'utf8'), 12) }
  }
}

/**
 * Матеріалізує provenance slices одного edge без partial evidence.
 * @param {Record<string, unknown>} edge normalized edge
 * @param {Map<string, Record<string, unknown>>} evidenceById graph evidence index
 * @param {Map<string, Record<string, unknown>>} sources source index
 * @returns {{ok: true, edge: Record<string, unknown>} | {ok: false, diagnostics: Array<Record<string, unknown>>}} edge input or diagnostics
 */
function materializeEdge(edge, evidenceById, sources) {
  if (!Array.isArray(edge.evidenceIds) || edge.evidenceIds.length === 0) {
    return { ok: false, diagnostics: [diagnostic('edge-evidence-missing', `Edge "${edge.id}" не має evidence IDs.`)] }
  }
  const evidenceSlices = []
  const diagnostics = []
  for (const evidenceId of new Set(edge.evidenceIds).values().toArray().toSorted()) {
    const evidence = evidenceById.get(evidenceId)
    if (evidence) {
      const result = sourceSlice(sources, evidence.path, evidence.span, `evidence "${evidenceId}"`)
      if (result.ok) evidenceSlices.push({ id: evidenceId, ...result.slice })
      else diagnostics.push(result.diagnostic)
    } else
      diagnostics.push(
        diagnostic('edge-evidence-missing', `Edge "${edge.id}" посилається на відсутнє evidence "${evidenceId}".`)
      )
  }
  if (diagnostics.length > 0) return { ok: false, diagnostics }
  return {
    ok: true,
    edge: {
      id: edge.id,
      fromId: edge.fromId,
      toId: typeof edge.toId === 'string' ? edge.toId : null,
      evidenceSlices,
      cost: 16 + evidenceSlices.reduce((sum, item) => sum + estimateTokens(Buffer.byteLength(item.text, 'utf8')), 0)
    }
  }
}

/**
 * Матеріалізує unit і edge source slices, не допускаючи partial prompt inputs.
 * @param {{nodeById: Map<string, Record<string, unknown>>, nodeIds: string[], edges: Array<Record<string, unknown>>, graph: Record<string, unknown>, sources: Map<string, Record<string, unknown>>}} input planner inputs
 * @returns {{ok: true, units: Map<string, Record<string, unknown>>, edges: Array<Record<string, unknown>>} | {ok: false, diagnostics: Array<Record<string, unknown>>}} materialized inputs or diagnostics
 */
function materializeInputs({ nodeById, nodeIds, edges, graph, sources }) {
  const units = new Map()
  const diagnostics = []
  for (const nodeId of nodeIds) {
    const result = materializeUnit(nodeId, nodeById, sources)
    if (result.ok) units.set(nodeId, result.unit)
    else diagnostics.push(result.diagnostic)
  }
  const evidenceById = new Map(
    (Array.isArray(graph?.evidence) ? graph.evidence : [])
      .filter(item => item && typeof item.id === 'string')
      .map(item => [item.id, item])
  )
  const plannedEdges = []
  for (const edge of edges) {
    const result = materializeEdge(edge, evidenceById, sources)
    if (result.ok) plannedEdges.push(result.edge)
    else diagnostics.push(...result.diagnostics)
  }
  return diagnostics.length > 0
    ? { ok: false, diagnostics: sortDiagnostics(diagnostics) }
    : { ok: true, units, edges: plannedEdges }
}

/**
 * Обчислює strongly connected components у stable lexical traversal order.
 * @param {string[]} nodeIds required node IDs
 * @param {Array<Record<string, unknown>>} edges planned edges
 * @returns {Array<{id: string, nodeIds: string[], edgeIds: string[], dependencyComponentIds: string[], cost: number}>} SCC components
 */
function createComponents(nodeIds, edges) {
  const adjacency = new Map(nodeIds.map(id => [id, []]))
  for (const edge of edges) {
    if (adjacency.has(edge.fromId) && adjacency.has(edge.toId)) adjacency.get(edge.fromId).push(edge.toId)
  }
  for (const targets of adjacency.values()) targets.sort((left, right) => left.localeCompare(right))
  const indices = new Map()
  const lowlinks = new Map()
  const stack = []
  const onStack = new Set()
  const groups = []
  let index = 0
  const visit = nodeId => {
    indices.set(nodeId, index)
    lowlinks.set(nodeId, index)
    index += 1
    stack.push(nodeId)
    onStack.add(nodeId)
    for (const targetId of adjacency.get(nodeId)) {
      if (!indices.has(targetId)) {
        visit(targetId)
        lowlinks.set(nodeId, Math.min(lowlinks.get(nodeId), lowlinks.get(targetId)))
      } else if (onStack.has(targetId)) {
        lowlinks.set(nodeId, Math.min(lowlinks.get(nodeId), indices.get(targetId)))
      }
    }
    if (lowlinks.get(nodeId) !== indices.get(nodeId)) return
    const members = []
    let memberId = null
    while (memberId !== nodeId) {
      memberId = stack.pop()
      onStack.delete(memberId)
      members.push(memberId)
    }
    groups.push(members.toSorted())
  }
  for (const nodeId of nodeIds.toSorted()) if (!indices.has(nodeId)) visit(nodeId)

  const byNodeId = new Map()
  const components = groups.map(nodeIdsInComponent => {
    const id = `scc:${fingerprint(nodeIdsInComponent).slice(7, 31)}`
    for (const nodeId of nodeIdsInComponent) byNodeId.set(nodeId, id)
    return { id, nodeIds: nodeIdsInComponent, edgeIds: [], dependencyComponentIds: [], cost: 0 }
  })
  const byId = new Map(components.map(component => [component.id, component]))
  for (const edge of edges) {
    const source = byId.get(byNodeId.get(edge.fromId))
    source.edgeIds.push(edge.id)
    const targetId = byNodeId.get(edge.toId)
    if (targetId && targetId !== source.id) source.dependencyComponentIds.push(targetId)
  }
  return components
    .map(component => ({
      ...component,
      edgeIds: component.edgeIds.toSorted(),
      dependencyComponentIds: [...new Set(component.dependencyComponentIds)].toSorted()
    }))
    .toSorted(compareById)
}

/**
 * Додає unit і assigned-edge cost до SCCs.
 * @param {Array<Record<string, unknown>>} components SCCs
 * @param {Map<string, Record<string, unknown>>} units unit inputs
 * @param {Array<Record<string, unknown>>} edges edge inputs
 * @returns {Array<Record<string, unknown>>} costed components
 */
function costComponents(components, units, edges) {
  const edgeById = new Map(edges.map(edge => [edge.id, edge]))
  return components.map(component => ({
    ...component,
    cost:
      component.nodeIds.reduce((sum, id) => sum + units.get(id).cost, 0) +
      component.edgeIds.reduce((sum, id) => sum + edgeById.get(id).cost, 0)
  }))
}

/**
 * Формує dependency-first waves; SCC condensation graph завжди DAG.
 * @param {Array<Record<string, unknown>>} components costed SCCs
 * @returns {Array<Array<Record<string, unknown>>>} stable component waves
 */
function createWaves(components) {
  const byId = new Map(components.map(component => [component.id, component]))
  const remaining = new Map(components.map(component => [component.id, new Set(component.dependencyComponentIds)]))
  const waves = []
  while (remaining.size > 0) {
    const ready = []
    for (const [id, dependencies] of remaining) if (dependencies.size === 0) ready.push(byId.get(id))
    ready.sort(compareById)
    if (ready.length === 0) throw new Error('SCC condensation graph unexpectedly contains a cycle.')
    waves.push(ready)
    for (const component of ready) remaining.delete(component.id)
    for (const dependencies of remaining.values()) for (const component of ready) dependencies.delete(component.id)
  }
  return waves
}

/**
 * Пакує independent SCCs одного wave, не розрізаючи unit або SCC.
 * @param {Array<Record<string, unknown>>} components wave components
 * @param {number} maxTokens hard chunk budget
 * @returns {Array<Array<Record<string, unknown>>>} groups for chunks
 */
function packWave(components, maxTokens) {
  const chunks = []
  let current = []
  let cost = 0
  for (const component of components) {
    if (current.length > 0 && cost + component.cost > maxTokens) {
      chunks.push(current)
      current = []
      cost = 0
    }
    current.push(component)
    cost += component.cost
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

/**
 * Формує bounded reduce tree із summary references, не зчитуючи source повторно.
 * @param {Array<Record<string, unknown>>} chunks map chunks
 * @param {number} maxInputs reduce fan-in bound
 * @returns {{levels: Array<Record<string, unknown>>, rootIds: string[]}} reduce metadata
 */
function createReducePlan(chunks, maxInputs) {
  const levels = []
  let inputIds = chunks.map(chunk => chunk.id).toSorted()
  let level = 0
  while (inputIds.length > 1) {
    const groups = []
    for (let start = 0; start < inputIds.length; start += maxInputs) {
      const childIds = inputIds.slice(start, start + maxInputs)
      groups.push({ id: `reduce:${level}:${fingerprint(childIds).slice(7, 31)}`, childIds })
    }
    levels.push({ level, groups })
    inputIds = groups.map(group => group.id)
    level += 1
  }
  return { levels, rootIds: inputIds }
}

/**
 * Сортує diagnostics для deterministic error output.
 * @param {Array<Record<string, unknown>>} diagnostics diagnostics
 * @returns {Array<Record<string, unknown>>} sorted diagnostics
 */
function sortDiagnostics(diagnostics) {
  return diagnostics.toSorted((left, right) =>
    `${left.path ?? ''}:${left.code}:${left.detail}`.localeCompare(`${right.path ?? ''}:${right.code}:${right.detail}`)
  )
}

/**
 * Перевіряє та матеріалізує всі planner inputs до побудови SCC.
 * @param {{graph: Record<string, unknown>, sources: unknown, requiredNodeIds: unknown, requiredEdgeIds: unknown}} input raw planner inputs
 * @returns {{ok: true, nodes: Record<string, unknown>, edges: Record<string, unknown>, materialized: Record<string, unknown>} | {ok: false, diagnostics: Array<Record<string, unknown>>}} prepared inputs or blockers
 */
function preparePlannerInputs({ graph, sources, requiredNodeIds, requiredEdgeIds }) {
  const indexedSources = indexSources(sources)
  if (!indexedSources.ok) return indexedSources
  const resolvedNodes = resolveRequiredNodes(graph, requiredNodeIds)
  if (!resolvedNodes.ok) return resolvedNodes
  const resolvedEdges = resolveRequiredEdges(graph, new Set(resolvedNodes.ids), requiredEdgeIds)
  if (!resolvedEdges.ok) return resolvedEdges
  const materialized = materializeInputs({
    nodeById: resolvedNodes.nodeById,
    nodeIds: resolvedNodes.ids,
    edges: resolvedEdges.edges,
    graph,
    sources: indexedSources.byPath
  })
  return materialized.ok ? { ok: true, nodes: resolvedNodes, edges: resolvedEdges, materialized } : materialized
}

/**
 * Планує normalized semantic units і edges у bounded map chunks та dependency waves.
 *
 * Default required nodes — усі `code-unit` nodes; opaque cross-domain targets
 * не є AST units, але їхні incoming edges лишаються required і покриваються
 * source evidence slice свого local caller. Explicit `requiredNodeIds` дозволяє
 * higher-level graph layer планувати інші node kinds тільки за наявності spans.
 * @param {{
 *   graph: Record<string, unknown>,
 *   sources: Array<{path: string, content: string}>,
 *   maxTokens?: number,
 *   maxReduceInputs?: number,
 *   requiredNodeIds?: string[],
 *   requiredEdgeIds?: string[],
 *   parser?: Record<string, unknown>,
 *   schema?: Record<string, unknown>,
 *   prompt?: Record<string, unknown>,
 *   modelPolicy?: Record<string, unknown>
 * }} input graph, source texts and deterministic policy versions
 * @returns {{ok: true, plan: Record<string, unknown>} | {ok: false, diagnostics: Array<Record<string, unknown>>}} plan or blockers
 */
export function planSemanticChunks({
  graph,
  sources,
  maxTokens = DEFAULT_MAX_TOKENS,
  maxReduceInputs = DEFAULT_REDUCE_INPUTS,
  requiredNodeIds,
  requiredEdgeIds,
  parser = {},
  schema = {},
  prompt = {},
  modelPolicy = {}
}) {
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 1) {
    return { ok: false, diagnostics: [diagnostic('budget-invalid', 'maxTokens мусить бути додатним safe integer.')] }
  }
  if (!Number.isSafeInteger(maxReduceInputs) || maxReduceInputs < 2) {
    return {
      ok: false,
      diagnostics: [diagnostic('reduce-inputs-invalid', 'maxReduceInputs мусить бути safe integer не менше 2.')]
    }
  }
  const prepared = preparePlannerInputs({ graph, sources, requiredNodeIds, requiredEdgeIds })
  if (!prepared.ok) return prepared
  const { nodes: resolvedNodes, edges: resolvedEdges, materialized } = prepared

  const components = costComponents(
    createComponents(resolvedNodes.ids, materialized.edges),
    materialized.units,
    materialized.edges
  )
  const oversized = components.filter(component => component.cost > maxTokens)
  if (oversized.length > 0) {
    return {
      ok: false,
      diagnostics: oversized.map(component =>
        diagnostic(
          component.nodeIds.length > 1 ? 'oversized-scc' : 'oversized-unit',
          `${component.id} потребує ${component.cost} tokens за budget ${maxTokens}; planner не обрізає source.`,
          materialized.units.get(component.nodeIds[0]).slice.path
        )
      )
    }
  }

  const edgeById = new Map(materialized.edges.map(edge => [edge.id, edge]))
  const componentWaves = createWaves(components)
  const componentToChunkId = new Map()
  const chunks = []
  for (const [wave, componentsInWave] of componentWaves.entries()) {
    for (const group of packWave(componentsInWave, maxTokens)) {
      const componentIds = group.map(component => component.id).toSorted()
      const nodeIds = group.flatMap(component => component.nodeIds).toSorted()
      const edgeIds = group.flatMap(component => component.edgeIds).toSorted()
      const id = `chunk:${fingerprint({ componentIds, nodeIds, edgeIds }).slice(7, 31)}`
      for (const component of group) componentToChunkId.set(component.id, id)
      const unitSlices = nodeIds.map(nodeId => ({ nodeId, ...materialized.units.get(nodeId).slice }))
      const edgeEvidence = edgeIds.map(edgeId => ({ edgeId, evidence: edgeById.get(edgeId).evidenceSlices }))
      chunks.push({
        id,
        wave,
        componentIds,
        nodeIds,
        edgeIds,
        unitSlices,
        edgeEvidence,
        estimatedTokens: group.reduce((sum, component) => sum + component.cost, 0)
      })
    }
  }
  for (const chunk of chunks) {
    const dependencies = new Set()
    for (const componentId of chunk.componentIds) {
      const component = components.find(candidate => candidate.id === componentId)
      for (const dependencyId of component.dependencyComponentIds)
        dependencies.add(componentToChunkId.get(dependencyId))
    }
    chunk.dependsOnChunkIds = [...dependencies].filter(Boolean).toSorted()
    chunk.cacheFingerprint = fingerprint({
      plannerVersion: 1,
      parser,
      schema,
      prompt,
      modelPolicy,
      graphSchemaVersion: graph?.schemaVersion ?? null,
      nodeIds: chunk.nodeIds,
      edgeIds: chunk.edgeIds,
      unitSlices: chunk.unitSlices.map(slice => ({
        nodeId: slice.nodeId,
        path: slice.path,
        span: slice.span,
        contentHash: slice.contentHash
      })),
      edgeEvidence: chunk.edgeEvidence.map(edge => ({
        edgeId: edge.edgeId,
        evidence: edge.evidence.map(item => ({
          id: item.id,
          path: item.path,
          span: item.span,
          contentHash: item.contentHash
        }))
      }))
    })
  }
  const sortedChunks = chunks.toSorted((left, right) => left.wave - right.wave || left.id.localeCompare(right.id))
  const coveredNodeIds = sortedChunks.flatMap(chunk => chunk.nodeIds).toSorted()
  const coveredEdgeIds = sortedChunks.flatMap(chunk => chunk.edgeIds).toSorted()
  const coverage = {
    requiredNodeIds: resolvedNodes.ids,
    requiredEdgeIds: resolvedEdges.edges.map(edge => edge.id).toSorted(),
    coveredNodeIds,
    coveredEdgeIds,
    complete:
      JSON.stringify(resolvedNodes.ids) === JSON.stringify(coveredNodeIds) &&
      JSON.stringify(resolvedEdges.edges.map(edge => edge.id).toSorted()) === JSON.stringify(coveredEdgeIds)
  }
  if (!coverage.complete) {
    return {
      ok: false,
      diagnostics: [diagnostic('coverage-incomplete', 'Planner не покрив усі required nodes або edges.')]
    }
  }
  const reduce = createReducePlan(sortedChunks, maxReduceInputs)
  return {
    ok: true,
    plan: {
      plannerVersion: 1,
      maxTokens,
      chunks: sortedChunks,
      waves: componentWaves.map((componentsInWave, index) => ({
        index,
        chunkIds: sortedChunks.filter(chunk => chunk.wave === index).map(chunk => chunk.id),
        componentIds: componentsInWave.map(component => component.id)
      })),
      coverage,
      reduce,
      cachePolicy: {
        parser: canonicalize(parser),
        schema: canonicalize(schema),
        prompt: canonicalize(prompt),
        modelPolicy: canonicalize(modelPolicy)
      }
    }
  }
}

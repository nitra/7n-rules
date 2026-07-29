/**
 * Будує детермінований package-level knowledge graph із нормалізованих
 * language fragments.
 *
 * Core, а не language adapter, володіє canonical ID, opaque cross-domain
 * boundaries і provenance. Будь-який extractor failure або порушення contract
 * блокує весь graph: partial result не повертається і не може бути опублікований.
 */

import { createHash } from 'node:crypto'

const EDGE_KINDS = new Set([
  'contains',
  'triggers',
  'invokes',
  'validates',
  'decides',
  'transitions',
  'reads',
  'mutates',
  'persists',
  'emits',
  'consumes',
  'integrates',
  'implements',
  'verifies',
  'expects',
  'recovers',
  'produces'
])
const EVIDENCE_ROLES = new Set(['syntax', 'doc', 'attribute'])

/**
 * Повертає короткий deterministic digest для synthetic IDs і fingerprints.
 * @param {string} value canonical input
 * @returns {string} перші 24 hex-символи SHA-256
 */
function digest(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 24)
}

/**
 * Рекурсивно впорядковує ключі обʼєктів для byte-stable JSON.
 * Порядок semantic collections задає builder; ця функція стабілізує лише
 * довільні adapter attributes.
 * @param {unknown} value input value
 * @returns {unknown} canonicalized value
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
 * Формує blocking diagnostic у стабільній структурі.
 * @param {string} code machine-readable code
 * @param {string} detail human-readable detail
 * @param {string | null} [path] source path
 * @returns {{ code: string, detail: string, path: string | null }} stable diagnostic
 */
function diagnostic(code, detail, path = null) {
  return { code, detail, path }
}

/**
 * Перевіряє half-open UTF-8 byte span.
 * @param {unknown} span parser/evidence span
 * @returns {boolean} чи span придатний для traceability
 */
function isValidByteSpan(span) {
  return (
    Boolean(span) &&
    typeof span === 'object' &&
    Number.isSafeInteger(span.startByte) &&
    Number.isSafeInteger(span.endByte) &&
    span.startByte >= 0 &&
    span.endByte >= span.startByte
  )
}

/**
 * Перевіряє мінімальний contract успішного file fragment.
 * @param {unknown} raw довільний extractor result
 * @returns {{ ok: true, value: Record<string, unknown> } | { ok: false, diagnostics: Array<Record<string, unknown>> }} validated fragment result
 */
function validateFragment(raw) {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, diagnostics: [diagnostic('invalid-fragment', 'Extractor result не є обʼєктом.')] }
  }
  if (raw.ok === false) {
    const diagnostics =
      Array.isArray(raw.diagnostics) && raw.diagnostics.length > 0
        ? raw.diagnostics.map(item => canonicalize(item))
        : [diagnostic('extractor-failed', 'Extractor завершився без structured diagnostic.')]
    return { ok: false, diagnostics }
  }
  const path = typeof raw.file?.path === 'string' ? raw.file.path : null
  if (
    raw.ok !== true ||
    path === null ||
    typeof raw.file?.language !== 'string' ||
    typeof raw.file?.contentHash !== 'string' ||
    raw.file.contentHash === ''
  ) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          'invalid-fragment',
          'Успішний fragment мусить мати ok=true і непорожні file.path/file.language/file.contentHash.',
          path
        )
      ]
    }
  }
  if (!Array.isArray(raw.units) || !Array.isArray(raw.edges)) {
    return {
      ok: false,
      diagnostics: [diagnostic('invalid-fragment', 'Успішний fragment мусить містити units[] та edges[].', path)]
    }
  }
  return { ok: true, value: raw }
}

/**
 * Створює canonical code-unit ID, незалежний від фізичного шляху файла.
 * @param {string} domainId domain identity
 * @param {string} language normalized language id
 * @param {string} qualifiedPath language-qualified symbol path
 * @returns {string} canonical node ID
 */
export function createCodeUnitId(domainId, language, qualifiedPath) {
  return `code-unit:${domainId}:${language}:${qualifiedPath}`
}

/**
 * Створює mutable collector для нормалізованого graph.
 * @returns {{nodes: object[], edges: object[], evidence: object[], nodeIds: Set<string>, evidenceIds: Set<string>, diagnostics: object[], localIdsByFile: Map<string, Map<string, string>>, opaqueNodes: Map<string, object>}} graph collector
 */
function createGraphState() {
  return {
    nodes: [],
    edges: [],
    evidence: [],
    nodeIds: new Set(),
    evidenceIds: new Set(),
    diagnostics: [],
    localIdsByFile: new Map(),
    opaqueNodes: new Map()
  }
}

/**
 * Стабільно сортує diagnostics.
 * @param {Array<Record<string, unknown>>} diagnostics diagnostics to order
 * @returns {Array<Record<string, unknown>>} ordered diagnostics
 */
function sortDiagnostics(diagnostics) {
  return diagnostics.toSorted((left, right) =>
    `${left.path ?? ''}:${left.code}:${left.detail}`.localeCompare(`${right.path ?? ''}:${right.code}:${right.detail}`)
  )
}

/**
 * Додає declaration provenance лише один раз.
 * @param {object} state graph collector
 * @param {string} fileKey source path
 * @param {Record<string, unknown>} unit source unit
 * @param {string} id canonical node ID
 * @param {string | null} contentHash file fingerprint
 * @returns {void}
 */
function appendDeclarationEvidence(state, fileKey, unit, id, contentHash) {
  const evidenceInput = canonicalize({ path: fileKey, role: 'syntax', span: unit.span, symbolId: id })
  const evidenceId = `evidence:${digest(JSON.stringify(evidenceInput))}`
  if (state.evidenceIds.has(evidenceId)) return
  state.evidenceIds.add(evidenceId)
  state.evidence.push({
    id: evidenceId,
    kind: 'code',
    path: fileKey,
    symbolId: id,
    span: canonicalize(unit.span),
    contentHash,
    role: 'syntax'
  })
}

/**
 * Валідовує та додає units кожного successful fragment-а.
 * @param {Array<Record<string, unknown>>} fragments normalized fragments
 * @param {string} domainId domain identity
 * @param {object} state graph collector
 * @returns {void}
 */
function collectUnits(fragments, domainId, state) {
  for (const fragment of fragments) {
    const fileKey = fragment.file.path
    const localMap = new Map()
    for (const unit of fragment.units) {
      const invalid =
        !unit ||
        typeof unit.localId !== 'string' ||
        typeof unit.qualifiedPath !== 'string' ||
        typeof unit.kind !== 'string' ||
        typeof unit.name !== 'string' ||
        !isValidByteSpan(unit.span)
      if (invalid) {
        state.diagnostics.push(
          diagnostic(
            'invalid-unit',
            'Unit має містити localId, qualifiedPath, kind, name і валідний UTF-8 byte span.',
            fileKey
          )
        )
        continue
      }
      if (localMap.has(unit.localId)) {
        state.diagnostics.push(diagnostic('duplicate-local-id', `Повторний localId "${unit.localId}".`, fileKey))
        continue
      }
      const id = createCodeUnitId(domainId, fragment.file.language, unit.qualifiedPath)
      if (state.nodeIds.has(id)) {
        state.diagnostics.push(diagnostic('duplicate-node-id', `Canonical node ID "${id}" не унікальний.`, fileKey))
        continue
      }
      localMap.set(unit.localId, id)
      state.nodeIds.add(id)
      state.nodes.push({
        id,
        kind: 'code-unit',
        name: unit.name,
        visibility: unit.visibility ?? 'private',
        domainId,
        attributes: canonicalize({
          language: fragment.file.language,
          unitKind: unit.kind,
          signature: unit.signature ?? null,
          qualifiedPath: unit.qualifiedPath,
          sourcePath: fragment.file.path,
          span: unit.span ?? null,
          ...unit.attributes
        }),
        sourceFingerprint: fragment.file.contentHash ?? null
      })
      appendDeclarationEvidence(state, fileKey, unit, id, fragment.file.contentHash ?? null)
    }
    state.localIdsByFile.set(fileKey, localMap)
  }
}

/**
 * Матеріалізує opaque integration node для external specifier.
 * @param {object} state graph collector
 * @param {string} domainId domain identity
 * @param {string} specifier unresolved external specifier
 * @returns {string} canonical integration node ID
 */
function opaqueTarget(state, domainId, specifier) {
  const id = `contract:${domainId}:${digest(specifier)}`
  if (!state.opaqueNodes.has(id)) {
    state.opaqueNodes.set(id, {
      id,
      kind: 'integration',
      name: specifier,
      visibility: 'external',
      domainId,
      attributes: { opaque: true, specifier },
      sourceFingerprint: digest(specifier)
    })
  }
  return id
}

/**
 * Додає edge evidence та повертає canonical IDs.
 * @param {object} state graph collector
 * @param {Array<Record<string, unknown>>} items edge evidence
 * @param {string} fileKey source path
 * @param {string} fromId source node ID
 * @param {string | null} contentHash file fingerprint
 * @returns {string[]} sorted evidence IDs
 */
function appendEdgeEvidence(state, items, fileKey, fromId, contentHash) {
  const ids = []
  for (const item of items) {
    const path = typeof item?.path === 'string' ? item.path : fileKey
    const role = item?.role ?? 'syntax'
    const evidenceInput = JSON.stringify(canonicalize({ path, role, span: item.span }))
    const id = `evidence:${digest(evidenceInput)}`
    ids.push(id)
    if (state.evidenceIds.has(id)) continue
    state.evidenceIds.add(id)
    state.evidence.push({ id, kind: 'code', path, symbolId: fromId, span: canonicalize(item.span), contentHash, role })
  }
  return ids.toSorted()
}

/**
 * Перевіряє edge kind до доступу до його решти полів.
 * @param {unknown} edge extractor edge
 * @param {string} fileKey source path
 * @returns {Record<string, unknown> | null} blocking diagnostic or null
 */
function edgeKindDiagnostic(edge, fileKey) {
  if (edge && typeof edge.kind === 'string' && EDGE_KINDS.has(edge.kind)) return null
  return diagnostic('invalid-edge-kind', `Невідомий edge kind "${String(edge?.kind)}".`, fileKey)
}

/**
 * Розвʼязує local або opaque edge endpoints.
 * @param {Record<string, unknown>} edge validated extractor edge
 * @param {Map<string, string>} localMap local IDs for source file
 * @param {object} state graph collector
 * @param {string} domainId domain identity
 * @param {string} fileKey source path
 * @returns {{fromId: string, toId: string} | {diagnostic: Record<string, unknown>}} endpoints or blocking diagnostic
 */
function resolveEdgeEndpoints(edge, localMap, state, domainId, fileKey) {
  const fromId = localMap.get(edge.fromLocalId)
  if (!fromId) {
    return {
      diagnostic: diagnostic(
        'unknown-edge-source',
        `Edge посилається на невідомий localId "${edge.fromLocalId}".`,
        fileKey
      )
    }
  }
  let toId = edge.to?.localId ? localMap.get(edge.to.localId) : null
  if (edge.to?.localId && !toId) {
    return {
      diagnostic: diagnostic(
        'unknown-edge-target',
        `Edge посилається на невідомий localId "${edge.to.localId}".`,
        fileKey
      )
    }
  }
  if (!toId && typeof edge.to?.unresolvedSpecifier === 'string' && edge.to.opaque === true) {
    toId = opaqueTarget(state, domainId, edge.to.unresolvedSpecifier)
  }
  if (!toId)
    return {
      diagnostic: diagnostic('invalid-edge-target', 'Edge target має бути localId або opaque specifier.', fileKey)
    }
  return { fromId, toId }
}

/**
 * Перевіряє, що edge має повне provenance.
 * @param {Record<string, unknown>} edge validated extractor edge
 * @param {string} fileKey source path
 * @returns {Record<string, unknown> | null} blocking diagnostic or null
 */
function edgeEvidenceDiagnostic(edge, fileKey) {
  if (!Array.isArray(edge.evidence) || edge.evidence.length === 0) {
    return diagnostic('edge-without-evidence', `${edge.kind} edge не має provenance.`, fileKey)
  }
  const invalid = edge.evidence.some(
    item => !isValidByteSpan(item?.span) || (item?.role !== undefined && !EVIDENCE_ROLES.has(item.role))
  )
  return invalid
    ? diagnostic(
        'invalid-edge-evidence',
        `${edge.kind} edge має evidence без валідного UTF-8 byte span або provenance role.`,
        fileKey
      )
    : null
}

/**
 * Валідовує та додає edges кожного successful fragment-а.
 * @param {Array<Record<string, unknown>>} fragments normalized fragments
 * @param {string} domainId domain identity
 * @param {object} state graph collector
 * @returns {void}
 */
function collectEdges(fragments, domainId, state) {
  for (const fragment of fragments) {
    const fileKey = fragment.file.path
    const localMap = state.localIdsByFile.get(fileKey)
    for (const edge of fragment.edges) {
      const kindDiagnostic = edgeKindDiagnostic(edge, fileKey)
      if (kindDiagnostic) {
        state.diagnostics.push(kindDiagnostic)
        continue
      }
      const endpoints = resolveEdgeEndpoints(edge, localMap, state, domainId, fileKey)
      if ('diagnostic' in endpoints) {
        state.diagnostics.push(endpoints.diagnostic)
        continue
      }
      const evidenceDiagnostic = edgeEvidenceDiagnostic(edge, fileKey)
      if (evidenceDiagnostic) {
        state.diagnostics.push(evidenceDiagnostic)
        continue
      }
      const evidenceIds = appendEdgeEvidence(
        state,
        edge.evidence,
        fileKey,
        endpoints.fromId,
        fragment.file.contentHash ?? null
      )
      const id = `edge:${digest(JSON.stringify([edge.kind, endpoints.fromId, endpoints.toId, evidenceIds]))}`
      state.edges.push({ id, kind: edge.kind, fromId: endpoints.fromId, toId: endpoints.toId, evidenceIds })
    }
  }
}

/**
 * Формує immutable successful graph projection.
 * @param {Record<string, unknown>} domain domain descriptor
 * @param {object} state graph collector
 * @returns {Record<string, unknown>} normalized graph
 */
function finalizeGraph(domain, state) {
  state.nodes.push(...state.opaqueNodes.values())
  return {
    schemaVersion: 1,
    domain: canonicalize({
      id: domain.id,
      ecosystem: domain.ecosystem,
      name: domain.name,
      rootManifest: domain.rootManifest,
      sourceFingerprint: domain.sourceFingerprint
    }),
    nodes: state.nodes.toSorted((left, right) => left.id.localeCompare(right.id)),
    edges: state.edges.toSorted((left, right) => left.id.localeCompare(right.id)),
    claims: [],
    topics: [],
    gaps: [],
    evidence: state.evidence.toSorted((left, right) => left.id.localeCompare(right.id))
  }
}

/**
 * Будує normalized graph. Language fragments можуть надходити у будь-якому
 * порядку; результат і diagnostics завжди стабільно відсортовані.
 * @param {{
 *   domain: { id: string, ecosystem: string, name: string, rootManifest: string, sourceFingerprint?: string },
 *   fragments: unknown[]
 * }} input domain та результати knowledge.extractor@1
 * @returns {{ ok: true, graph: Record<string, unknown> } | { ok: false, diagnostics: Array<Record<string, unknown>> }} complete graph або diagnostics
 */
export function buildNormalizedGraph({ domain, fragments }) {
  if (!domain || typeof domain.id !== 'string' || domain.id === '') {
    return { ok: false, diagnostics: [diagnostic('invalid-domain', 'Domain мусить мати непорожній id.')] }
  }
  if (!Array.isArray(fragments)) {
    return { ok: false, diagnostics: [diagnostic('invalid-fragments', 'fragments мусить бути масивом.')] }
  }

  const checked = fragments.map(fragment => validateFragment(fragment))
  const fragmentFailures = checked.flatMap(result => (result.ok ? [] : result.diagnostics))
  if (fragmentFailures.length > 0) return { ok: false, diagnostics: sortDiagnostics(fragmentFailures) }

  const successful = checked
    .map(result => result.value)
    .toSorted((left, right) => left.file.path.localeCompare(right.file.path))
  const state = createGraphState()
  collectUnits(successful, domain.id, state)
  collectEdges(successful, domain.id, state)
  if (state.diagnostics.length > 0) return { ok: false, diagnostics: sortDiagnostics(state.diagnostics) }
  return { ok: true, graph: finalizeGraph(domain, state) }
}

/**
 * Серіалізує graph у byte-stable JSON для manifest, snapshot і reproducible fingerprints.
 * @param {unknown} graph normalized graph
 * @returns {string} canonical JSON із фінальним newline
 */
export function serializeKnowledgeGraph(graph) {
  return `${JSON.stringify(canonicalize(graph), null, 2)}\n`
}

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

/* eslint-disable sonarjs/cognitive-complexity -- atomic graph assembly keeps cross-collection invariants in one fail-closed boundary */
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
  if (fragmentFailures.length > 0) {
    return {
      ok: false,
      diagnostics: fragmentFailures.toSorted((left, right) =>
        `${left.path ?? ''}:${left.code}:${left.detail}`.localeCompare(
          `${right.path ?? ''}:${right.code}:${right.detail}`
        )
      )
    }
  }

  const successful = checked
    .map(result => result.value)
    .toSorted((left, right) => left.file.path.localeCompare(right.file.path))
  const nodes = []
  const edges = []
  const evidence = []
  const nodeIds = new Set()
  const evidenceIds = new Set()
  const diagnostics = []
  const localIdsByFile = new Map()
  const opaqueNodes = new Map()

  for (const fragment of successful) {
    const fileKey = fragment.file.path
    const localMap = new Map()
    for (const unit of fragment.units) {
      if (
        !unit ||
        typeof unit.localId !== 'string' ||
        typeof unit.qualifiedPath !== 'string' ||
        typeof unit.kind !== 'string' ||
        typeof unit.name !== 'string' ||
        !isValidByteSpan(unit.span)
      ) {
        diagnostics.push(
          diagnostic(
            'invalid-unit',
            'Unit має містити localId, qualifiedPath, kind, name і валідний UTF-8 byte span.',
            fileKey
          )
        )
        continue
      }
      if (localMap.has(unit.localId)) {
        diagnostics.push(diagnostic('duplicate-local-id', `Повторний localId "${unit.localId}".`, fileKey))
        continue
      }
      const id = createCodeUnitId(domain.id, fragment.file.language, unit.qualifiedPath)
      if (nodeIds.has(id)) {
        diagnostics.push(diagnostic('duplicate-node-id', `Canonical node ID "${id}" не унікальний.`, fileKey))
        continue
      }
      localMap.set(unit.localId, id)
      nodeIds.add(id)
      nodes.push({
        id,
        kind: 'code-unit',
        name: unit.name,
        visibility: unit.visibility ?? 'private',
        domainId: domain.id,
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
      const declarationEvidenceInput = canonicalize({
        path: fileKey,
        role: 'syntax',
        span: unit.span,
        symbolId: id
      })
      const declarationEvidenceId = `evidence:${digest(JSON.stringify(declarationEvidenceInput))}`
      if (!evidenceIds.has(declarationEvidenceId)) {
        evidenceIds.add(declarationEvidenceId)
        evidence.push({
          id: declarationEvidenceId,
          kind: 'code',
          path: fileKey,
          symbolId: id,
          span: canonicalize(unit.span),
          contentHash: fragment.file.contentHash ?? null,
          role: 'syntax'
        })
      }
    }
    localIdsByFile.set(fileKey, localMap)
  }

  for (const fragment of successful) {
    const fileKey = fragment.file.path
    const localMap = localIdsByFile.get(fileKey)
    for (const edge of fragment.edges) {
      if (!edge || typeof edge.kind !== 'string' || !EDGE_KINDS.has(edge.kind)) {
        diagnostics.push(diagnostic('invalid-edge-kind', `Невідомий edge kind "${String(edge?.kind)}".`, fileKey))
        continue
      }
      const from = localMap.get(edge.fromLocalId)
      if (!from) {
        diagnostics.push(
          diagnostic('unknown-edge-source', `Edge посилається на невідомий localId "${edge.fromLocalId}".`, fileKey)
        )
        continue
      }
      let to = edge.to?.localId ? localMap.get(edge.to.localId) : null
      if (edge.to?.localId && !to) {
        diagnostics.push(
          diagnostic('unknown-edge-target', `Edge посилається на невідомий localId "${edge.to.localId}".`, fileKey)
        )
        continue
      }
      if (!to && typeof edge.to?.unresolvedSpecifier === 'string' && edge.to.opaque === true) {
        const specifier = edge.to.unresolvedSpecifier
        to = `contract:${domain.id}:${digest(specifier)}`
        if (!opaqueNodes.has(to)) {
          opaqueNodes.set(to, {
            id: to,
            kind: 'integration',
            name: specifier,
            visibility: 'external',
            domainId: domain.id,
            attributes: { opaque: true, specifier },
            sourceFingerprint: digest(specifier)
          })
        }
      }
      if (!to) {
        diagnostics.push(
          diagnostic('invalid-edge-target', 'Edge target має бути localId або opaque specifier.', fileKey)
        )
        continue
      }
      if (!Array.isArray(edge.evidence) || edge.evidence.length === 0) {
        diagnostics.push(diagnostic('edge-without-evidence', `${edge.kind} edge не має provenance.`, fileKey))
        continue
      }
      if (
        edge.evidence.some(
          item => !isValidByteSpan(item?.span) || (item?.role !== undefined && !EVIDENCE_ROLES.has(item.role))
        )
      ) {
        diagnostics.push(
          diagnostic(
            'invalid-edge-evidence',
            `${edge.kind} edge має evidence без валідного UTF-8 byte span або provenance role.`,
            fileKey
          )
        )
        continue
      }
      const edgeEvidenceIds = []
      for (const item of edge.evidence) {
        const path = typeof item?.path === 'string' ? item.path : fileKey
        const evidenceInput = JSON.stringify(canonicalize({ path, role: item?.role ?? 'syntax', span: item.span }))
        const id = `evidence:${digest(evidenceInput)}`
        edgeEvidenceIds.push(id)
        if (!evidenceIds.has(id)) {
          evidenceIds.add(id)
          evidence.push({
            id,
            kind: 'code',
            path,
            symbolId: from,
            span: canonicalize(item.span),
            contentHash: fragment.file.contentHash ?? null,
            role: item?.role ?? 'syntax'
          })
        }
      }
      const sortedEvidenceIds = edgeEvidenceIds.toSorted()
      const id = `edge:${digest(JSON.stringify([edge.kind, from, to, sortedEvidenceIds]))}`
      edges.push({ id, kind: edge.kind, fromId: from, toId: to, evidenceIds: sortedEvidenceIds })
    }
  }

  if (diagnostics.length > 0) {
    return {
      ok: false,
      diagnostics: diagnostics.toSorted((left, right) =>
        `${left.path ?? ''}:${left.code}:${left.detail}`.localeCompare(
          `${right.path ?? ''}:${right.code}:${right.detail}`
        )
      )
    }
  }

  nodes.push(...opaqueNodes.values())
  const sortedNodes = nodes.toSorted((left, right) => left.id.localeCompare(right.id))
  const sortedEdges = edges.toSorted((left, right) => left.id.localeCompare(right.id))
  const sortedEvidence = evidence.toSorted((left, right) => left.id.localeCompare(right.id))

  return {
    ok: true,
    graph: {
      schemaVersion: 1,
      domain: canonicalize({
        id: domain.id,
        ecosystem: domain.ecosystem,
        name: domain.name,
        rootManifest: domain.rootManifest,
        sourceFingerprint: domain.sourceFingerprint
      }),
      nodes: sortedNodes,
      edges: sortedEdges,
      claims: [],
      topics: [],
      gaps: [],
      evidence: sortedEvidence
    }
  }
}
/* eslint-enable sonarjs/cognitive-complexity */

/**
 * Серіалізує graph у byte-stable JSON для manifest, snapshot і reproducible fingerprints.
 * @param {unknown} graph normalized graph
 * @returns {string} canonical JSON із фінальним newline
 */
export function serializeKnowledgeGraph(graph) {
  return `${JSON.stringify(canonicalize(graph), null, 2)}\n`
}

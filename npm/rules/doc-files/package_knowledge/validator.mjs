/**
 * Виконує deterministic quality gates для package knowledge graph.
 *
 * Validator перевіряє public schema, referential integrity, extractor coverage
 * і privacy human projection. Він не виправляє й не публікує candidate: будь-яка
 * діагностика лишає рішення про atomic publication зовнішньому caller-у.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import Ajv2020 from 'ajv/dist/2020.js'

const SCHEMA_PATH = join(import.meta.dirname, 'schema', 'knowledge-graph-v1.schema.json')

/**
 * Створює stable validation diagnostic.
 * @param {string} code machine-readable code
 * @param {string} message user-facing explanation
 * @param {string | null} [id] related graph identity
 * @returns {{code: string, message: string, id: string | null}} diagnostic
 */
function diagnostic(code, message, id = null) {
  return { code, message, id }
}

/**
 * Компілює committed schema v1 для одного validation run.
 * @returns {Promise<import('ajv').ValidateFunction>} Ajv validator
 */
async function schemaValidator() {
  const schema = JSON.parse(await readFile(SCHEMA_PATH, 'utf8'))
  return new Ajv2020({ strict: false }).compile(schema)
}

/**
 * Перевіряє references edges до nodes та evidence.
 * @param {Record<string, unknown>} graph schema-valid graph
 * @param {Set<string>} nodeIds відомі node identities
 * @param {Set<string>} evidenceIds відомі evidence identities
 * @returns {Array<{code: string, message: string, id: string | null}>} diagnostics
 */
function edgeReferenceDiagnostics(graph, nodeIds, evidenceIds) {
  const diagnostics = []
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.fromId)) {
      diagnostics.push(
        diagnostic('edge-source-missing', `Edge ${edge.id} має невідомий fromId ${edge.fromId}.`, edge.id)
      )
    }
    if (!nodeIds.has(edge.toId)) {
      diagnostics.push(diagnostic('edge-target-missing', `Edge ${edge.id} має невідомий toId ${edge.toId}.`, edge.id))
    }
    for (const evidenceId of edge.evidenceIds) {
      if (!evidenceIds.has(evidenceId)) {
        diagnostics.push(
          diagnostic('edge-evidence-missing', `Edge ${edge.id} має невідомий evidenceId ${evidenceId}.`, edge.id)
        )
      }
    }
  }
  return diagnostics
}

/**
 * Перевіряє references claims до nodes та evidence.
 * @param {Record<string, unknown>} graph schema-valid graph
 * @param {Set<string>} nodeIds відомі node identities
 * @param {Set<string>} evidenceIds відомі evidence identities
 * @returns {Array<{code: string, message: string, id: string | null}>} diagnostics
 */
function claimReferenceDiagnostics(graph, nodeIds, evidenceIds) {
  const diagnostics = []
  for (const claim of graph.claims) {
    if (!nodeIds.has(claim.subjectId)) {
      diagnostics.push(
        diagnostic('claim-subject-missing', `Claim ${claim.id} має невідомий subjectId ${claim.subjectId}.`, claim.id)
      )
    }
    for (const evidenceId of claim.evidenceIds) {
      if (!evidenceIds.has(evidenceId)) {
        diagnostics.push(
          diagnostic('claim-evidence-missing', `Claim ${claim.id} має невідомий evidenceId ${evidenceId}.`, claim.id)
        )
      }
    }
  }
  return diagnostics
}

/**
 * Перевіряє references topics до nodes.
 * @param {Record<string, unknown>} graph schema-valid graph
 * @param {Set<string>} nodeIds відомі node identities
 * @returns {Array<{code: string, message: string, id: string | null}>} diagnostics
 */
function topicReferenceDiagnostics(graph, nodeIds) {
  const diagnostics = []
  for (const topic of graph.topics) {
    for (const anchorId of topic.anchorIds) {
      if (!nodeIds.has(anchorId)) {
        diagnostics.push(
          diagnostic('topic-anchor-missing', `Topic ${topic.id} має невідомий anchorId ${anchorId}.`, topic.id)
        )
      }
    }
  }
  return diagnostics
}

/**
 * Перевіряє references gaps до claims.
 * @param {Record<string, unknown>} graph schema-valid graph
 * @param {Set<string>} claimIds відомі claim identities
 * @returns {Array<{code: string, message: string, id: string | null}>} diagnostics
 */
function gapReferenceDiagnostics(graph, claimIds) {
  const diagnostics = []
  for (const gap of graph.gaps) {
    if (!claimIds.has(gap.expectedClaimId)) {
      diagnostics.push(
        diagnostic(
          'gap-expected-claim-missing',
          `Gap ${gap.id} має невідомий expectedClaimId ${gap.expectedClaimId}.`,
          gap.id
        )
      )
    }
    for (const implementedId of gap.implementedClaimIds ?? []) {
      if (!claimIds.has(implementedId)) {
        diagnostics.push(
          diagnostic('gap-implemented-claim-missing', `Gap ${gap.id} має невідомий claim ${implementedId}.`, gap.id)
        )
      }
    }
  }
  return diagnostics
}

/**
 * Перевіряє, що всі graph references ведуть до наявних identities.
 * @param {Record<string, unknown>} graph schema-valid graph
 * @returns {Array<{code: string, message: string, id: string | null}>} diagnostics
 */
function referenceDiagnostics(graph) {
  const nodeIds = new Set(graph.nodes.map(node => node.id))
  const evidenceIds = new Set(graph.evidence.map(item => item.id))
  const claimIds = new Set(graph.claims.map(claim => claim.id))
  return [
    ...edgeReferenceDiagnostics(graph, nodeIds, evidenceIds),
    ...claimReferenceDiagnostics(graph, nodeIds, evidenceIds),
    ...topicReferenceDiagnostics(graph, nodeIds),
    ...gapReferenceDiagnostics(graph, claimIds)
  ]
}

/**
 * Перевіряє coverage ledgers усіх extractor fragments.
 * @param {unknown[]} fragments extractor results
 * @returns {Array<{code: string, message: string, id: string | null}>} diagnostics
 */
function coverageDiagnostics(fragments) {
  const diagnostics = []
  for (const fragment of fragments) {
    if (!fragment || fragment.ok !== true) {
      diagnostics.push(diagnostic('extractor-fragment-failed', 'Coverage gate отримав failed extractor fragment.'))
      continue
    }
    const coverage = fragment.coverage
    const path = fragment.file?.path ?? null
    if (
      !coverage ||
      coverage.complete !== true ||
      coverage.requiredUnits !== coverage.coveredUnits ||
      coverage.requiredEdges !== coverage.coveredEdges
    ) {
      diagnostics.push(
        diagnostic('coverage-incomplete', `Extractor coverage неповне для ${path ?? 'unknown source'}.`, path)
      )
    }
  }
  return diagnostics
}

/**
 * Шукає private symbol names у human projection.
 * @param {Record<string, unknown>} graph schema-valid graph
 * @param {string | null} humanProjection rendered Markdown або null
 * @returns {Array<{code: string, message: string, id: string | null}>} diagnostics
 */
function privacyDiagnostics(graph, humanProjection) {
  if (typeof humanProjection !== 'string') return []
  const diagnostics = []
  for (const node of graph.nodes) {
    if (node.visibility !== 'private' || !humanProjection.includes(node.name)) continue
    diagnostics.push(
      diagnostic('private-symbol-leak', `Human projection містить private symbol name "${node.name}".`, node.id)
    )
  }
  return diagnostics
}

/**
 * Запускає schema, identity, coverage, reference і privacy gates.
 * @param {{
 *   graph: unknown,
 *   fragments?: unknown[],
 *   expectedDomainId?: string | null,
 *   humanProjection?: string | null
 * }} input candidate validation input
 * @returns {Promise<{ok: boolean, diagnostics: Array<{code: string, message: string, id: string | null}>}>} stable result
 */
export async function validateKnowledgeGraph({
  graph,
  fragments = [],
  expectedDomainId = null,
  humanProjection = null
}) {
  const validateSchema = await schemaValidator()
  if (!validateSchema(graph)) {
    const diagnostics = (validateSchema.errors ?? []).map(error =>
      diagnostic('schema-invalid', `${error.instancePath || '/'} ${error.message ?? 'schema violation'}`)
    )
    return { ok: false, diagnostics }
  }

  const diagnostics = []
  if (expectedDomainId && graph.domain.id !== expectedDomainId) {
    diagnostics.push(
      diagnostic(
        'domain-identity-mismatch',
        `Candidate domain ${graph.domain.id} не збігається з expected ${expectedDomainId}.`,
        graph.domain.id
      )
    )
  }
  diagnostics.push(
    ...referenceDiagnostics(graph),
    ...coverageDiagnostics(fragments),
    ...privacyDiagnostics(graph, humanProjection)
  )
  const sortedDiagnostics = diagnostics.toSorted(
    (left, right) => left.code.localeCompare(right.code) || (left.id ?? '').localeCompare(right.id ?? '')
  )
  return { ok: sortedDiagnostics.length === 0, diagnostics: sortedDiagnostics }
}

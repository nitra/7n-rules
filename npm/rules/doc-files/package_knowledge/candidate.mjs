/**
 * Збирає повний deterministic package-knowledge candidate з source files.
 *
 * Оркестратор не виконує LLM synthesis і не публікує artifacts. Він fail-closed
 * зʼєднує language extractors, normalized graph, explicit Expected overlay,
 * gap engine, topic discovery та quality gates в одну атомарну операцію.
 */

import { createHash } from 'node:crypto'
import { extname } from 'node:path'

import { applyExpectedOverlay } from './expected-overlay.mjs'
import { evaluateGaps } from './gap-engine.mjs'
import { buildNormalizedGraph } from './normalized-graph.mjs'
import { reconcileTopicIdentities } from './identity-migration.mjs'
import { mergeStructuredFragments } from './structured-sources.mjs'
import { discoverTopics } from './topic-discovery.mjs'
import { validateKnowledgeGraph } from './validator.mjs'

/**
 * Створює stable blocking diagnostic.
 * @param {string} code machine-readable code
 * @param {string} detail user-facing explanation
 * @param {string | null} [path] related source path
 * @returns {{code: string, detail: string, path: string | null}} diagnostic
 */
function diagnostic(code, detail, path = null) {
  return { code, detail, path }
}

/**
 * Обчислює source content fingerprint.
 * @param {string} content UTF-8 source text
 * @returns {string} SHA-256 fingerprint
 */
function contentHash(content) {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`
}

/**
 * Будує extension → extractor index і відхиляє неоднозначне ownership.
 * @param {Array<Record<string, unknown>>} extractors materialized adapters
 * @returns {{ok: true, byExtension: Map<string, Record<string, unknown>>} | {ok: false, diagnostics: Array<Record<string, unknown>>}} index або blockers
 */
function indexExtractors(extractors) {
  if (!Array.isArray(extractors)) {
    return { ok: false, diagnostics: [diagnostic('invalid-extractors', 'extractors має бути масивом.')] }
  }
  const byExtension = new Map()
  const diagnostics = []
  for (const extractor of extractors) {
    if (!extractor || typeof extractor.analyzeFile !== 'function' || !Array.isArray(extractor.extensions)) {
      diagnostics.push(diagnostic('invalid-extractor', 'Extractor не відповідає knowledge.extractor@1.'))
      continue
    }
    for (const extension of extractor.extensions) {
      if (byExtension.has(extension)) {
        diagnostics.push(
          diagnostic('duplicate-extractor-extension', `Розширення ${extension} належить кільком knowledge extractors.`)
        )
      } else {
        byExtension.set(extension, extractor)
      }
    }
  }
  return diagnostics.length > 0 ? { ok: false, diagnostics } : { ok: true, byExtension }
}

/**
 * Перевіряє й стабільно впорядковує source inputs.
 * @param {unknown} sources candidate source files
 * @returns {{ok: true, sources: Array<{path: string, content: string}>} | {ok: false, diagnostics: Array<Record<string, unknown>>}} normalized sources або blockers
 */
function normalizeSources(sources) {
  if (!Array.isArray(sources)) {
    return { ok: false, diagnostics: [diagnostic('invalid-sources', 'sources має бути масивом.')] }
  }
  const diagnostics = []
  const seen = new Set()
  for (const source of sources) {
    if (
      !source ||
      typeof source.path !== 'string' ||
      source.path === '' ||
      typeof source.content !== 'string' ||
      source.path.startsWith('/') ||
      source.path.split('/').some(segment => segment === '..' || segment === '')
    ) {
      diagnostics.push(diagnostic('invalid-source', 'Source мусить мати safe relative path і string content.'))
      continue
    }
    if (seen.has(source.path)) diagnostics.push(diagnostic('duplicate-source-path', source.path, source.path))
    seen.add(source.path)
  }
  if (diagnostics.length > 0) return { ok: false, diagnostics }
  return {
    ok: true,
    sources: sources
      .map(source => ({ path: source.path, content: source.content }))
      .toSorted((a, b) => a.path.localeCompare(b.path))
  }
}

/**
 * Запускає один fail-closed extractor із normalized input.
 * @param {Record<string, unknown>} extractor knowledge.extractor@1 adapter
 * @param {Record<string, unknown>} domain owning domain
 * @param {{path: string, content: string}} source source input
 * @param {AbortSignal | undefined} signal cancellation signal
 * @returns {Promise<Record<string, unknown>>} fragment або structured failure
 */
async function extractSource(extractor, domain, source, signal) {
  const file = { ...source, contentHash: contentHash(source.content) }
  try {
    const fragment = await extractor.analyzeFile({ domain, file, signal })
    if (!fragment || typeof fragment !== 'object') {
      return {
        ok: false,
        diagnostics: [diagnostic('extractor-result-invalid', 'Extractor не повернув structured result.', source.path)]
      }
    }
    return fragment
  } catch (error) {
    return {
      ok: false,
      diagnostics: [diagnostic('extractor-threw', error instanceof Error ? error.message : String(error), source.path)]
    }
  }
}

/**
 * Будує complete validated graph candidate без publication.
 * @param {{
 *   domain: Record<string, unknown>,
 *   sources: Array<{path: string, content: string}>,
 *   extractors: Array<Record<string, unknown>>,
 *   structuredFragments?: unknown[],
 *   expectedOverlay?: {claims?: unknown[], evidence?: unknown[]},
 *   gapMappings?: unknown[],
 *   aliasesByTopicId?: Record<string, string[]>,
 *   previousManifest?: Record<string, unknown>,
 *   protectedZonesByTopicId?: Record<string, unknown[]>,
 *   minimumGapConfidence?: number,
 *   signal?: AbortSignal
 * }} input pipeline inputs
 * @returns {Promise<{ok: true, graph: Record<string, unknown>, fragments: Array<Record<string, unknown>>, migrationPlan: Record<string, unknown>, protectedZonesByTopicId: Record<string, unknown[]>} | {ok: false, diagnostics: Array<Record<string, unknown>>}>} candidate або blockers
 */
export async function buildKnowledgeCandidate({
  domain,
  sources,
  extractors,
  structuredFragments = [],
  expectedOverlay = {},
  gapMappings = [],
  aliasesByTopicId = {},
  previousManifest,
  protectedZonesByTopicId,
  minimumGapConfidence = 1,
  signal
}) {
  if (!domain || typeof domain.id !== 'string' || domain.id === '') {
    return { ok: false, diagnostics: [diagnostic('invalid-domain', 'Domain мусить мати stable id.')] }
  }
  const normalized = normalizeSources(sources)
  if (!normalized.ok) return normalized
  const indexed = indexExtractors(extractors)
  if (!indexed.ok) return indexed

  const fragments = []
  const diagnostics = []
  for (const source of normalized.sources) {
    const extension = extname(source.path).toLowerCase()
    const extractor = indexed.byExtension.get(extension)
    if (!extractor) {
      diagnostics.push(
        diagnostic('extractor-missing', `Немає knowledge extractor для ${extension || source.path}.`, source.path)
      )
      continue
    }
    const fragment = await extractSource(extractor, domain, source, signal)
    if (fragment.ok !== true) {
      diagnostics.push(
        ...(Array.isArray(fragment.diagnostics) && fragment.diagnostics.length > 0
          ? fragment.diagnostics
          : [diagnostic('extractor-failed', 'Extractor завершився без diagnostic.', source.path)])
      )
      continue
    }
    fragments.push(fragment)
  }
  if (diagnostics.length > 0) return { ok: false, diagnostics }

  const normalizedGraph = buildNormalizedGraph({ domain, fragments })
  if (!normalizedGraph.ok) return normalizedGraph
  const structured = mergeStructuredFragments({ graph: normalizedGraph.graph, domain, fragments: structuredFragments })
  if (!structured.ok) return structured
  const overlaid = applyExpectedOverlay(structured.graph, expectedOverlay)
  if (!overlaid.ok) return overlaid
  const gapResult = evaluateGaps({
    graph: overlaid.graph,
    mappings: gapMappings,
    minimumConfidence: minimumGapConfidence,
    validation: { parser: { ok: true }, coverage: { ok: true } }
  })
  if (!gapResult.ok) return gapResult

  const discoveredTopics = discoverTopics(overlaid.graph, { aliasesByTopicId })
  const migration = reconcileTopicIdentities({
    previousManifest,
    graph: overlaid.graph,
    topics: discoveredTopics,
    protectedZonesByTopicId
  })
  if (!migration.ok) return migration
  const graph = {
    ...overlaid.graph,
    topics: migration.topics,
    gaps: gapResult.gaps
  }
  const validation = await validateKnowledgeGraph({
    graph,
    fragments,
    expectedDomainId: domain.id
  })
  if (!validation.ok) return validation
  return {
    ok: true,
    graph,
    fragments,
    migrationPlan: migration.migrationPlan,
    protectedZonesByTopicId: migration.protectedZonesByTopicId
  }
}

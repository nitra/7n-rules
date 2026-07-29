/**
 * Виводить evidence-backed mappings між expected та implemented claims.
 * Точні canonical matches обходять LLM, а non-exact same-subject кандидати
 * проходять strict semantic comparator, щоб невизначеність не ставала missing.
 */

import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { submitBatch as submitBatchNative } from '@7n/llm-lib/batch'

/**
 * Версія strict claim-comparison result schema.
 */
export const GAP_MAPPING_SCHEMA_VERSION = 'package-knowledge-gap-mappings-v1'
/**
 * Версія prompt contract для expected-to-implemented comparator.
 */
export const GAP_MAPPING_PROMPT_VERSION = 'package-knowledge-gap-mappings-v1'
/**
 * Єдина universal model ladder semantic comparator-а.
 */
export const DEFAULT_GAP_MAPPING_MODEL_POLICY = ['min', 'avg', 'max']

const CACHE_VERSION = 1
const RELATIONS = new Set(['equivalent', 'contradicts'])

/**
 * Канонізує JSON-подібні дані для stable hash і cache snapshot.
 * @param {unknown} value JSON-like input
 * @returns {unknown} stable copy
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
 * Створює SHA-256 fingerprint canonical value.
 * @param {unknown} value stable input
 * @returns {string} prefixed digest
 */
function hash(value) {
  return `sha256:${createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex')}`
}

/**
 * Створює stable comparison diagnostic.
 * @param {string} code machine-readable failure code
 * @param {string} message human-readable detail
 * @param {string | null} [expectedClaimId] affected expected claim
 * @returns {{code: string, message: string, expectedClaimId: string | null}} diagnostic
 */
function diagnostic(code, message, expectedClaimId = null) {
  return { code, message, expectedClaimId }
}

/**
 * Відкриває persistent або injected successful comparator cache.
 * @param {string | undefined} cachePath optional durable cache path
 * @param {{version?: number, entries?: Record<string, unknown>} | undefined} suppliedCache cache supplied by caller
 * @returns {Promise<{version: number, entries: Record<string, unknown>}>} normalized cache
 */
async function loadCache(cachePath, suppliedCache) {
  if (suppliedCache) {
    if (!suppliedCache.entries || typeof suppliedCache.entries !== 'object' || Array.isArray(suppliedCache.entries)) {
      suppliedCache.entries = {}
    }
    suppliedCache.version = CACHE_VERSION
    return suppliedCache
  }
  if (!cachePath) return { version: CACHE_VERSION, entries: {} }
  try {
    const parsed = JSON.parse(await readFile(cachePath, 'utf8'))
    if (
      parsed?.version === CACHE_VERSION &&
      parsed.entries &&
      typeof parsed.entries === 'object' &&
      !Array.isArray(parsed.entries)
    ) {
      return { version: CACHE_VERSION, entries: parsed.entries }
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  return { version: CACHE_VERSION, entries: {} }
}

/**
 * Зберігає тільки strict accepted semantic comparison results.
 * @param {string | undefined} cachePath optional durable cache path
 * @param {{version: number, entries: Record<string, unknown>}} cache cache state
 * @returns {Promise<void>} completion
 */
async function saveCache(cachePath, cache) {
  if (!cachePath) return
  await mkdir(dirname(cachePath), { recursive: true })
  const temporaryPath = `${cachePath}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(canonicalize(cache))}\n`)
  await rename(temporaryPath, cachePath)
}

/**
 * Визначає рівність exact canonical assertion, незалежно від evidence provenance.
 * @param {Record<string, unknown>} expected expected claim
 * @param {Record<string, unknown>} implemented implemented claim
 * @returns {boolean} whether claims are deterministically equivalent
 */
function isExactEquivalent(expected, implemented) {
  return (
    expected.subjectId === implemented.subjectId &&
    expected.predicate === implemented.predicate &&
    JSON.stringify(canonicalize(expected.value)) === JSON.stringify(canonicalize(implemented.value))
  )
}

/**
 * Створює mapping з combined expected та implemented evidence provenance.
 * @param {Record<string, unknown>} expected expected claim
 * @param {Record<string, unknown>} implemented implemented claim
 * @param {'equivalent' | 'contradicts'} relation semantic relation
 * @returns {{expectedClaimId: string, implementedClaimId: string, relation: string, evidenceIds: string[]}} gap-engine mapping
 */
function mapping(expected, implemented, relation) {
  return {
    expectedClaimId: expected.id,
    implementedClaimId: implemented.id,
    relation,
    evidenceIds: [...new Set([...expected.evidenceIds, ...implemented.evidenceIds])].toSorted()
  }
}

/**
 * Нормалізує claims, потрібні для comparison, і відкидає malformed graph раніше LLM.
 * @param {unknown} graph source knowledge graph
 * @returns {{ok: true, expected: Record<string, unknown>[], implemented: Record<string, unknown>[]} | {ok: false, diagnostics: object[]}} claims або blockers
 */
function comparisonClaims(graph) {
  if (!graph || typeof graph !== 'object' || Array.isArray(graph) || !Array.isArray(graph.claims)) {
    return { ok: false, diagnostics: [diagnostic('invalid-gap-mapping-graph', 'Graph мусить містити claims[].')] }
  }
  const invalid = graph.claims.filter(
    claim =>
      (claim?.layer === 'expected' || claim?.layer === 'implemented') &&
      (!claim.id ||
        !claim.subjectId ||
        !claim.predicate ||
        !Array.isArray(claim.evidenceIds) ||
        claim.evidenceIds.length === 0)
  )
  if (invalid.length > 0) {
    return {
      ok: false,
      diagnostics: invalid.map(claim =>
        diagnostic('invalid-gap-mapping-claim', 'Claim не має comparison contract.', claim?.id ?? null)
      )
    }
  }
  return {
    ok: true,
    expected: graph.claims
      .filter(claim => claim?.layer === 'expected')
      .toSorted((left, right) => left.id.localeCompare(right.id)),
    implemented: graph.claims
      .filter(claim => claim?.layer === 'implemented')
      .toSorted((left, right) => left.id.localeCompare(right.id))
  }
}

/**
 * Створює cache key semantic comparison per expected claim і candidate set.
 * @param {{expected: Record<string, unknown>, candidates: Record<string, unknown>[], promptVersion: string, schemaVersion: string, modelPolicy: string[]}} input cache dimensions
 * @returns {string} stable cache key
 */
export function createGapMappingCacheKey({ expected, candidates, promptVersion, schemaVersion, modelPolicy }) {
  return hash({ expected, candidates, promptVersion, schemaVersion, modelPolicy })
}

/**
 * Парсить strict comparator JSON і не допускає чужі IDs або неоднозначні relations.
 * @param {unknown} text raw model response
 * @param {Record<string, unknown>} expected expected claim
 * @param {Map<string, Record<string, unknown>>} candidates allowed implemented candidates
 * @returns {{ok: true, comparisons: Array<{implementedClaimId: string, relation: string}>, unresolved: boolean} | {ok: false, reason: string}} result або failure reason
 */
export function parseGapMappingResult(text, expected, candidates) {
  if (typeof text !== 'string') return { ok: false, reason: 'invalid-comparison-json' }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'invalid-comparison-json' }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    return { ok: false, reason: 'invalid-comparison-shape' }
  if (
    JSON.stringify(Object.keys(parsed).toSorted()) !== JSON.stringify(['comparisons', 'expectedClaimId', 'unresolved'])
  ) {
    return { ok: false, reason: 'invalid-comparison-shape' }
  }
  if (
    parsed.expectedClaimId !== expected.id ||
    typeof parsed.unresolved !== 'boolean' ||
    !Array.isArray(parsed.comparisons)
  ) {
    return { ok: false, reason: 'invalid-comparison-shape' }
  }
  const comparisons = []
  for (const comparison of parsed.comparisons) {
    if (
      !comparison ||
      typeof comparison !== 'object' ||
      Array.isArray(comparison) ||
      JSON.stringify(Object.keys(comparison).toSorted()) !== JSON.stringify(['implementedClaimId', 'relation'])
    ) {
      return { ok: false, reason: 'invalid-comparison-shape' }
    }
    if (
      typeof comparison.implementedClaimId !== 'string' ||
      !candidates.has(comparison.implementedClaimId) ||
      !RELATIONS.has(comparison.relation)
    ) {
      return { ok: false, reason: 'unknown-comparison-claim' }
    }
    comparisons.push(comparison)
  }
  if (new Set(comparisons.map(comparison => comparison.implementedClaimId)).size !== comparisons.length) {
    return { ok: false, reason: 'ambiguous-comparison' }
  }
  if (parsed.unresolved || new Set(comparisons.map(comparison => comparison.relation)).size > 1) {
    return { ok: true, comparisons: [], unresolved: true }
  }
  return { ok: true, comparisons, unresolved: false }
}

/**
 * Надсилає один universal comparator tier та нормалізує transport error до miss.
 * @param {Array<Record<string, unknown>>} pending unresolved expected work
 * @param {string} tier model tier
 * @param {(model: string, items: Array<object>, options?: object) => Promise<Array<object>>} submitBatchImpl batch transport
 * @param {object} batchOptions transport options
 * @returns {Promise<Map<string, Record<string, unknown>>>} responses by expected claim id
 */
async function submitWave(pending, tier, submitBatchImpl, batchOptions) {
  try {
    const responses = await submitBatchImpl(
      tier,
      pending.map(item => ({ customId: item.expected.id, prompt: item.prompt })),
      batchOptions
    )
    return new Map(
      Array.isArray(responses)
        ? responses
            .filter(response => typeof response?.customId === 'string')
            .map(response => [response.customId, response])
        : []
    )
  } catch {
    return new Map()
  }
}

/**
 * Створює semantic work лише для non-exact same-subject candidate group.
 * @param {Record<string, unknown>} expected expected claim
 * @param {Record<string, unknown>[]} candidates same-subject non-exact implementation claims
 * @param {{promptVersion: string, schemaVersion: string, modelPolicy: string[]}} policy cache dimensions
 * @returns {Record<string, unknown>} strict comparator work
 */
function createWork(expected, candidates, policy) {
  const cacheKey = createGapMappingCacheKey({ expected, candidates, ...policy })
  return {
    expected,
    candidates,
    cacheKey,
    prompt: [
      'Compare one expected claim only with the supplied same-subject implemented candidates.',
      'Do not invent IDs or rewrite claims. Return exactly JSON with expectedClaimId, comparisons, unresolved.',
      'Use unresolved:true when evidence is ambiguous or insufficient. Return unresolved:false and [] only when no candidate implements or contradicts the expectation.',
      JSON.stringify({ expectedClaim: expected, implementedCandidates: candidates })
    ].join('\n')
  }
}

/**
 * Розкладає exact mappings локально, залишаючи LLM тільки non-exact candidates.
 * @param {{expected: Record<string, unknown>[], implemented: Record<string, unknown>[]}} claims normalized graph claims
 * @param {{promptVersion: string, schemaVersion: string, modelPolicy: string[]}} policy cache dimensions
 * @returns {{mappings: object[], work: object[]}} deterministic facts and semantic work
 */
function planComparison(claims, policy) {
  const mappings = []
  const work = []
  for (const expected of claims.expected) {
    const sameSubject = claims.implemented.filter(implemented => implemented.subjectId === expected.subjectId)
    const exact = sameSubject.filter(implemented => isExactEquivalent(expected, implemented))
    if (exact.length > 0) {
      mappings.push(...exact.map(implemented => mapping(expected, implemented, 'equivalent')))
    } else if (sameSubject.length > 0) {
      work.push(createWork(expected, sameSubject, policy))
    }
  }
  return { mappings, work }
}

/**
 * Переносить accepted comparison у mappings або explicit unresolved set.
 * @param {{mappings: object[], unresolved: Set<string>}} state accumulated facts
 * @param {Record<string, unknown>} item semantic work item
 * @param {{comparisons: Array<{implementedClaimId: string, relation: string}>, unresolved: boolean}} checked strict comparison
 * @returns {void}
 */
function acceptComparison(state, item, checked) {
  if (checked.unresolved) {
    state.unresolved.add(item.expected.id)
    return
  }
  const candidates = new Map(item.candidates.map(candidate => [candidate.id, candidate]))
  state.mappings.push(
    ...checked.comparisons.map(comparison =>
      mapping(item.expected, candidates.get(comparison.implementedClaimId), comparison.relation)
    )
  )
}

/**
 * Відокремлює cache misses, водночас застосовуючи successful cached comparisons.
 * @param {object[]} work semantic work
 * @param {{entries: Record<string, unknown>}} cache successful comparator cache
 * @param {{mappings: object[], unresolved: Set<string>}} state accumulated facts
 * @returns {object[]} pending comparator work
 */
function selectPendingWork(work, cache, state) {
  const pending = []
  for (const item of work) {
    const candidates = new Map(item.candidates.map(candidate => [candidate.id, candidate]))
    const checked = parseGapMappingResult(cache.entries[item.cacheKey], item.expected, candidates)
    if (checked.ok) acceptComparison(state, item, checked)
    else pending.push(item)
  }
  return pending
}

/**
 * Виконує universal model ladder тільки для unresolved cache misses.
 * @param {{pending: object[], cache: {entries: Record<string, unknown>}, state: {mappings: object[], unresolved: Set<string>}, modelPolicy: string[], submitBatchImpl: (model: string, items: Array<object>, options?: object) => Promise<Array<object>>, batchOptions: object}} input comparison execution state
 * @returns {Promise<{pending: object[], failures: Map<string, string>}>} exhausted work and failure reasons
 */
async function resolveWork({ pending: initialPending, cache, state, modelPolicy, submitBatchImpl, batchOptions }) {
  let pending = initialPending
  const failures = new Map()
  for (const tier of modelPolicy) {
    if (pending.length === 0) break
    const responses = await submitWave(pending, tier, submitBatchImpl, batchOptions)
    const retry = []
    for (const item of pending) {
      const response = responses.get(item.expected.id)
      const candidates = new Map(item.candidates.map(candidate => [candidate.id, candidate]))
      const checked = parseGapMappingResult(response?.ok, item.expected, candidates)
      if (checked.ok) {
        cache.entries[item.cacheKey] = response.ok
        acceptComparison(state, item, checked)
        failures.delete(item.expected.id)
      } else {
        failures.set(item.expected.id, response?.error ? 'comparison-batch-error' : checked.reason)
        retry.push(item)
      }
    }
    pending = retry
  }
  return { pending, failures }
}

/**
 * Порівнює expected claims із AS-IS claims до gap engine.
 *
 * Runner integration hook: викликати після entailment verification, перед
 * `evaluateGaps`, і передати `mappings` та `unresolvedExpectedClaimIds` у gate.
 * Точні canonical matches не викликають модель; відсутність same-subject
 * candidate детерміновано лишає expectation missing.
 * @param {{graph: Record<string, unknown>, cache?: {version?: number, entries?: Record<string, unknown>}, cachePath?: string, modelPolicy?: string[], promptVersion?: string, schemaVersion?: string, submitBatchImpl?: (model: string, items: Array<object>, options?: object) => Promise<Array<object>>, batchOptions?: object}} input comparison inputs
 * @returns {Promise<{ok: true, mappings: object[], unresolvedExpectedClaimIds: string[], cache: object} | {ok: false, diagnostics: object[], cache: object}>} comparison facts або blockers
 */
export async function compareClaimMappings({
  graph,
  cache: suppliedCache,
  cachePath,
  modelPolicy = DEFAULT_GAP_MAPPING_MODEL_POLICY,
  promptVersion = GAP_MAPPING_PROMPT_VERSION,
  schemaVersion = GAP_MAPPING_SCHEMA_VERSION,
  submitBatchImpl = submitBatchNative,
  batchOptions = {}
}) {
  const cache = await loadCache(cachePath, suppliedCache)
  const claims = comparisonClaims(graph)
  if (!claims.ok) return { ok: false, diagnostics: claims.diagnostics, cache: canonicalize(cache) }
  if (claims.expected.length === 0)
    return { ok: true, mappings: [], unresolvedExpectedClaimIds: [], cache: canonicalize(cache) }
  if (!Array.isArray(modelPolicy) || JSON.stringify(modelPolicy) !== JSON.stringify(DEFAULT_GAP_MAPPING_MODEL_POLICY)) {
    return {
      ok: false,
      diagnostics: [
        diagnostic('invalid-gap-mapping-model-policy', 'Comparator використовує universal policy min -> avg -> max.')
      ],
      cache: canonicalize(cache)
    }
  }
  const plan = planComparison(claims, { promptVersion, schemaVersion, modelPolicy })
  const state = { mappings: plan.mappings, unresolved: new Set() }
  const pending = selectPendingWork(plan.work, cache, state)
  const resolved = await resolveWork({ pending, cache, state, modelPolicy, submitBatchImpl, batchOptions })
  await saveCache(cachePath, cache)
  if (resolved.pending.length > 0) {
    return {
      ok: false,
      diagnostics: resolved.pending
        .map(item =>
          diagnostic(
            resolved.failures.get(item.expected.id) ?? 'unresolved-comparison',
            'Expected claim не пройшов strict semantic comparator.',
            item.expected.id
          )
        )
        .toSorted((left, right) => left.expectedClaimId.localeCompare(right.expectedClaimId)),
      cache: canonicalize(cache)
    }
  }
  return {
    ok: true,
    mappings: state.mappings.toSorted((left, right) =>
      `${left.expectedClaimId}:${left.implementedClaimId}:${left.relation}`.localeCompare(
        `${right.expectedClaimId}:${right.implementedClaimId}:${right.relation}`
      )
    ),
    unresolvedExpectedClaimIds: [...state.unresolved].toSorted(),
    cache: canonicalize(cache)
  }
}

/**
 * Будує evidence-backed implemented claims із semantic chunks через batch map/reduce.
 *
 * LLM лише добирає structured твердження для відомих deterministic references.
 * Canonical claim IDs, cache keys, coverage і final ordering належать цьому core,
 * тому неповний або невалідний result ніколи не стає candidate graph.
 * Кожна required semantic unit мусить мати evidence-backed claim зі stable
 * business/architecture taxonomy; довільні predicates та coverage bypass блокуються.
 */

import { submitBatch as submitBatchNative } from '@7n/llm-lib/batch'

import { canonicalHash as hash, canonicalize, loadVersionedCache, saveVersionedCache } from './deterministic.mjs'

/**
 * Версія schema для structured claims cache і validation.
 */
export const CLAIM_SCHEMA_VERSION = 'package-knowledge-claims-v2'
/**
 * Версія prompt contract для structured claims batch pipeline.
 */
export const CLAIM_PROMPT_VERSION = 'package-knowledge-claims-v2'
/**
 * Default model policy tiers для map/reduce escalation.
 */
export const DEFAULT_MODEL_POLICY = ['min', 'avg', 'max']

/** Stable evidence-backed categories permitted in behavioral claim prompts. */
export const BEHAVIORAL_CLAIM_TAXONOMY = Object.freeze([
  'purpose',
  'actor',
  'trigger',
  'precondition',
  'step',
  'business-rule',
  'state-change',
  'integration',
  'outcome',
  'alternative-flow',
  'error-flow',
  'responsibility',
  'config',
  'persistence'
])

const CACHE_VERSION = 1

/**
 * Створює stable blocker.
 * @param {string} code machine-readable failure code
 * @param {string} chunkId affected map/reduce chunk
 * @param {string} detail human-readable detail
 * @returns {{code: string, chunkId: string, detail: string}} blocker
 */
function blocker(code, chunkId, detail) {
  return { code, chunkId, detail }
}

/**
 * Перевіряє рядковий ID list і повертає sorted unique copy.
 * @param {unknown} value candidate ID list
 * @returns {string[] | null} IDs або null для malformed input
 */
function normalizedIds(value) {
  if (!Array.isArray(value) || value.some(id => typeof id !== 'string' || id === '')) return null
  if (new Set(value).size !== value.length) return null
  return [...value].toSorted()
}

/**
 * Створює canonical claim identity. LLM ніколи не передає цей ID у contract.
 * @param {{domainId: string, subjectId: string, predicate: string, value: unknown, evidenceIds: string[]}} input claim identity fields
 * @returns {string} deterministic graph claim ID
 */
export function createImplementedClaimId({ domainId, subjectId, predicate, value, evidenceIds }) {
  return `claim:${hash({ domainId, subjectId, predicate, value, evidenceIds: [...evidenceIds].toSorted() })}`
}

/**
 * Створює cache key, що залежить від parser/prompt/schema/model policy/content.
 * @param {{kind: 'map'|'reduce', parserVersion: string, promptVersion: string, schemaVersion: string, modelPolicy: string[], contentHash: string}} input cache dimensions
 * @returns {string} stable cache key
 */
export function createClaimsCacheKey({ kind, parserVersion, promptVersion, schemaVersion, modelPolicy, contentHash }) {
  return hash({ kind, parserVersion, promptVersion, schemaVersion, modelPolicy, contentHash })
}

/**
 * Створює persistent або in-memory successful-result cache.
 * @param {string | null | undefined} cachePath optional durable JSON cache path
 * @param {{version?: number, entries?: Record<string, unknown>} | undefined} suppliedCache injectable cache for tests/callers
 * @returns {Promise<{version: number, entries: Record<string, unknown>}>} normalized cache
 */

/**
 * Нормалізує map chunk без generated identities.
 * @param {unknown} raw candidate chunk
 * @param {number} index deterministic fallback sequence
 * @returns {{ok: true, chunk: Record<string, unknown>} | {ok: false, blocker: Record<string, string>}} normalized chunk або blocker
 */
function normalizeMapChunk(raw, index) {
  const chunkId = typeof raw?.id === 'string' && raw.id !== '' ? raw.id : `map:${index}`
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, blocker: blocker('invalid-chunk', chunkId, 'Chunk мусить бути object.') }
  }
  const requiredNodeIds = normalizedIds(raw.requiredNodeIds)
  const requiredEdgeIds = normalizedIds(raw.requiredEdgeIds ?? [])
  const allowedEvidenceIds = normalizedIds(raw.allowedEvidenceIds)
  const dependsOnChunkIds = normalizedIds(raw.dependsOnChunkIds ?? [])
  if (
    !requiredNodeIds ||
    !requiredEdgeIds ||
    !allowedEvidenceIds ||
    allowedEvidenceIds.length === 0 ||
    !dependsOnChunkIds ||
    !Number.isSafeInteger(raw.wave) ||
    raw.wave < 0 ||
    typeof raw.prompt !== 'string' ||
    raw.prompt === ''
  ) {
    return {
      ok: false,
      blocker: blocker(
        'invalid-chunk',
        chunkId,
        'Chunk потребує id, prompt, wave, requiredNodeIds[], allowedEvidenceIds[] і dependsOnChunkIds[].'
      )
    }
  }
  return {
    ok: true,
    chunk: {
      id: chunkId,
      prompt: raw.prompt,
      requiredNodeIds,
      requiredEdgeIds,
      allowedEvidenceIds,
      dependsOnChunkIds,
      wave: raw.wave,
      contentHash: typeof raw.contentHash === 'string' && raw.contentHash !== '' ? raw.contentHash : hash(raw)
    }
  }
}

/**
 * Валідує map dependency graph до LLM call: кожна залежність мусить існувати,
 * бути у попередній wave і не створювати цикл.
 * @param {Array<Record<string, unknown>>} chunks normalized map chunks
 * @param {Set<string>} graphEvidenceIds known graph evidence
 * @returns {{ok: true, byWave: Map<number, Array<Record<string, unknown>>>} | {ok: false, blockers: Array<Record<string, string>>}} validated execution plan or blockers
 */
function validateMapPlan(chunks, graphEvidenceIds) {
  const byId = new Map()
  const blockers = []
  for (const chunk of chunks) {
    if (byId.has(chunk.id)) blockers.push(blocker('duplicate-chunk-id', chunk.id, 'Chunk ID має бути унікальним.'))
    byId.set(chunk.id, chunk)
    if (chunk.allowedEvidenceIds.some(id => !graphEvidenceIds.has(id))) {
      blockers.push(blocker('unknown-chunk-evidence', chunk.id, 'Chunk посилається на evidence поза graph.'))
    }
  }
  for (const chunk of chunks) {
    for (const dependencyId of chunk.dependsOnChunkIds) {
      const dependency = byId.get(dependencyId)
      if (!dependency) {
        blockers.push(blocker('unknown-chunk-dependency', chunk.id, `Не знайдено dependency ${dependencyId}.`))
      } else if (dependency.wave >= chunk.wave) {
        blockers.push(
          blocker(
            'invalid-chunk-dependency-wave',
            chunk.id,
            `Dependency ${dependencyId} мусить бути у попередній wave.`
          )
        )
      }
    }
  }
  const visiting = new Set()
  const visited = new Set()
  const visit = chunk => {
    if (visiting.has(chunk.id)) {
      blockers.push(blocker('cyclic-chunk-dependency', chunk.id, 'Chunk dependency graph містить цикл.'))
      return
    }
    if (visited.has(chunk.id)) return
    visiting.add(chunk.id)
    for (const dependencyId of chunk.dependsOnChunkIds) {
      const dependency = byId.get(dependencyId)
      if (dependency) visit(dependency)
    }
    visiting.delete(chunk.id)
    visited.add(chunk.id)
  }
  for (const chunk of chunks) visit(chunk)
  if (blockers.length > 0) {
    return {
      ok: false,
      blockers: blockers.toSorted((left, right) =>
        `${left.code}:${left.chunkId}`.localeCompare(`${right.code}:${right.chunkId}`)
      )
    }
  }
  const byWave = new Map()
  for (const chunk of chunks) {
    const wave = byWave.get(chunk.wave) ?? []
    wave.push(chunk)
    byWave.set(chunk.wave, wave)
  }
  for (const wave of byWave.values()) wave.sort((left, right) => left.id.localeCompare(right.id))
  return { ok: true, byWave }
}

/**
 * Перевіряє graph references, доступні structured output.
 * @param {unknown} graph normalized package graph
 * @returns {{ok: true, domainId: string, nodeIds: Set<string>, edgeIds: Set<string>, evidenceIds: Set<string>} | {ok: false, blockers: Array<Record<string, string>>}} references або blockers
 */
function graphReferences(graph) {
  if (!graph || typeof graph !== 'object' || typeof graph.domain?.id !== 'string' || graph.domain.id === '') {
    return { ok: false, blockers: [blocker('invalid-graph', 'graph', 'Graph мусить мати domain.id.')] }
  }
  const collections = [
    ['nodes', 'nodeIds'],
    ['edges', 'edgeIds'],
    ['evidence', 'evidenceIds']
  ]
  const refs = { ok: true, domainId: graph.domain.id }
  for (const [collection, property] of collections) {
    if (
      !Array.isArray(graph[collection]) ||
      graph[collection].some(item => typeof item?.id !== 'string' || item.id === '')
    ) {
      return { ok: false, blockers: [blocker('invalid-graph', 'graph', `Graph має містити ${collection} з IDs.`)] }
    }
    refs[property] = new Set(graph[collection].map(item => item.id))
  }
  return refs
}

/**
 * Будує strict prompt envelope. LLM отримує тільки known IDs і content chunk.
 * @param {{kind: 'map'|'reduce', chunk: Record<string, unknown>, allowedEvidenceIds: Set<string>}} input prompt context
 * @returns {string} self-contained strict-JSON prompt
 */
function buildPrompt({ kind, chunk, allowedEvidenceIds }) {
  const contract = {
    claims: [
      {
        subjectId: '<known node ID>',
        predicate: '<non-empty relation>',
        value: '<JSON value>',
        evidenceIds: ['<known evidence ID>'],
        confidence: 1
      }
    ],
    coveredNodeIds: ['<all required node IDs covered by this result>'],
    coveredEdgeIds: ['<all required edge IDs covered by this result>']
  }
  return [
    'Return exactly one JSON object, without Markdown or prose.',
    'Do not return claim IDs, topic IDs, node IDs, edge IDs, or evidence IDs that are not supplied.',
    'Every claim needs at least one supplied evidence ID. Do not infer missing behavior.',
    `Use only the evidence-supported subset of this stable behavioral taxonomy: ${BEHAVIORAL_CLAIM_TAXONOMY.join(', ')}.`,
    'Each required node must have at least one claim; do not return a coverage-only or non-behavioral bypass marker.',
    'Private source symbols may support a claim, but describe their role and effect; never copy a private symbol name into a human-facing claim value.',
    `Stage: ${kind}.`,
    `Required node IDs: ${JSON.stringify(chunk.requiredNodeIds)}.`,
    `Required edge IDs: ${JSON.stringify(chunk.requiredEdgeIds)}.`,
    `Allowed evidence IDs: ${JSON.stringify([...allowedEvidenceIds].toSorted())}.`,
    `JSON schema example (keys and types are exact): ${JSON.stringify(contract)}.`,
    `Analysis input: ${chunk.prompt}`
  ].join('\n')
}

/**
 * Перевіряє exact object keys для strict LLM JSON.
 * @param {Record<string, unknown>} value candidate object
 * @param {string[]} expected exact required keys
 * @returns {boolean} true when exact
 */
function hasExactKeys(value, expected) {
  const keys = Object.keys(value).toSorted()
  return keys.length === expected.length && keys.every((key, index) => key === expected.toSorted()[index])
}

/**
 * Parses and validates one strict LLM result against deterministic references.
 * @param {string} text raw LLM response
 * @param {{domainId: string, nodeIds: Set<string>, edgeIds: Set<string>, evidenceIds: Set<string>}} refs known graph references
 * @param {{id: string, requiredNodeIds: string[], requiredEdgeIds: string[], allowedEvidenceIds: string[]}} chunk covered work unit
 * @returns {{ok: true, result: Record<string, unknown>} | {ok: false, reason: string}} accepted result or a fail-closed reason
 */
export function parseClaimsResult(text, refs, chunk) {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'invalid-json' }
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    !hasExactKeys(parsed, ['claims', 'coveredNodeIds', 'coveredEdgeIds'])
  ) {
    return { ok: false, reason: 'invalid-json-shape' }
  }
  const coveredNodeIds = normalizedIds(parsed.coveredNodeIds)
  const coveredEdgeIds = normalizedIds(parsed.coveredEdgeIds)
  if (!coveredNodeIds || !coveredEdgeIds) return { ok: false, reason: 'invalid-coverage-refs' }
  if (
    coveredNodeIds.some(id => !refs.nodeIds.has(id)) ||
    coveredEdgeIds.some(id => !refs.edgeIds.has(id)) ||
    chunk.requiredNodeIds.some(id => !coveredNodeIds.includes(id)) ||
    chunk.requiredEdgeIds.some(id => !coveredEdgeIds.includes(id))
  ) {
    return { ok: false, reason: 'coverage-incomplete' }
  }
  if (!Array.isArray(parsed.claims)) return { ok: false, reason: 'invalid-claims' }
  const claims = []
  for (const rawClaim of parsed.claims) {
    if (!rawClaim || typeof rawClaim !== 'object' || Array.isArray(rawClaim))
      return { ok: false, reason: 'invalid-claim' }
    if (!hasExactKeys(rawClaim, ['subjectId', 'predicate', 'value', 'evidenceIds', 'confidence'])) {
      return { ok: false, reason: 'invalid-claim-shape' }
    }
    const evidenceIds = normalizedIds(rawClaim.evidenceIds)
    if (
      typeof rawClaim.subjectId !== 'string' ||
      !refs.nodeIds.has(rawClaim.subjectId) ||
      !chunk.requiredNodeIds.includes(rawClaim.subjectId) ||
      typeof rawClaim.predicate !== 'string' ||
      !BEHAVIORAL_CLAIM_TAXONOMY.includes(rawClaim.predicate) ||
      !evidenceIds ||
      evidenceIds.length === 0 ||
      evidenceIds.some(id => !refs.evidenceIds.has(id) || !chunk.allowedEvidenceIds.includes(id)) ||
      typeof rawClaim.confidence !== 'number' ||
      rawClaim.confidence < 0 ||
      rawClaim.confidence > 1
    ) {
      return { ok: false, reason: 'invalid-claim-refs' }
    }
    claims.push({
      id: createImplementedClaimId({
        domainId: refs.domainId,
        subjectId: rawClaim.subjectId,
        predicate: rawClaim.predicate,
        value: rawClaim.value,
        evidenceIds
      }),
      subjectId: rawClaim.subjectId,
      layer: 'implemented',
      predicate: rawClaim.predicate,
      value: canonicalize(rawClaim.value),
      evidenceIds,
      confidence: rawClaim.confidence,
      sourceFingerprint: hash({ chunkId: chunk.id, claim: rawClaim })
    })
  }
  const claimedNodeIds = new Set(claims.map(claim => claim.subjectId))
  if (chunk.requiredNodeIds.some(id => !claimedNodeIds.has(id))) {
    return { ok: false, reason: 'behavioral-coverage-incomplete' }
  }
  return {
    ok: true,
    result: {
      claims: claims.toSorted((left, right) => left.id.localeCompare(right.id)),
      coveredNodeIds,
      coveredEdgeIds
    }
  }
}

/**
 * Обробляє один batch wave й повертає тільки results, зіставлені за customId.
 * @param {Array<Record<string, unknown>>} pending unresolved work units
 * @param {string} tier universal model tier
 * @param {(model: string, items: Array<object>, options?: object) => Promise<Array<object>>} submitBatchImpl injectable batch transport
 * @param {object} batchOptions transport options
 * @returns {Promise<Map<string, Record<string, unknown>>>} results by work ID; thrown transport becomes empty map
 */
async function runBatchWave(pending, tier, submitBatchImpl, batchOptions) {
  if (pending.length === 0) return new Map()
  try {
    const results = await submitBatchImpl(
      tier,
      pending.map(item => ({ customId: item.id, prompt: item.prompt })),
      batchOptions
    )
    if (!Array.isArray(results)) return new Map()
    return new Map(
      results.filter(result => typeof result?.customId === 'string').map(result => [result.customId, result])
    )
  } catch {
    return new Map()
  }
}

/**
 * Повертає work units, які не мають valid cached successful result.
 * @param {Array<Record<string, unknown>>} work units from map/reduce level
 * @param {{entries: Record<string, unknown>}} cache successful cache
 * @param {Record<string, unknown>} refs graph references
 * @returns {{accepted: Map<string, Record<string, unknown>>, pending: Array<Record<string, unknown>>}} cache hits and misses
 */
function selectCachedWork(work, cache, refs) {
  const accepted = new Map()
  const pending = []
  for (const item of work) {
    const cached = cache.entries[item.cacheKey]
    const checked = cached ? parseClaimsResult(cached, refs, item) : { ok: false }
    if (checked.ok) accepted.set(item.id, checked.result)
    else pending.push(item)
  }
  return { accepted, pending }
}

/**
 * Runs one logical wave with local per-item escalation and successful cache writes.
 * @param {{work: Array<Record<string, unknown>>, cache: Record<string, unknown>, refs: Record<string, unknown>, modelPolicy: string[], submitBatchImpl: (model: string, items: Array<object>, options?: object) => Promise<Array<object>>, batchOptions: object}} input wave context
 * @returns {Promise<{results: Map<string, Record<string, unknown>>, blockers: Array<Record<string, string>>}>} completed results or local blockers
 */
async function resolveWave({ work, cache, refs, modelPolicy, submitBatchImpl, batchOptions }) {
  const cached = selectCachedWork(work, cache, refs)
  const results = cached.accepted
  let pending = cached.pending
  const failures = new Map()
  for (const tier of modelPolicy) {
    if (pending.length === 0) break
    const responses = await runBatchWave(pending, tier, submitBatchImpl, batchOptions)
    const retry = []
    for (const item of pending) {
      const response = responses.get(item.id)
      if (typeof response?.ok !== 'string') {
        failures.set(item.id, response?.error ? 'batch-item-error' : 'missing-result')
        retry.push(item)
        continue
      }
      const checked = parseClaimsResult(response.ok, refs, item)
      if (!checked.ok) {
        failures.set(item.id, checked.reason)
        retry.push(item)
        continue
      }
      results.set(item.id, checked.result)
      cache.entries[item.cacheKey] = response.ok
      failures.delete(item.id)
    }
    pending = retry
  }
  return {
    results,
    blockers: pending.map(item =>
      blocker(failures.get(item.id) ?? 'unresolved-chunk', item.id, 'LLM result не пройшов local model ladder.')
    )
  }
}

/**
 * Готує один map work item після завершення всіх declared dependencies.
 * Dependency claims стають єдиним додатковим evidence context для caller-а;
 * глобальні graph evidence не відкриваються за межами його chunk scope.
 * @param {Record<string, unknown>} chunk normalized map chunk
 * @param {Map<string, Record<string, unknown>>} completed dependency results
 * @param {{parserVersion: string, promptVersion: string, schemaVersion: string, modelPolicy: string[]}} policy cache dimensions
 * @returns {Record<string, unknown>} strict map work item
 */
function createMapWork(chunk, completed, policy) {
  const dependencies = chunk.dependsOnChunkIds.map(id => ({ id, result: completed.get(id) }))
  const dependencyClaims = dependencies.flatMap(item => item.result.claims)
  const allowedEvidenceIds = [
    ...new Set([...chunk.allowedEvidenceIds, ...dependencyClaims.flatMap(claim => claim.evidenceIds)])
  ].toSorted()
  const dependencySummaries = dependencies.map(({ id, result }) => ({
    id,
    claims: result.claims,
    coveredNodeIds: result.coveredNodeIds,
    coveredEdgeIds: result.coveredEdgeIds
  }))
  const content = {
    contentHash: chunk.contentHash,
    wave: chunk.wave,
    dependsOnChunkIds: chunk.dependsOnChunkIds,
    allowedEvidenceIds,
    dependencySummaries
  }
  const work = {
    ...chunk,
    allowedEvidenceIds,
    contentHash: hash(content),
    prompt: JSON.stringify(canonicalize({ source: chunk.prompt, dependencySummaries }))
  }
  return {
    ...work,
    cacheKey: createClaimsCacheKey({ kind: 'map', ...policy, contentHash: work.contentHash }),
    prompt: buildPrompt({ kind: 'map', chunk: work, allowedEvidenceIds: new Set(allowedEvidenceIds) })
  }
}

/**
 * Виконує map chunks у порядку dependency waves. Пізніший chunk фізично не
 * потрапляє в batch до successful/cached canonical result усіх dependencies.
 * @param {{byWave: Map<number, Array<Record<string, unknown>>>, cache: Record<string, unknown>, refs: Record<string, unknown>, policy: Record<string, unknown>, modelPolicy: string[], submitBatchImpl: (model: string, items: Array<object>, options?: object) => Promise<Array<object>>, batchOptions: object}} input map execution state
 * @returns {Promise<{ok: true, work: Array<Record<string, unknown>>, results: Map<string, Record<string, unknown>>, allResults: Array<Record<string, unknown>>} | {ok: false, blockers: Array<Record<string, string>>}>} completed map work or blockers
 */
async function resolveMapWaves({ byWave, cache, refs, policy, modelPolicy, submitBatchImpl, batchOptions }) {
  const results = new Map()
  const work = []
  const allResults = []
  for (const wave of byWave
    .keys()
    .toArray()
    .toSorted((left, right) => left - right)) {
    const waveWork = byWave.get(wave).map(chunk => createMapWork(chunk, results, policy))
    const resolved = await resolveWave({ work: waveWork, cache, refs, modelPolicy, submitBatchImpl, batchOptions })
    if (resolved.blockers.length > 0) return { ok: false, blockers: resolved.blockers }
    for (const item of waveWork) {
      const result = resolved.results.get(item.id)
      results.set(item.id, result)
      allResults.push(result)
    }
    work.push(...waveWork)
  }
  return { ok: true, work, results, allResults }
}

/**
 * Групує finished children для наступного hierarchical reduce level.
 * @param {Array<Record<string, unknown>>} children completed child work units
 * @param {number} fanIn maximum children per reduce item
 * @returns {Array<Array<Record<string, unknown>>>} stable groups
 */
function reduceGroups(children, fanIn) {
  const groups = []
  const sorted = [...children].toSorted((left, right) => left.id.localeCompare(right.id))
  for (let index = 0; index < sorted.length; index += fanIn) groups.push(sorted.slice(index, index + fanIn))
  return groups
}

/**
 * Створює next-level reduce work із verified child results без source text.
 * @param {Array<Array<Record<string, unknown>>>} groups child groups
 * @param {Map<string, Record<string, unknown>>} results completed child results
 * @param {{parserVersion: string, promptVersion: string, schemaVersion: string, modelPolicy: string[]}} policy cache dimensions
 * @param {number} level reduce level
 * @returns {Array<Record<string, unknown>>} next hierarchical work
 */
function createReduceWork(groups, results, policy, level) {
  return groups.map((group, index) => {
    const childResults = group.map(child => results.get(child.id))
    const requiredNodeIds = [...new Set(childResults.flatMap(result => result.coveredNodeIds))].toSorted()
    const requiredEdgeIds = [...new Set(childResults.flatMap(result => result.coveredEdgeIds))].toSorted()
    const claims = childResults.flatMap(result => result.claims)
    const allowedEvidenceIds = [...new Set(claims.flatMap(claim => claim.evidenceIds))].toSorted()
    const id = `reduce:${level}:${index}`
    const content = { childIds: group.map(child => child.id), claims, requiredNodeIds, requiredEdgeIds }
    const chunk = {
      id,
      prompt: JSON.stringify(canonicalize(content)),
      requiredNodeIds,
      requiredEdgeIds,
      allowedEvidenceIds,
      contentHash: hash(content)
    }
    const cacheKey = createClaimsCacheKey({ kind: 'reduce', ...policy, contentHash: chunk.contentHash })
    return { ...chunk, cacheKey, prompt: buildPrompt({ kind: 'reduce', chunk, allowedEvidenceIds }) }
  })
}

/**
 * Дедуплікує claims за deterministic identity і зберігає stable output.
 * @param {Array<Record<string, unknown>>} results structured map/reduce results
 * @returns {Array<Record<string, unknown>>} unique sorted claims
 */
function collectClaims(results) {
  const byId = new Map()
  for (const result of results) {
    for (const claim of result.claims) byId.set(claim.id, claim)
  }
  return byId
    .values()
    .toArray()
    .toSorted((left, right) => left.id.localeCompare(right.id))
}

/**
 * Повертає cache snapshot у byte-stable key order, не змінюючи injected cache.
 * @param {{version: number, entries: Record<string, unknown>}} cache cache state
 * @returns {{version: number, entries: Record<string, unknown>}} stable cache snapshot
 */
function cacheSnapshot(cache) {
  return canonicalize(cache)
}

/**
 * Executes structured LLM claims map/reduce without candidate publication.
 *
 * Each wave has one `submitBatch` call per universal tier and retries only the
 * failed items on a stronger tier. A missing, invalid, or uncovered result is a
 * blocking diagnostic; no whole-domain retry or fallback claim is produced.
 * @param {{
 *   graph: Record<string, unknown>, chunks: unknown[], parserVersion: string,
 *   promptVersion?: string, schemaVersion?: string, modelPolicy?: string[],
 *   reduceFanIn?: number, cache?: {version?: number, entries?: Record<string, unknown>},
 *   cachePath?: string,
 *   submitBatchImpl?: (model: string, items: Array<object>, options?: object) => Promise<Array<object>>,
 *   batchOptions?: object
 * }} input structured analysis inputs
 * @returns {Promise<{ok: true, claims: Array<Record<string, unknown>>, coverage: {nodeIds: string[], edgeIds: string[]}, cache: Record<string, unknown>} | {ok: false, blockers: Array<Record<string, string>>, cache: Record<string, unknown>}>} complete claims or blockers
 */
export async function buildStructuredClaims({
  graph,
  chunks,
  parserVersion,
  promptVersion = CLAIM_PROMPT_VERSION,
  schemaVersion = CLAIM_SCHEMA_VERSION,
  modelPolicy = DEFAULT_MODEL_POLICY,
  reduceFanIn = 2,
  cache: suppliedCache,
  cachePath,
  submitBatchImpl = submitBatchNative,
  batchOptions = {}
}) {
  const cache = await loadVersionedCache(cachePath, suppliedCache, CACHE_VERSION)
  const refs = graphReferences(graph)
  if (!refs.ok) return { ok: false, blockers: refs.blockers, cache: cacheSnapshot(cache) }
  if (typeof parserVersion !== 'string' || parserVersion === '') {
    return {
      ok: false,
      blockers: [blocker('invalid-parser-version', 'graph', 'parserVersion мусить бути непорожнім.')],
      cache: cacheSnapshot(cache)
    }
  }
  if (!Array.isArray(chunks) || chunks.length === 0) {
    return {
      ok: false,
      blockers: [blocker('missing-required-chunks', 'map', 'Потрібен непорожній chunks[].')],
      cache: cacheSnapshot(cache)
    }
  }
  if (
    !Array.isArray(modelPolicy) ||
    modelPolicy.length === 0 ||
    modelPolicy.some(tier => !['min', 'avg', 'max'].includes(tier))
  ) {
    return {
      ok: false,
      blockers: [blocker('invalid-model-policy', 'map', 'modelPolicy має містити universal tiers min/avg/max.')],
      cache: cacheSnapshot(cache)
    }
  }
  if (!Number.isSafeInteger(reduceFanIn) || reduceFanIn < 2) {
    return {
      ok: false,
      blockers: [blocker('invalid-reduce-fan-in', 'reduce', 'reduceFanIn мусить бути integer >= 2.')],
      cache: cacheSnapshot(cache)
    }
  }

  const normalized = chunks.map((chunk, index) => normalizeMapChunk(chunk, index))
  const invalidChunks = normalized.filter(result => !result.ok).map(result => result.blocker)
  if (invalidChunks.length > 0) {
    return {
      ok: false,
      blockers: invalidChunks.toSorted((left, right) => left.chunkId.localeCompare(right.chunkId)),
      cache: cacheSnapshot(cache)
    }
  }
  const plan = validateMapPlan(
    normalized.map(result => result.chunk),
    refs.evidenceIds
  )
  if (!plan.ok) {
    return { ok: false, blockers: plan.blockers, cache: cacheSnapshot(cache) }
  }
  const policy = { parserVersion, promptVersion, schemaVersion, modelPolicy: [...modelPolicy] }
  const mapped = await resolveMapWaves({
    byWave: plan.byWave,
    cache,
    refs,
    policy,
    modelPolicy,
    submitBatchImpl,
    batchOptions
  })
  if (!mapped.ok) {
    await saveVersionedCache(cachePath, cache)
    return {
      ok: false,
      blockers: mapped.blockers.toSorted((left, right) => left.chunkId.localeCompare(right.chunkId)),
      cache: cacheSnapshot(cache)
    }
  }
  const allResults = [...mapped.allResults]
  let work = mapped.work
  let level = 0
  while (work.length > 0) {
    if (level === 0) {
      if (work.length === 1) {
        const final = mapped.results.get(work[0].id)
        await saveVersionedCache(cachePath, cache)
        return {
          ok: true,
          claims: collectClaims(allResults),
          coverage: { nodeIds: final.coveredNodeIds, edgeIds: final.coveredEdgeIds },
          cache: cacheSnapshot(cache)
        }
      }
      work = createReduceWork(reduceGroups(work, reduceFanIn), mapped.results, policy, level)
      level++
      continue
    }
    const resolved = await resolveWave({ work, cache, refs, modelPolicy, submitBatchImpl, batchOptions })
    if (resolved.blockers.length > 0) {
      await saveVersionedCache(cachePath, cache)
      return {
        ok: false,
        blockers: resolved.blockers.toSorted((left, right) => left.chunkId.localeCompare(right.chunkId)),
        cache: cacheSnapshot(cache)
      }
    }
    const levelResults = work.map(item => resolved.results.get(item.id))
    allResults.push(...levelResults)
    if (work.length === 1) {
      const final = levelResults[0]
      await saveVersionedCache(cachePath, cache)
      return {
        ok: true,
        claims: collectClaims(allResults),
        coverage: { nodeIds: final.coveredNodeIds, edgeIds: final.coveredEdgeIds },
        cache: cacheSnapshot(cache)
      }
    }
    work = createReduceWork(reduceGroups(work, reduceFanIn), resolved.results, policy, level)
    level++
  }
  return {
    ok: false,
    blockers: [blocker('missing-results', 'reduce', 'Reduce не повернув final result.')],
    cache: cacheSnapshot(cache)
  }
}

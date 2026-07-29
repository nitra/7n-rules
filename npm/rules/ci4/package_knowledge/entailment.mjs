/**
 * Верифікує, що implemented і expected claims справді випливають з локального
 * тексту їхнього evidence. Gate не синтезує і не переписує claims: він лише
 * пропускає канонічний graph далі або повертає blocking diagnostics.
 */

import { submitBatch as submitBatchNative } from '@7n/llm-lib/batch'

import { canonicalHash as hash, canonicalize, loadVersionedCache, saveVersionedCache } from './deterministic.mjs'

/**
 * Версія strict entailment response schema і cache entries.
 */
export const ENTAILMENT_SCHEMA_VERSION = 'package-knowledge-entailment-v1'
/**
 * Версія prompt contract для evidence entailment verifier.
 */
export const ENTAILMENT_PROMPT_VERSION = 'package-knowledge-entailment-v1'
/**
 * Єдина допустима universal model ladder для semantic verification.
 */
export const DEFAULT_ENTAILMENT_MODEL_POLICY = ['min', 'avg', 'max']

const CACHE_VERSION = 1

/**
 * Створює stable blocking diagnostic entailment gate.
 * @param {string} code machine-readable failure code
 * @param {string} message human-readable detail
 * @param {string | null} [claimId] affected claim identity
 * @returns {{code: string, message: string, claimId: string | null}} diagnostic
 */
function diagnostic(code, message, claimId = null) {
  return { code, message, claimId }
}

/**
 * Повертає persistent або injected successful-result cache.
 * @param {string | undefined} cachePath optional durable cache path
 * @param {{version?: number, entries?: Record<string, unknown>} | undefined} suppliedCache injected cache
 * @returns {Promise<{version: number, entries: Record<string, unknown>}>} normalized cache
 */

/**
 * Нормалізує content map незалежно від Map або plain object input.
 * @param {unknown} evidenceContentById local exact source slices
 * @param {string} evidenceId requested evidence identity
 * @returns {string | null} non-empty source text or null
 */
function evidenceContent(evidenceContentById, evidenceId) {
  if (evidenceContentById instanceof Map) {
    const value = evidenceContentById.get(evidenceId)
    return typeof value === 'string' && value !== '' ? value : null
  }
  if (
    !evidenceContentById ||
    typeof evidenceContentById !== 'object' ||
    Array.isArray(evidenceContentById) ||
    !Object.hasOwn(evidenceContentById, evidenceId)
  ) {
    return null
  }
  const value = evidenceContentById[evidenceId]
  return typeof value === 'string' && value !== '' ? value : null
}

/**
 * Перевіряє claim identity і збирає тільки його local evidence text.
 * @param {unknown} claim graph claim
 * @param {unknown} evidenceContentById local exact source slices
 * @returns {{ok: true, work: Record<string, unknown>} | {ok: false, diagnostic: Record<string, string | null>}} work або blocker
 */
function prepareClaim(claim, evidenceContentById) {
  const claimId = claim && typeof claim === 'object' && typeof claim.id === 'string' ? claim.id : null
  if (
    !claim ||
    typeof claim !== 'object' ||
    Array.isArray(claim) ||
    !claimId ||
    !Array.isArray(claim.evidenceIds) ||
    claim.evidenceIds.length === 0
  ) {
    return {
      ok: false,
      diagnostic: diagnostic('invalid-entailment-claim', 'Claim мусить мати id та непорожній evidenceIds[].', claimId)
    }
  }
  if (
    claim.evidenceIds.some(id => typeof id !== 'string' || id === '') ||
    new Set(claim.evidenceIds).size !== claim.evidenceIds.length
  ) {
    return {
      ok: false,
      diagnostic: diagnostic('invalid-entailment-evidence', 'Claim має невалідний evidenceIds[].', claimId)
    }
  }
  const evidence = claim.evidenceIds.toSorted().map(id => ({ id, content: evidenceContent(evidenceContentById, id) }))
  const missing = evidence.find(item => item.content === null)
  if (missing) {
    return {
      ok: false,
      diagnostic: diagnostic(
        'missing-evidence-content',
        `Немає local source content для evidence ${missing.id}.`,
        claimId
      )
    }
  }
  return {
    ok: true,
    work: {
      id: claim.id,
      claim: canonicalize(claim),
      evidence,
      evidenceFingerprint: hash(evidence),
      prompt: [
        'Verify whether every asserted field of claim is entailed by the exact local evidence.',
        'Do not rewrite, repair, infer beyond evidence, or return a replacement claim.',
        'Return exactly one JSON object with only claimId, entails, unsupportedFields.',
        'entails must be boolean; unsupportedFields must be an empty string array only when entails is true.',
        JSON.stringify({ claim: canonicalize(claim), evidence })
      ].join('\n')
    }
  }
}

/**
 * Створює per-claim cache key з canonical claim, evidence text fingerprint і policy.
 * @param {{claim: Record<string, unknown>, evidenceFingerprint: string, promptVersion: string, schemaVersion: string, modelPolicy: string[]}} input cache dimensions
 * @returns {string} stable cache key
 */
export function createEntailmentCacheKey({ claim, evidenceFingerprint, promptVersion, schemaVersion, modelPolicy }) {
  return hash({ claim, evidenceFingerprint, promptVersion, schemaVersion, modelPolicy })
}

/**
 * Парсить єдиний strict verifier response без поблажливого coercion.
 * @param {unknown} text raw model response
 * @param {string} claimId expected canonical claim identity
 * @returns {{ok: true} | {ok: false, reason: string}} accepted response або reason
 */
export function parseEntailmentResult(text, claimId) {
  if (typeof text !== 'string') return { ok: false, reason: 'invalid-entailment-json' }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'invalid-entailment-json' }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    return { ok: false, reason: 'invalid-entailment-shape' }
  const keys = Object.keys(parsed).toSorted()
  if (JSON.stringify(keys) !== JSON.stringify(['claimId', 'entails', 'unsupportedFields'])) {
    return { ok: false, reason: 'invalid-entailment-shape' }
  }
  if (
    parsed.claimId !== claimId ||
    typeof parsed.entails !== 'boolean' ||
    !Array.isArray(parsed.unsupportedFields) ||
    parsed.unsupportedFields.some(field => typeof field !== 'string' || field === '')
  ) {
    return { ok: false, reason: 'invalid-entailment-shape' }
  }
  if (new Set(parsed.unsupportedFields).size !== parsed.unsupportedFields.length) {
    return { ok: false, reason: 'invalid-entailment-shape' }
  }
  if (parsed.entails !== true || parsed.unsupportedFields.length !== 0)
    return { ok: false, reason: 'claim-not-entailed' }
  return { ok: true }
}

/**
 * Надсилає один universal tier і перетворює transport error на retryable miss.
 * @param {Array<Record<string, unknown>>} pending unresolved claims
 * @param {string} tier model tier
 * @param {(model: string, items: Array<object>, options?: object) => Promise<Array<object>>} submitBatchImpl batch transport
 * @param {object} batchOptions transport options
 * @returns {Promise<Map<string, Record<string, unknown>>>} responses by claim id
 */
async function submitWave(pending, tier, submitBatchImpl, batchOptions) {
  try {
    const responses = await submitBatchImpl(
      tier,
      pending.map(item => ({ customId: item.id, prompt: item.prompt })),
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
 * Відокремлює тільки verifier misses; валідні cache hits не потребують transport.
 * @param {Array<Record<string, unknown>>} work complete per-claim work
 * @param {{entries: Record<string, unknown>}} cache successful verifier cache
 * @returns {Array<Record<string, unknown>>} unresolved claims
 */
function selectPendingWork(work, cache) {
  return work.filter(item => !parseEntailmentResult(cache.entries[item.cacheKey], item.id).ok)
}

/**
 * Верифікує immutable graph claims проти exact local evidence до gap/render.
 *
 * Runner integration hook: викликати після claims плюс Expected overlay та до
 * gap/render; передати source slices за кожним evidence ID і продовжити лише
 * коли `ok: true`. Gate ніколи не повертає переписані claims.
 * @param {{graph: Record<string, unknown>, evidenceContentById: Record<string, string> | Map<string, string>, cache?: {version?: number, entries?: Record<string, unknown>}, cachePath?: string, modelPolicy?: string[], promptVersion?: string, schemaVersion?: string, submitBatchImpl?: (model: string, items: Array<object>, options?: object) => Promise<Array<object>>, batchOptions?: object}} input verifier inputs
 * @returns {Promise<{ok: true, claims: object[], cache: object} | {ok: false, diagnostics: object[], cache: object}>} immutable claims або blockers
 */
export async function verifyEvidenceEntailment({
  graph,
  evidenceContentById,
  cache: suppliedCache,
  cachePath,
  modelPolicy = DEFAULT_ENTAILMENT_MODEL_POLICY,
  promptVersion = ENTAILMENT_PROMPT_VERSION,
  schemaVersion = ENTAILMENT_SCHEMA_VERSION,
  submitBatchImpl = submitBatchNative,
  batchOptions = {}
}) {
  const cache = await loadVersionedCache(cachePath, suppliedCache, CACHE_VERSION)
  if (!graph || typeof graph !== 'object' || Array.isArray(graph) || !Array.isArray(graph.claims)) {
    return {
      ok: false,
      diagnostics: [diagnostic('invalid-entailment-graph', 'Graph мусить містити claims[].')],
      cache: canonicalize(cache)
    }
  }
  const claims = graph.claims.filter(claim => claim?.layer === 'implemented' || claim?.layer === 'expected')
  if (claims.length === 0) return { ok: true, claims: graph.claims, cache: canonicalize(cache) }
  const prepared = claims.map(claim => prepareClaim(claim, evidenceContentById))
  const invalid = prepared.filter(item => !item.ok).map(item => item.diagnostic)
  if (invalid.length > 0) {
    return {
      ok: false,
      diagnostics: invalid.toSorted((left, right) =>
        `${left.claimId}:${left.code}`.localeCompare(`${right.claimId}:${right.code}`)
      ),
      cache: canonicalize(cache)
    }
  }
  if (!Array.isArray(modelPolicy) || JSON.stringify(modelPolicy) !== JSON.stringify(DEFAULT_ENTAILMENT_MODEL_POLICY)) {
    return {
      ok: false,
      diagnostics: [
        diagnostic('invalid-entailment-model-policy', 'Entailment використовує universal policy min -> avg -> max.')
      ],
      cache: canonicalize(cache)
    }
  }
  if (
    typeof promptVersion !== 'string' ||
    promptVersion === '' ||
    typeof schemaVersion !== 'string' ||
    schemaVersion === ''
  ) {
    return {
      ok: false,
      diagnostics: [diagnostic('invalid-entailment-version', 'promptVersion і schemaVersion мають бути непорожніми.')],
      cache: canonicalize(cache)
    }
  }
  const work = prepared.map(item => {
    const cacheKey = createEntailmentCacheKey({ ...item.work, promptVersion, schemaVersion, modelPolicy })
    return { ...item.work, cacheKey }
  })
  const failures = new Map()
  let pending = selectPendingWork(work, cache)
  for (const tier of modelPolicy) {
    if (pending.length === 0) break
    const responses = await submitWave(pending, tier, submitBatchImpl, batchOptions)
    const retry = []
    for (const item of pending) {
      const response = responses.get(item.id)
      const checked = parseEntailmentResult(response?.ok, item.id)
      if (!checked.ok) {
        failures.set(item.id, response?.error ? 'entailment-batch-error' : checked.reason)
        retry.push(item)
        continue
      }
      cache.entries[item.cacheKey] = response.ok
      failures.delete(item.id)
    }
    pending = retry
  }
  await saveVersionedCache(cachePath, cache)
  if (pending.length > 0) {
    return {
      ok: false,
      diagnostics: pending
        .map(item =>
          diagnostic(
            failures.get(item.id) ?? 'unresolved-entailment',
            'Claim не пройшов strict evidence entailment verifier.',
            item.id
          )
        )
        .toSorted((left, right) => `${left.claimId}:${left.code}`.localeCompare(`${right.claimId}:${right.code}`)),
      cache: canonicalize(cache)
    }
  }
  return { ok: true, claims: graph.claims, cache: canonicalize(cache) }
}

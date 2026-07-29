/**
 * Знаходить explicit Expected sources і строго мапить їх на package graph.
 *
 * Markdown zones/ADR/spec scope та parser-backed JS/Rust/Python/PHP test scenarios
 * збираються детерміновано. Expected claims використовують ту саму stable
 * behavioral taxonomy, що й Implemented claims.
 * LLM бачить лише source evidence і canonical graph IDs; malformed або ambiguous
 * result блокує candidate, а не перетворюється на припущення про expectation.
 */

import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'

import { globby } from 'globby'

import { BEHAVIORAL_CLAIM_TAXONOMY } from './claims.mjs'
import { parseKnowledgeZones } from './zones.mjs'

const DEFAULT_MODEL_POLICY = Object.freeze(['min', 'avg', 'max'])
const CACHE_VERSION = 1
const SOURCE_SCOPE_RE = /<!--\s*PACKAGE-KNOWLEDGE:domain\s+id="([^"]+)"\s*-->/gu
const SOURCE_SCOPE_LIKE_RE = /<!--\s*PACKAGE-KNOWLEDGE:domain\b/gu
const ACCEPTED_ADR_STATUS_RE = /^(?:\*\*)Status:(?:\*\*)\s+Accepted\s*$/mu
const IGNORED_PATHS = Object.freeze([
  '**/.git/**',
  '**/.worktrees/**',
  '**/node_modules/**',
  '**/vendor/**',
  '**/dist/**',
  '**/build/**',
  '**/coverage/**',
  '**/.venv/**',
  '**/venv/**'
])

/**
 * Створює стабільний SHA-256 fingerprint JSON-подібного значення.
 * @param {unknown} value input
 * @returns {string} prefixed SHA-256
 */
function hash(value) {
  return `sha256:${createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex')}`
}

/**
 * Канонізує JSON-подібне значення для stable cache/output.
 * @param {unknown} value input
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
 * Повертає stable blocking diagnostic.
 * @param {string} code machine-readable code
 * @param {string} detail user-facing detail
 * @param {string | null} [path] related source path
 * @returns {{code: string, detail: string, path: string | null}} diagnostic
 */
function diagnostic(code, detail, path = null) {
  return { code, detail, path }
}

/**
 * Нормалізує filesystem path до POSIX form.
 * @param {string} path filesystem path
 * @returns {string} portable path
 */
function toPosix(path) {
  return path.split(sep).join('/')
}

/**
 * Повертає byte span OXC/Markdown code-unit offsets.
 * @param {string} content source text
 * @param {number} start UTF-16 offset
 * @param {number} end UTF-16 offset
 * @returns {{startByte: number, endByte: number}} UTF-8 byte span
 */
function byteSpan(content, start, end) {
  return {
    startByte: Buffer.byteLength(content.slice(0, start), 'utf8'),
    endByte: Buffer.byteLength(content.slice(0, end), 'utf8')
  }
}

/**
 * Витягує рівно один domain scope з strict machine marker-а.
 * @param {string} markdown authored Markdown
 * @param {string} path source path
 * @returns {{ok: true, domainId: string | null} | {ok: false, diagnostics: object[]}} exact scope або blocker
 */
function sourceScope(markdown, path) {
  const parsedMarkers = Array.from(markdown.matchAll(SOURCE_SCOPE_RE), match => ({ id: match[1], start: match.index }))
  const markers = parsedMarkers.map(marker => marker.id)
  const markerStarts = new Set(parsedMarkers.map(marker => marker.start))
  const diagnostics = []
  for (const marker of markdown.matchAll(SOURCE_SCOPE_LIKE_RE)) {
    if (!markerStarts.has(marker.index)) {
      diagnostics.push(
        diagnostic('invalid-expected-source-scope', 'Domain scope marker має містити non-empty id="...".', path)
      )
    }
  }
  if (new Set(markers).size > 1 || markers.length > 1) {
    diagnostics.push(
      diagnostic('ambiguous-expected-source-scope', 'ADR/spec мусить бути scoped рівно до одного domain.', path)
    )
  }
  if (markers.some(id => id === '')) {
    diagnostics.push(
      diagnostic('invalid-expected-source-scope', 'Domain scope marker має містити non-empty id="...".', path)
    )
  }
  if (diagnostics.length > 0) return { ok: false, diagnostics }
  return { ok: true, domainId: markers[0] ?? null }
}

/**
 * Повертає domain-relative ignores для nested package boundaries.
 * @param {string} repoRoot repository root
 * @param {Record<string, unknown>} domain owning domain
 * @returns {string[]} globby ignore patterns
 */
function nestedDomainIgnores(repoRoot, domain) {
  if (!Array.isArray(domain.excludedSourceRoots)) return []
  return domain.excludedSourceRoots
    .map(root => (typeof root === 'string' ? toPosix(relative(domain.root, join(repoRoot, root))) : ''))
    .filter(path => path !== '' && path !== '.' && !path.startsWith('../'))
    .flatMap(path => [path, `${path}/**`])
    .toSorted()
}

/**
 * Створює source record з власним evidence reference.
 * @param {{kind: 'manual'|'adr'|'spec'|'test', path: string, content: string, span: {startByte: number, endByte: number}, anchor: string}} input source facts
 * @returns {Record<string, unknown>} strict source record
 */
function expectedSource({ kind, path, content, span, anchor }) {
  const contentHash = hash(content)
  const evidence = {
    id: `evidence:expected:${hash({ kind, path, contentHash, span, anchor }).slice(7, 31)}`,
    kind,
    path,
    span,
    contentHash
  }
  return {
    id: `source:expected:${hash({ evidence: evidence.id, anchor }).slice(7, 31)}`,
    evidence,
    content,
    anchor
  }
}

/**
 * Перевіряє MADR accepted-status без евристики prose.
 * @param {string} markdown ADR content
 * @returns {boolean} whether current ADR is accepted
 */
function isAcceptedAdr(markdown) {
  return ACCEPTED_ADR_STATUS_RE.test(markdown)
}

/**
 * Sorts discovery diagnostics deterministically by path and code.
 * @param {Record<string, unknown>} left first diagnostic
 * @param {Record<string, unknown>} right second diagnostic
 * @returns {number} locale comparison
 */
function expectedSourceDiagnosticOrder(left, right) {
  return `${left.path ?? ''}:${left.code}`.localeCompare(`${right.path ?? ''}:${right.code}`)
}

/**
 * Sorts expected-source identities deterministically.
 * @param {Record<string, unknown>} left first source
 * @param {Record<string, unknown>} right second source
 * @returns {number} locale comparison
 */
function expectedSourceIdOrder(left, right) {
  return left.id.localeCompare(right.id)
}

/**
 * Returns whether a parsed manual zone carries non-empty expectation text.
 * @param {{kind: string, content: string}} zone parsed documentation zone
 * @returns {boolean} whether the zone is an explicit expectation
 */
function isExpectedZone(zone) {
  return zone.kind === 'EXPECTED' && zone.content.trim() !== ''
}

/**
 * Collects explicit EXPECTED zones from package-owned documentation.
 * @param {string} domainRoot absolute domain root
 * @param {string[]} domainDocs package-owned documentation paths
 * @param {Array<Record<string, unknown>>} diagnostics mutable blocking diagnostics
 * @returns {Promise<Array<Record<string, unknown>>>} discovered manual sources
 */
async function collectDomainExpectedSources(domainRoot, domainDocs, diagnostics) {
  const sources = []
  for (const path of domainDocs.toSorted()) {
    const content = await readFile(join(domainRoot, path), 'utf8')
    const parsed = parseKnowledgeZones(content, toPosix(path))
    if (!parsed.ok) {
      diagnostics.push(...parsed.diagnostics)
      continue
    }
    for (const zone of parsed.zones) {
      if (!isExpectedZone(zone)) continue
      sources.push(
        expectedSource({
          kind: 'manual',
          path: toPosix(path),
          content: zone.content,
          span: byteSpan(content, zone.contentStart, zone.contentEnd),
          anchor: `EXPECTED:${zone.id}`
        })
      )
    }
  }
  return sources
}

/**
 * Collects accepted ADR/spec sources explicitly scoped to the current domain.
 * @param {{repoRoot: string, domain: Record<string, unknown>, repositoryDocs: string[], diagnostics: Array<Record<string, unknown>>}} input repository discovery context
 * @returns {Promise<Array<Record<string, unknown>>>} discovered repository sources
 */
async function collectScopedRepositoryExpectedSources({ repoRoot, domain, repositoryDocs, diagnostics }) {
  const sources = []
  for (const path of repositoryDocs.toSorted()) {
    const absolute = join(repoRoot, path)
    const content = await readFile(absolute, 'utf8')
    const scope = sourceScope(content, toPosix(path))
    if (!scope.ok) {
      diagnostics.push(...scope.diagnostics)
      continue
    }
    if (scope.domainId !== domain.id) continue
    const kind = path.startsWith('docs/adr/') ? 'adr' : 'spec'
    if (kind === 'adr' && !isAcceptedAdr(content)) continue
    sources.push(
      expectedSource({
        kind,
        path: toPosix(relative(domain.root, absolute)),
        content,
        span: byteSpan(content, 0, content.length),
        anchor: `${kind}:${toPosix(path)}`
      })
    )
  }
  return sources
}

/**
 * Indexes test-scenario collectors by source extension.
 * @param {Array<Record<string, unknown>>} extractors registered knowledge extractors
 * @returns {Map<string, Record<string, unknown>>} extractor by extension
 */
function expectedExtractorByExtension(extractors) {
  const extractorByExtension = new Map()
  for (const extractor of extractors) {
    for (const extension of extractor?.extensions ?? []) {
      extractorByExtension.set(extension, extractor)
    }
  }
  return extractorByExtension
}

/**
 * Collects active parser-backed assertion scenarios as Expected sources.
 * @param {{testFiles: Array<Record<string, unknown>>, extractors: Array<Record<string, unknown>>, diagnostics: Array<Record<string, unknown>>}} input test discovery context
 * @returns {Promise<Array<Record<string, unknown>>>} discovered test sources
 */
async function collectTestExpectedSources({ testFiles, extractors, diagnostics }) {
  const sources = []
  const extractorByExtension = expectedExtractorByExtension(extractors)
  for (const file of [...testFiles].toSorted((left, right) => left.path.localeCompare(right.path))) {
    const extension = file.path.slice(file.path.lastIndexOf('.')).toLowerCase()
    const extractor = extractorByExtension.get(extension)
    if (!extractor || typeof extractor.collectTestScenarios !== 'function') {
      diagnostics.push(
        diagnostic(
          'expected-test-parser-missing',
          'knowledge.extractor@1 не надає full-parser test collector.',
          file.path
        )
      )
      continue
    }
    const scenarios = await extractor.collectTestScenarios({ file })
    if (!scenarios.ok) {
      diagnostics.push(...scenarios.diagnostics)
      continue
    }
    for (const scenario of scenarios.scenarios) {
      sources.push(expectedSource({ kind: 'test', path: file.path, ...scenario }))
    }
  }
  return sources
}

/**
 * Знаходить authored Markdown і parser-backed executable tests, що є sources explicit expectation.
 * ADR/spec беруться лише за exact domain marker; локальні EXPECTED zones already
 * belong to owning domain. Disabled tests не створюють source без corroboration.
 * @param {{repoRoot: string, domain: Record<string, unknown>, extractors?: Record<string, unknown>[], testFiles?: Array<{path: string, content: string}>}} input repository/domain boundary
 * @returns {Promise<{ok: true, sources: Array<Record<string, unknown>>} | {ok: false, diagnostics: object[]}>} deterministic sources або blockers
 */
export async function discoverExpectedSources({ repoRoot, domain, extractors = [], testFiles = [] }) {
  if (
    typeof repoRoot !== 'string' ||
    !isAbsolute(repoRoot) ||
    !domain ||
    typeof domain.root !== 'string' ||
    !isAbsolute(domain.root) ||
    typeof domain.id !== 'string' ||
    domain.id === ''
  ) {
    return {
      ok: false,
      diagnostics: [diagnostic('invalid-expected-source-domain', 'Потрібні absolute repoRoot/domain.root і domain.id.')]
    }
  }
  const domainIgnores = [...IGNORED_PATHS, ...nestedDomainIgnores(repoRoot, domain)]
  const domainDocs = await globby('docs/**/*.md', {
    cwd: domain.root,
    onlyFiles: true,
    gitignore: true,
    ignore: domainIgnores
  })
  const repositoryDocs = await globby(['docs/adr/**/*.md', 'docs/specs/**/*.md'], {
    cwd: repoRoot,
    onlyFiles: true,
    gitignore: true,
    ignore: IGNORED_PATHS
  })
  const diagnostics = []
  const sources = [
    ...(await collectDomainExpectedSources(domain.root, domainDocs, diagnostics)),
    ...(await collectScopedRepositoryExpectedSources({ repoRoot, domain, repositoryDocs, diagnostics })),
    ...(await collectTestExpectedSources({ testFiles, extractors, diagnostics }))
  ]
  if (diagnostics.length > 0) {
    return {
      ok: false,
      diagnostics: diagnostics.toSorted(expectedSourceDiagnosticOrder)
    }
  }
  return { ok: true, sources: sources.toSorted(expectedSourceIdOrder) }
}

/**
 * Перевіряє stable graph references для strict mapping.
 * @param {unknown} graph candidate graph
 * @returns {{ok: true, domainId: string, nodeIds: Set<string>, evidenceIds: Set<string>} | {ok: false, diagnostics: object[]}} reference index
 */
function graphReferences(graph) {
  if (
    !graph ||
    typeof graph !== 'object' ||
    typeof graph.domain?.id !== 'string' ||
    !Array.isArray(graph.nodes) ||
    !Array.isArray(graph.evidence)
  ) {
    return {
      ok: false,
      diagnostics: [diagnostic('invalid-expected-source-graph', 'Graph мусить мати domain.id, nodes[] та evidence[].')]
    }
  }
  const nodeIds = graph.nodes.map(node => node?.id)
  const evidenceIds = graph.evidence.map(evidence => evidence?.id)
  if (
    nodeIds.some(id => typeof id !== 'string' || id === '') ||
    evidenceIds.some(id => typeof id !== 'string' || id === '')
  ) {
    return {
      ok: false,
      diagnostics: [diagnostic('invalid-expected-source-graph', 'Graph IDs мусять бути непорожніми.')]
    }
  }
  return { ok: true, domainId: graph.domain.id, nodeIds: new Set(nodeIds), evidenceIds: new Set(evidenceIds) }
}

/**
 * Нормалізує discovered sources перед mapping.
 * @param {unknown} sources discovered source array
 * @returns {{ok: true, sources: Array<Record<string, unknown>>} | {ok: false, diagnostics: object[]}} strict source records
 */
function normalizeSources(sources) {
  if (!Array.isArray(sources))
    return { ok: false, diagnostics: [diagnostic('invalid-expected-sources', 'sources має бути масивом.')] }
  const diagnostics = []
  const ids = new Set()
  const evidenceIds = new Set()
  for (const source of sources) {
    const evidence = source?.evidence
    if (
      !source ||
      typeof source !== 'object' ||
      Array.isArray(source) ||
      typeof source.id !== 'string' ||
      source.id === '' ||
      typeof source.content !== 'string' ||
      source.content.trim() === '' ||
      !evidence ||
      typeof evidence !== 'object' ||
      typeof evidence.id !== 'string' ||
      evidence.id === '' ||
      typeof evidence.kind !== 'string' ||
      typeof evidence.path !== 'string' ||
      typeof evidence.contentHash !== 'string' ||
      evidence.contentHash === ''
    ) {
      diagnostics.push(
        diagnostic('invalid-expected-source', 'Source мусить мати id, content і complete evidence.', null)
      )
      continue
    }
    if (ids.has(source.id) || evidenceIds.has(evidence.id)) {
      diagnostics.push(
        diagnostic('duplicate-expected-source', `Повторний source/evidence ID ${source.id}.`, evidence.path)
      )
      continue
    }
    ids.add(source.id)
    evidenceIds.add(evidence.id)
  }
  if (diagnostics.length > 0) return { ok: false, diagnostics }
  return {
    ok: true,
    sources: Array.from(sources, source => canonicalize(source)).toSorted((left, right) =>
      left.id.localeCompare(right.id)
    )
  }
}

/**
 * Перевіряє exact JSON keys.
 * @param {Record<string, unknown>} value candidate object
 * @param {string[]} keys required keys
 * @returns {boolean} whether object has exact keys
 */
function hasExactKeys(value, keys) {
  const actual = Object.keys(value).toSorted()
  const expected = [...keys].toSorted()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

/**
 * Нормалізує unique string IDs.
 * @param {unknown} value candidate IDs
 * @returns {string[] | null} stable IDs or null
 */
function normalizedIds(value) {
  if (
    !Array.isArray(value) ||
    value.some(id => typeof id !== 'string' || id === '') ||
    new Set(value).size !== value.length
  )
    return null
  return [...value].toSorted()
}

/**
 * Будує strict mapping prompt для одного explicit source.
 * @param {{source: Record<string, unknown>, refs: Record<string, unknown>}} input known references
 * @returns {string} strict JSON prompt
 */
function mappingPrompt({ source, refs }) {
  const contract = {
    claims: [
      {
        subjectId: '<known node ID>',
        predicate: '<behavioral taxonomy value>',
        value: '<JSON value>',
        evidenceIds: ['<known evidence ID>'],
        confidence: 1
      }
    ]
  }
  return [
    'Return exactly one JSON object, without Markdown or prose.',
    'Do not create an expectation when the supplied source is not explicit enough.',
    'Do not invent node IDs or evidence IDs. Every claim must include this source evidence ID.',
    `Use only this stable behavioral taxonomy: ${BEHAVIORAL_CLAIM_TAXONOMY.join(', ')}.`,
    `Known node IDs: ${JSON.stringify([...refs.nodeIds].toSorted())}.`,
    `Known evidence IDs: ${JSON.stringify([...refs.evidenceIds].toSorted())}.`,
    `Required source evidence ID: ${source.evidence.id}.`,
    `JSON schema example (keys and types are exact): ${JSON.stringify(contract)}.`,
    `Explicit expected source (${source.evidence.kind}, ${source.evidence.path}, ${source.anchor}):\n${source.content}`
  ].join('\n')
}

/**
 * Перевіряє raw LLM mapping result against current canonical graph references.
 * @param {string} text response body
 * @param {{nodeIds: Set<string>, evidenceIds: Set<string>}} refs known graph/source references
 * @param {Record<string, unknown>} source source being mapped
 * @returns {{ok: true, claims: Array<Record<string, unknown>>} | {ok: false, reason: string}} strict mapped claims
 */
export function parseExpectedSourceResult(text, refs, source) {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'invalid-expected-source-json' }
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    !hasExactKeys(parsed, ['claims']) ||
    !Array.isArray(parsed.claims)
  ) {
    return { ok: false, reason: 'invalid-expected-source-shape' }
  }
  const claims = []
  for (const claim of parsed.claims) {
    if (
      !claim ||
      typeof claim !== 'object' ||
      Array.isArray(claim) ||
      !hasExactKeys(claim, ['subjectId', 'predicate', 'value', 'evidenceIds', 'confidence'])
    ) {
      return { ok: false, reason: 'invalid-expected-claim-shape' }
    }
    const evidenceIds = normalizedIds(claim.evidenceIds)
    if (
      typeof claim.subjectId !== 'string' ||
      !refs.nodeIds.has(claim.subjectId) ||
      typeof claim.predicate !== 'string' ||
      !BEHAVIORAL_CLAIM_TAXONOMY.includes(claim.predicate) ||
      !evidenceIds ||
      evidenceIds.length === 0 ||
      !evidenceIds.includes(source.evidence.id) ||
      evidenceIds.some(id => !refs.evidenceIds.has(id)) ||
      typeof claim.confidence !== 'number' ||
      claim.confidence < 0 ||
      claim.confidence > 1
    ) {
      return { ok: false, reason: 'unknown-expected-mapping-reference' }
    }
    claims.push({
      subjectId: claim.subjectId,
      predicate: claim.predicate,
      value: canonicalize(claim.value),
      evidenceIds,
      confidence: claim.confidence,
      sourceId: source.id
    })
  }
  return {
    ok: true,
    claims: claims.toSorted((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
  }
}

/**
 * Завантажує durable або injected successful-result cache.
 * @param {string | undefined} cachePath optional cache file
 * @param {{version?: number, entries?: Record<string, unknown>} | undefined} suppliedCache injected cache
 * @returns {Promise<{version: number, entries: Record<string, unknown>}>} normalized cache
 */
async function loadCache(cachePath, suppliedCache) {
  if (suppliedCache) {
    if (!suppliedCache.entries || typeof suppliedCache.entries !== 'object' || Array.isArray(suppliedCache.entries))
      suppliedCache.entries = {}
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
    )
      return parsed
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  return { version: CACHE_VERSION, entries: {} }
}

/**
 * Atomically writes only successfully validated mapping responses.
 * @param {string | undefined} cachePath cache target
 * @param {{version: number, entries: Record<string, unknown>}} cache cache data
 * @returns {Promise<void>} completion
 */
async function saveCache(cachePath, cache) {
  if (!cachePath) return
  await mkdir(join(cachePath, '..'), { recursive: true })
  const temporary = `${cachePath}.tmp`
  await writeFile(temporary, `${JSON.stringify(canonicalize(cache))}\n`, 'utf8')
  await rename(temporary, cachePath)
}

/**
 * Збирає source claims у stable overlay, deduplicating corroborated intent.
 * @param {string} domainId canonical domain identity
 * @param {Array<Record<string, unknown>>} sources source records
 * @param {Array<Record<string, unknown>>} mappedClaims accepted LLM claims
 * @returns {{claims: Array<Record<string, unknown>>, evidence: Array<Record<string, unknown>>}} expected overlay
 */
function overlayFromMappings(domainId, sources, mappedClaims) {
  const groups = new Map()
  for (const claim of mappedClaims) {
    const key = JSON.stringify([claim.subjectId, claim.predicate, claim.value])
    const group = groups.get(key) ?? { ...claim, evidenceIds: new Set(), sourceIds: new Set(), confidence: 1 }
    for (const id of claim.evidenceIds) group.evidenceIds.add(id)
    group.sourceIds.add(claim.sourceId)
    group.confidence = Math.min(group.confidence, claim.confidence)
    groups.set(key, group)
  }
  const claims = groups
    .values()
    .map(group => {
      const evidenceIds = [...group.evidenceIds].toSorted()
      return {
        id: `claim:expected:${hash({ domainId, subjectId: group.subjectId, predicate: group.predicate, value: group.value, evidenceIds }).slice(7, 31)}`,
        subjectId: group.subjectId,
        predicate: group.predicate,
        value: group.value,
        evidenceIds,
        confidence: group.confidence,
        sourceFingerprint: hash({
          sourceIds: [...group.sourceIds].toSorted(),
          subjectId: group.subjectId,
          predicate: group.predicate,
          value: group.value
        })
      }
    })
    .toArray()
    .toSorted(expectedSourceIdOrder)
  const usedEvidence = new Set(claims.flatMap(claim => claim.evidenceIds))
  const evidence = sources
    .map(source => source.evidence)
    .filter(item => usedEvidence.has(item.id))
    .toSorted((left, right) => left.id.localeCompare(right.id))
  return { claims, evidence }
}

/**
 * Reuses only strict valid cached Expected mappings.
 * @param {Array<Record<string, unknown>>} work source mapping work
 * @param {{entries: Record<string, unknown>}} cache persistent mapping cache
 * @param {Record<string, unknown>} mappingRefs allowed graph references
 * @returns {{mapped: Array<Record<string, unknown>>, pending: Array<Record<string, unknown>>}} cached mappings and misses
 */
function collectCachedExpectedMappings(work, cache, mappingRefs) {
  const mapped = []
  const pending = []
  for (const item of work) {
    const cached = cache.entries[item.cacheKey]
    const checked =
      typeof cached === 'string' ? parseExpectedSourceResult(cached, mappingRefs, item.source) : { ok: false }
    if (checked.ok) mapped.push(...checked.claims)
    else pending.push(item)
  }
  return { mapped, pending }
}

/**
 * Submits one retry tier and turns transport errors into empty responses.
 * @param {string} tier universal model tier
 * @param {Array<Record<string, unknown>>} pending source work
 * @param {(model: string, items: Array<object>) => Promise<Array<object>>} submitBatchImpl batch transport
 * @returns {Promise<Array<Record<string, unknown>>>} transport responses or empty array
 */
async function submitExpectedMappingBatch(tier, pending, submitBatchImpl) {
  try {
    return await submitBatchImpl(
      tier,
      pending.map(item => ({ customId: item.source.id, prompt: item.prompt }))
    )
  } catch {
    return []
  }
}

/**
 * Indexes batch responses by source ID, ignoring malformed transport entries.
 * @param {unknown} responses batch transport output
 * @returns {Map<string, Record<string, unknown>>} response by source ID
 */
function expectedResponsesById(responses) {
  const responseById = new Map()
  if (!Array.isArray(responses)) return responseById
  for (const item of responses) {
    if (typeof item?.customId === 'string') responseById.set(item.customId, item)
  }
  return responseById
}

/**
 * Applies one tier's strict results and returns only retryable source work.
 * @param {{pending: Array<Record<string, unknown>>, responseById: Map<string, Record<string, unknown>>, mappingRefs: Record<string, unknown>, cache: {entries: Record<string, unknown>}, mapped: Array<Record<string, unknown>>, failures: Map<string, string>}} input retry state
 * @returns {Array<Record<string, unknown>>} retryable work
 */
function applyExpectedMappingResponses({ pending, responseById, mappingRefs, cache, mapped, failures }) {
  const retry = []
  for (const item of pending) {
    const response = responseById.get(item.source.id)
    if (typeof response?.ok !== 'string') {
      failures.set(item.source.id, response?.error ? 'expected-source-batch-error' : 'expected-source-missing-result')
      retry.push(item)
      continue
    }
    const checked = parseExpectedSourceResult(response.ok, mappingRefs, item.source)
    if (!checked.ok) {
      failures.set(item.source.id, checked.reason)
      retry.push(item)
      continue
    }
    cache.entries[item.cacheKey] = response.ok
    mapped.push(...checked.claims)
    failures.delete(item.source.id)
  }
  return retry
}

/**
 * Resolves Expected source misses through the universal model ladder.
 * @param {{pending: Array<Record<string, unknown>>, modelPolicy: string[], submitBatchImpl: (model: string, items: Array<object>) => Promise<Array<object>>, mappingRefs: Record<string, unknown>, cache: {entries: Record<string, unknown>}, mapped: Array<Record<string, unknown>>}} input ladder state
 * @returns {Promise<{pending: Array<Record<string, unknown>>, failures: Map<string, string>}>} unresolved work and failure codes
 */
async function runExpectedMappingLadder({ pending, modelPolicy, submitBatchImpl, mappingRefs, cache, mapped }) {
  const failures = new Map()
  let pendingItems = pending
  for (const tier of modelPolicy) {
    if (pendingItems.length === 0) break
    const responses = await submitExpectedMappingBatch(tier, pendingItems, submitBatchImpl)
    pendingItems = applyExpectedMappingResponses({
      pending: pendingItems,
      responseById: expectedResponsesById(responses),
      mappingRefs,
      cache,
      mapped,
      failures
    })
  }
  return { pending: pendingItems, failures }
}

/**
 * Мапить discovered explicit sources до existing canonical graph IDs via strict
 * per-source model ladder. Empty input bypasses transport completely.
 * @param {{graph: Record<string, unknown>, sources: unknown[], cache?: {version?: number, entries?: Record<string, unknown>}, cachePath?: string, modelPolicy?: string[], submitBatchImpl?: (model: string, items: Array<object>) => Promise<Array<object>>}} input mapping request
 * @returns {Promise<{ok: true, overlay: {claims: object[], evidence: object[]}, cache: object} | {ok: false, diagnostics: object[], cache: object}>} overlay or blockers
 */
export async function mapExpectedSources({
  graph,
  sources,
  cache: suppliedCache,
  cachePath,
  modelPolicy = DEFAULT_MODEL_POLICY,
  submitBatchImpl
}) {
  const cache = await loadCache(cachePath, suppliedCache)
  const refs = graphReferences(graph)
  if (!refs.ok) return { ok: false, diagnostics: refs.diagnostics, cache: canonicalize(cache) }
  const normalized = normalizeSources(sources)
  if (!normalized.ok) return { ok: false, diagnostics: normalized.diagnostics, cache: canonicalize(cache) }
  if (normalized.sources.length === 0)
    return { ok: true, overlay: { claims: [], evidence: [] }, cache: canonicalize(cache) }
  if (!Array.isArray(modelPolicy) || JSON.stringify(modelPolicy) !== JSON.stringify(DEFAULT_MODEL_POLICY)) {
    return {
      ok: false,
      diagnostics: [
        diagnostic('invalid-expected-model-policy', 'Expected mapping використовує universal policy min -> avg -> max.')
      ],
      cache: canonicalize(cache)
    }
  }
  if (typeof submitBatchImpl !== 'function') {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          'expected-mapping-transport-missing',
          'Потрібен submitBatch transport для uncached Expected sources.'
        )
      ],
      cache: canonicalize(cache)
    }
  }
  const sourceEvidenceIds = new Set(normalized.sources.map(source => source.evidence.id))
  const mappingRefs = { ...refs, evidenceIds: refs.evidenceIds.union(sourceEvidenceIds) }
  const work = normalized.sources.map(source => {
    const cacheKey = hash({
      schema: 'package-knowledge-expected-v1',
      policy: modelPolicy,
      domainId: refs.domainId,
      nodeIds: [...refs.nodeIds].toSorted(),
      evidenceIds: [...mappingRefs.evidenceIds].toSorted(),
      source
    })
    return { source, cacheKey, prompt: mappingPrompt({ source, refs: mappingRefs }) }
  })
  const cached = collectCachedExpectedMappings(work, cache, mappingRefs)
  const mapped = cached.mapped
  const ladder = await runExpectedMappingLadder({
    pending: cached.pending,
    modelPolicy,
    submitBatchImpl,
    mappingRefs,
    cache,
    mapped
  })
  await saveCache(cachePath, cache)
  if (ladder.pending.length > 0) {
    return {
      ok: false,
      diagnostics: ladder.pending
        .map(item =>
          diagnostic(
            ladder.failures.get(item.source.id) ?? 'unresolved-expected-source',
            'Expected source не пройшов universal model ladder.',
            item.source.evidence.path
          )
        )
        .toSorted(expectedSourceDiagnosticOrder),
      cache: canonicalize(cache)
    }
  }
  return {
    ok: true,
    overlay: overlayFromMappings(refs.domainId, normalized.sources, mapped),
    cache: canonicalize(cache)
  }
}

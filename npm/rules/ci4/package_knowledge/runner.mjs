/**
 * Оркеструє повну генерацію package knowledge у shadow або publish режимі.
 *
 * Runner не має власної semantic schema: він послідовно з'єднує наявні
 * resolver, adapters, parser candidate, planner, claims, renderer, validator
 * та atomic publisher. Усі залежності інʼєктовані, щоб tests перевіряли
 * fail-closed межі без реальних plugin або LLM викликів.
 * Після Expected overlay runner верифікує evidence entailment, автоматично
 * порівнює expected↔implemented claims і лише тоді materializes gaps/render.
 */

import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { tmpdir } from 'node:os'

import { buildKnowledgeCandidate } from './candidate.mjs'
import { planSemanticChunks } from './chunk-planner.mjs'
import { buildStructuredClaims, CLAIM_PROMPT_VERSION, CLAIM_SCHEMA_VERSION, DEFAULT_MODEL_POLICY } from './claims.mjs'
import { resolveDocumentationDomains } from './domain-resolver.mjs'
import { verifyEvidenceEntailment } from './entailment.mjs'
import { applyExpectedOverlay } from './expected-overlay.mjs'
import { discoverExpectedSources, mapExpectedSources } from './expected-sources.mjs'
import { evaluateGaps } from './gap-engine.mjs'
import { compareClaimMappings } from './gap-mappings.mjs'
import { loadKnowledgeAdapters } from './load-adapters.mjs'
import { publishKnowledgeArtifacts } from './publish.mjs'
import { renderKnowledgeArtifacts } from './render.mjs'
import { discoverDomainCodeExtensions, loadDomainSources } from './source-loader.mjs'
import { loadStructuredSources } from './structured-sources.mjs'
import { validateKnowledgeGraph } from './validator.mjs'
import { parseKnowledgeZones } from './zones.mjs'
import { readNRulesConfigLite } from '../../../scripts/lib/read-n-rules-config-lite.mjs'

/**
 * Створює стабільний fingerprint JSON-подібних input без volatile metadata.
 * @param {unknown} value input для хешування
 * @returns {string} SHA-256 fingerprint
 */
function fingerprint(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`
}

/**
 * Перетворює diagnostics різних pipeline stages на єдиний fail-closed result.
 * @param {string} stage назва завершеного stage
 * @param {unknown[]} diagnostics underlying diagnostics
 * @param {string} [domainId] domain identity
 * @returns {{ok: false, stage: string, domainId: string, diagnostics: unknown[]}} blocking result
 */
function blocked(stage, diagnostics, domainId = '') {
  return { ok: false, stage, domainId, diagnostics: Array.isArray(diagnostics) ? diagnostics : [] }
}

/**
 * Повертає exact UTF-8 byte slice або null для невалідного half-open span.
 * @param {string} content повний source text
 * @param {unknown} span очікуваний byte span
 * @returns {string | null} source slice
 */
function utf8ByteSlice(content, span) {
  if (!span || !Number.isInteger(span.startByte) || !Number.isInteger(span.endByte) || span.startByte < 0 || span.endByte < span.startByte) return null
  const bytes = Buffer.from(content, 'utf8')
  if (span.endByte > bytes.length) return null
  const slice = bytes.subarray(span.startByte, span.endByte)
  const decoded = slice.toString('utf8')
  return Buffer.from(decoded, 'utf8').equals(slice) ? decoded : null
}

/**
 * Індексує graph evidence з parsed code/test sources без whole-file fallback
 * за наявного span: відсутній або невалідний slice лишається unresolved.
 * @param {{graph: Record<string, unknown>, sources: Array<{path: string, content: string}>}} input graph і parsed sources
 * @returns {Record<string, string>} evidence ID до exact local content
 */
function sourceEvidenceContentById({ graph, sources }) {
  const sourceByPath = new Map(sources.map(source => [source.path, source.content]))
  const indexed = {}
  for (const evidence of graph.evidence ?? []) {
    if (typeof evidence?.id !== 'string' || typeof evidence.path !== 'string') continue
    const content = sourceByPath.get(evidence.path)
    if (typeof content !== 'string') continue
    const value = evidence.span == null ? content : utf8ByteSlice(content, evidence.span)
    if (value !== null) indexed[evidence.id] = value
  }
  return indexed
}

/**
 * Будує private evidence index для entailment без додавання raw content у graph/result.
 * @param {{graph: Record<string, unknown>, sources: Array<{path: string, content: string}>, structuredEvidenceContentById?: Record<string, string>, expectedSources: Array<Record<string, unknown>>}} input local evidence inputs
 * @returns {Record<string, string>} evidence ID до exact local content
 */
function entailmentEvidenceContentById({ graph, sources, structuredEvidenceContentById, expectedSources }) {
  const expected = Object.fromEntries(
    expectedSources
      .filter(source => typeof source?.evidence?.id === 'string' && typeof source.content === 'string')
      .map(source => [source.evidence.id, source.content])
  )
  const structured = Object.fromEntries(
    Object.entries(structuredEvidenceContentById ?? {}).filter(([id, content]) => typeof id === 'string' && typeof content === 'string')
  )
  return { ...sourceEvidenceContentById({ graph, sources }), ...structured, ...expected }
}

/**
 * Повертає deterministic parser provenance для cache keys та chunk fingerprints.
 * @param {Array<Record<string, unknown>>} extractors materialized extractors
 * @returns {string} stable parser version
 */
function parserVersion(extractors) {
  return extractors
    .map(adapter => `${adapter.parser.id}@${adapter.parser.grammarVersion}/${adapter.parser.runtimeVersion}`)
    .toSorted()
    .join(',')
}

/**
 * Адаптує planner slices до strict claims map contract, не втрачаючи required coverage.
 * @param {Array<Record<string, unknown>>} chunks planner chunks
 * @param {Record<string, unknown>} graph graph that owns evidence references
 * @returns {Array<Record<string, unknown>>} claims map chunks
 */
function claimsChunks(chunks, graph) {
  return chunks.map(chunk => {
    const edgeContainsEvidence = (edge, evidenceId) => edge.evidence.some(item => item.id === evidenceId)
    const evidenceRefs = (graph.evidence ?? []).filter(
      evidence => chunk.nodeIds.includes(evidence.symbolId) || chunk.edgeEvidence.some(edge => edgeContainsEvidence(edge, evidence.id))
    )
    return {
      id: chunk.id,
      requiredNodeIds: chunk.nodeIds,
      requiredEdgeIds: chunk.edgeIds,
      allowedEvidenceIds: evidenceRefs.map(evidence => evidence.id).toSorted(),
      dependsOnChunkIds: chunk.dependsOnChunkIds,
      wave: chunk.wave,
      contentHash: chunk.cacheFingerprint,
      prompt: JSON.stringify({
        unitSlices: chunk.unitSlices,
        edgeEvidence: chunk.edgeEvidence,
        evidenceRefs,
        dependsOnChunkIds: chunk.dependsOnChunkIds
      })
    }
  })
}

/**
 * Обʼєднує automatic та explicit gap mappings без неявного пріоритету caller-а.
 * @param {unknown} automatic comparator-produced mappings
 * @param {unknown} explicit caller-provided mappings
 * @returns {{ok: true, mappings: unknown[]} | {ok: false, diagnostics: object[]}} merged mappings або blockers
 */
function mergeGapMappings(automatic, explicit) {
  if (!Array.isArray(automatic) || !Array.isArray(explicit)) {
    return { ok: false, diagnostics: [{ code: 'invalid-gap-mappings', message: 'Automatic та explicit gap mappings мають бути масивами.' }] }
  }
  const byIdentity = new Map()
  const diagnostics = []
  for (const mapping of automatic.concat(explicit)) {
    if (!mapping || typeof mapping !== 'object' || typeof mapping.expectedClaimId !== 'string' || typeof mapping.implementedClaimId !== 'string') {
      diagnostics.push({ code: 'invalid-gap-mapping', message: 'Gap mapping не має exact expected/implemented IDs.' })
      continue
    }
    const identity = `${mapping.expectedClaimId}\u{0}${mapping.implementedClaimId}`
    const prior = byIdentity.get(identity)
    if (!prior) {
      byIdentity.set(identity, mapping)
      continue
    }
    const priorEvidence = Array.isArray(prior.evidenceIds) ? JSON.stringify([...prior.evidenceIds].toSorted()) : null
    const nextEvidence = Array.isArray(mapping.evidenceIds) ? JSON.stringify([...mapping.evidenceIds].toSorted()) : null
    const same = prior.relation === mapping.relation && priorEvidence !== null && priorEvidence === nextEvidence
    diagnostics.push({
      code: same ? 'duplicate-gap-mapping' : 'conflicting-gap-mapping',
      message: `Gap mapping ${mapping.expectedClaimId} → ${mapping.implementedClaimId} задано більше одного разу.`
    })
  }
  if (diagnostics.length > 0) return { ok: false, diagnostics: diagnostics.toSorted((left, right) => `${left.code}:${left.message}`.localeCompare(`${right.code}:${right.message}`)) }
  return {
    ok: true,
    mappings: byIdentity.values().toArray().toSorted((left, right) =>
      `${left.expectedClaimId}:${left.implementedClaimId}:${left.relation}`.localeCompare(
        `${right.expectedClaimId}:${right.implementedClaimId}:${right.relation}`
      )
    )
  }
}

/**
 * Читає поточні Markdown views лише для preservation protected zones. Manifest
 * навмисно не читається: generated candidate завжди є повною projection graph.
 * @param {string} domainRoot absolute domain root
 * @param {{ readdirImpl?: typeof readdir }} [deps] injectable filesystem access
 * @returns {Promise<Record<string, string>>} docs-relative Markdown contents
 */
async function readExistingMarkdown(domainRoot, deps = {}) {
  const files = {}
  const readDirectory = async directory => {
    let entries
    try {
      entries = await (deps.readdirImpl ?? readdir)(directory, { withFileTypes: true })
    } catch (error) {
      if (error?.code === 'ENOENT') return
      throw error
    }
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await readDirectory(path)
      if (entry.isFile() && entry.name.endsWith('.md')) {
        const key = relative(domainRoot, path).split('\\').join('/')
        files[key] = await readFile(path, 'utf8')
      }
    }
  }
  await readDirectory(join(domainRoot, 'docs'))
  return files
}

/**
 * Читає попередній committed manifest до candidate build. Malformed manifest
 * блокує rename/protected-zone migration, замість silent first-run fallback.
 * @param {string} domainRoot absolute domain root
 * @returns {Promise<{ok: true, manifest: Record<string, unknown> | undefined} | {ok: false, diagnostics: object[]}>} manifest або blocker
 */
async function readPreviousManifest(domainRoot) {
  const path = join(domainRoot, 'docs', '.docgen', 'manifest.json')
  try {
    const manifest = JSON.parse(await readFile(path, 'utf8'))
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
      return blocked('previous-manifest', [{ code: 'manifest-invalid', path }])
    }
    return { ok: true, manifest }
  } catch (error) {
    if (error?.code === 'ENOENT') return { ok: true, manifest: undefined }
    return blocked('previous-manifest', [{ code: 'manifest-read-failed', path, detail: String(error) }])
  }
}

/**
 * Відновлює topic-owned protected zones із поточних generated pages. Token
 * повторює renderer identity, тож registry не залежить від human title/path.
 * @param {Record<string, string>} files existing Markdown files
 * @param {Record<string, unknown> | undefined} manifest prior graph manifest
 * @returns {{ok: true, registry: Record<string, unknown[]>} | {ok: false, diagnostics: object[]}} topic registry
 */
function protectedZonesFromPages(files, manifest) {
  const directories = {
    capability: 'docs/explanation/capabilities',
    contract: 'docs/reference/contracts',
    process: 'docs/explanation/processes'
  }
  const registry = {}
  const diagnostics = []
  for (const topic of manifest?.topics ?? []) {
    if (!topic || typeof topic.id !== 'string' || !directories[topic.kind]) continue
    const token = createHash('sha256').update(topic.id).digest('hex').slice(0, 24)
    const path = `${directories[topic.kind]}/${token}.md`
    const content = files[path]
    if (content === undefined) continue
    const parsed = parseKnowledgeZones(content, path)
    if (!parsed.ok) {
      diagnostics.push(...parsed.diagnostics)
      continue
    }
    const zones = parsed.zones
      .filter(zone => zone.kind === 'MANUAL' || zone.kind === 'EXPECTED')
      .map(zone => ({ id: zone.id, kind: zone.kind, content: zone.content }))
    if (zones.length > 0) registry[topic.id] = zones
  }
  return diagnostics.length > 0 ? { ok: false, diagnostics } : { ok: true, registry }
}

/**
 * Writes a validated shadow candidate outside the repository. This makes build
 * inspectable while guaranteeing that legacy or committed docs remain untouched.
 * @param {string} stagingPath cache/staging root
 * @param {Record<string, string>} files candidate artifacts
 * @param {{ mkdirImpl?: typeof mkdir, writeFileImpl?: typeof writeFile }} [deps] injectable filesystem access
 * @returns {Promise<void>} completion
 */
async function writeShadowCandidate(stagingPath, files, deps = {}) {
  for (const [path, content] of Object.entries(files)) {
    const target = join(stagingPath, path)
    await (deps.mkdirImpl ?? mkdir)(join(target, '..'), { recursive: true })
    await (deps.writeFileImpl ?? writeFile)(target, content, 'utf8')
  }
}

/**
 * Builds one package knowledge domain. The default is SHADOW: candidate docs
 * are validated and materialized under the system cache, never under domain docs.
 * `publish: true` is the only path that invokes the existing atomic publisher.
 * @param {{
 *   repoRoot: string, domainId: string, publish?: boolean, expectedOverlay?: object,
 *   gapMappings?: unknown[], aliasesByTopicId?: Record<string, string[]>, cache?: object, expectedCache?: object, entailmentCache?: object, gapCache?: object,
 *   cachePath?: string, expectedCachePath?: string, entailmentCachePath?: string, gapCachePath?: string, config?: object, submitBatchImpl?: (model: string, items: Array<object>, options?: object) => Promise<Array<object>>,
 *   resolveDomainsImpl?: typeof resolveDocumentationDomains, discoverDomainCodeExtensionsImpl?: typeof discoverDomainCodeExtensions,
 *   loadAdaptersImpl?: typeof loadKnowledgeAdapters,
 *   loadSourcesImpl?: typeof loadDomainSources, buildCandidateImpl?: typeof buildKnowledgeCandidate,
 *   loadStructuredSourcesImpl?: typeof loadStructuredSources,
 *   planChunksImpl?: typeof planSemanticChunks, buildClaimsImpl?: typeof buildStructuredClaims,
 *   renderImpl?: typeof renderKnowledgeArtifacts, validateImpl?: typeof validateKnowledgeGraph,
 *   publishImpl?: typeof publishKnowledgeArtifacts, readExistingMarkdownImpl?: typeof readExistingMarkdown,
 *   readPreviousManifestImpl?: typeof readPreviousManifest, discoverExpectedSourcesImpl?: typeof discoverExpectedSources,
 *   mapExpectedSourcesImpl?: typeof mapExpectedSources,
 *   verifyEntailmentImpl?: typeof verifyEvidenceEntailment,
 *   compareGapMappingsImpl?: typeof compareClaimMappings,
 *   writeShadowCandidateImpl?: typeof writeShadowCandidate
 * }} input explicit runtime request and injectable dependencies
 * @returns {Promise<Record<string, unknown>>} build outcome with mode and diagnostics
 */
export async function buildPackageKnowledge(input) {
  const repoRoot = input?.repoRoot
  const domainId = input?.domainId
  if (typeof repoRoot !== 'string' || repoRoot === '' || typeof domainId !== 'string' || domainId === '') {
    return blocked('input', [{ code: 'domain-required', message: 'Потрібні repoRoot і --domain <id>.' }])
  }
  const resolveDomains = input.resolveDomainsImpl ?? resolveDocumentationDomains
  const resolved = await resolveDomains(repoRoot)
  if (resolved.diagnostics?.length > 0) return blocked('domain-resolution', resolved.diagnostics, domainId)
  const domain = resolved.domains?.find(candidate => candidate.id === domainId)
  if (!domain) return blocked('domain-resolution', [{ code: 'domain-not-found', domainId }], domainId)

  const readExisting = input.readExistingMarkdownImpl ?? readExistingMarkdown
  let existingFiles
  try {
    existingFiles = await readExisting(domain.root)
  } catch (error) {
    return blocked('existing-docs', [{ code: 'existing-docs-read-failed', detail: String(error) }], domain.id)
  }
  const previous = await (input.readPreviousManifestImpl ?? readPreviousManifest)(domain.root)
  if (!previous.ok) return { ...previous, domainId: domain.id }
  const protectedZones = protectedZonesFromPages(existingFiles, previous.manifest)
  if (!protectedZones.ok) return blocked('protected-zones', protectedZones.diagnostics, domain.id)

  const config = input.config ?? (await readNRulesConfigLite(repoRoot))
  const discoverExtensions = input.discoverDomainCodeExtensionsImpl ?? discoverDomainCodeExtensions
  const inventory = await discoverExtensions({ domain })
  if (!inventory.ok) return blocked('source-inventory', inventory.diagnostics, domain.id)
  const loadAdapters = input.loadAdaptersImpl ?? loadKnowledgeAdapters
  const adapters = await loadAdapters({ repoRoot, domainRoot: domain.root, config, requiredExtensions: inventory.extensions })
  if (adapters.blocked || !adapters.adapters) return blocked('adapters', adapters.diagnostics, domain.id)
  const extractors = adapters.adapters.extractor
  if (!Array.isArray(extractors) || (inventory.extensions.length > 0 && extractors.length === 0))
    return blocked('adapters', [{ code: 'missing-extractors', message: 'Немає knowledge.extractor@1 adapters.' }], domain.id)

  const loadSources = input.loadSourcesImpl ?? loadDomainSources
  const loaded =
    inventory.extensions.length === 0
      ? { ok: true, sources: [] }
      : await loadSources({ domain, extensions: inventory.extensions })
  if (!loaded.ok) return blocked('sources', loaded.diagnostics, domain.id)
  const loadStructured = input.loadStructuredSourcesImpl ?? loadStructuredSources
  const structured = await loadStructured({ domain })
  if (!structured.ok) return blocked('structured-sources', structured.diagnostics, domain.id)
  const sourceFingerprint = fingerprint(
    loaded.sources.map(source => ({ path: source.path, content: source.content })).toSorted((left, right) => left.path.localeCompare(right.path))
  )
  const candidateDomain = { ...domain, sourceFingerprint }
  const buildCandidate = input.buildCandidateImpl ?? buildKnowledgeCandidate
  const candidate = await buildCandidate({
    domain: candidateDomain,
    sources: loaded.sources,
    extractors,
    structuredFragments: structured.fragments,
    expectedOverlay: {},
    gapMappings: [],
    aliasesByTopicId: input.aliasesByTopicId ?? {},
    previousManifest: previous.manifest,
    protectedZonesByTopicId: protectedZones.registry
  })
  if (!candidate.ok) return blocked('candidate', candidate.diagnostics, domain.id)

  const cachePath = input.cachePath ?? join(tmpdir(), 'n-rules-package-knowledge', fingerprint(domain.id).slice(7), 'claims.json')
  let graphWithClaims = candidate.graph
  if (inventory.extensions.length > 0) {
    const parser = parserVersion(extractors)
    const planChunks = input.planChunksImpl ?? planSemanticChunks
    const plan = planChunks({
      graph: candidate.graph,
      sources: loaded.sources,
      parser: { version: parser },
      schema: { version: CLAIM_SCHEMA_VERSION },
      prompt: { version: CLAIM_PROMPT_VERSION },
      modelPolicy: { tiers: DEFAULT_MODEL_POLICY }
    })
    if (!plan.ok) return blocked('chunk-plan', plan.diagnostics, domain.id)
    const buildClaims = input.buildClaimsImpl ?? buildStructuredClaims
    const claims = await buildClaims({
      graph: candidate.graph,
      chunks: claimsChunks(plan.plan.chunks, candidate.graph),
      parserVersion: parser,
      modelPolicy: DEFAULT_MODEL_POLICY,
      cache: input.cache,
      cachePath,
      submitBatchImpl: input.submitBatchImpl
    })
    if (!claims.ok) return blocked('claims', claims.blockers, domain.id)
    graphWithClaims = {
      ...candidate.graph,
      claims: [...candidate.graph.claims, ...claims.claims].toSorted((left, right) => left.id.localeCompare(right.id))
    }
  }
  const discoverExpected = input.discoverExpectedSourcesImpl ?? discoverExpectedSources
  const discoveredExpected = await discoverExpected({ repoRoot, domain, extractors, testFiles: loaded.sources })
  if (!discoveredExpected.ok) return blocked('expected-sources', discoveredExpected.diagnostics, domain.id)
  const expectedCachePath = input.expectedCachePath ?? join(dirname(cachePath), 'expected.json')
  const mapExpected = input.mapExpectedSourcesImpl ?? mapExpectedSources
  const mappedExpected = await mapExpected({
    graph: graphWithClaims,
    sources: discoveredExpected.sources,
    cache: input.expectedCache,
    cachePath: expectedCachePath,
    submitBatchImpl: input.submitBatchImpl
  })
  if (!mappedExpected.ok) return blocked('expected-mapping', mappedExpected.diagnostics, domain.id)
  const expectedOverlay = {
    claims: [...mappedExpected.overlay.claims, ...(input.expectedOverlay?.claims ?? [])],
    evidence: [...mappedExpected.overlay.evidence, ...(input.expectedOverlay?.evidence ?? [])]
  }
  const overlaid = applyExpectedOverlay(graphWithClaims, expectedOverlay)
  if (!overlaid.ok) return blocked('expected-overlay', overlaid.diagnostics, domain.id)
  const verifyEntailment = input.verifyEntailmentImpl ?? verifyEvidenceEntailment
  const entailment = await verifyEntailment({
    graph: overlaid.graph,
    evidenceContentById: entailmentEvidenceContentById({
      graph: overlaid.graph,
      sources: loaded.sources,
      structuredEvidenceContentById: structured.evidenceContentById,
      expectedSources: discoveredExpected.sources
    }),
    cache: input.entailmentCache,
    cachePath: input.entailmentCachePath ?? join(dirname(cachePath), 'entailment.json'),
    submitBatchImpl: input.submitBatchImpl
  })
  if (!entailment.ok) return blocked('entailment', entailment.diagnostics, domain.id)
  const compareGapMappings = input.compareGapMappingsImpl ?? compareClaimMappings
  const comparison = await compareGapMappings({
    graph: overlaid.graph,
    cache: input.gapCache,
    cachePath: input.gapCachePath ?? join(dirname(cachePath), 'gap-mappings.json'),
    submitBatchImpl: input.submitBatchImpl
  })
  if (!comparison.ok) return blocked('gap-mappings', comparison.diagnostics, domain.id)
  const mergedMappings = mergeGapMappings(comparison.mappings, input.gapMappings ?? [])
  if (!mergedMappings.ok) return blocked('gap-mappings', mergedMappings.diagnostics, domain.id)
  const gaps = evaluateGaps({
    graph: overlaid.graph,
    mappings: mergedMappings.mappings,
    unresolvedExpectedClaimIds: comparison.unresolvedExpectedClaimIds
  })
  if (!gaps.ok) return blocked('gaps', gaps.diagnostics, domain.id)
  const graph = {
    ...overlaid.graph,
    topics: candidate.graph.topics,
    gaps: gaps.gaps,
    protectedZonesByTopicId: candidate.protectedZonesByTopicId
  }
  const render = input.renderImpl ?? renderKnowledgeArtifacts
  const rendered = render({ graph, existingFiles })
  if (!rendered.ok) return blocked('render', rendered.diagnostics, domain.id)
  const humanProjection = Object.entries(rendered.files)
    .filter(([path]) => path.endsWith('.md'))
    .map(([, content]) => content)
    .join('\n')
  const validate = input.validateImpl ?? validateKnowledgeGraph
  const validation = await validate({ graph, fragments: candidate.fragments, expectedDomainId: domain.id, humanProjection })
  if (!validation.ok) return blocked('validate', validation.diagnostics, domain.id)

  const stagingPath = join(tmpdir(), 'n-rules-package-knowledge', fingerprint(domain.id).slice(7), sourceFingerprint.slice(7))
  try {
    await (input.writeShadowCandidateImpl ?? writeShadowCandidate)(stagingPath, rendered.files)
  } catch (error) {
    return blocked('shadow', [{ code: 'shadow-write-failed', detail: String(error) }], domain.id)
  }
  if (!input.publish) {
    return { ok: true, mode: 'shadow', domainId: domain.id, cachePath, stagingPath, files: Object.keys(rendered.files).toSorted() }
  }
  const publish = input.publishImpl ?? publishKnowledgeArtifacts
  const publication = await publish({
    domainRoot: domain.root,
    files: rendered.files,
    validate: async () => validate({ graph, fragments: candidate.fragments, expectedDomainId: domain.id, humanProjection })
  })
  if (!publication.ok) return blocked('publish', publication.diagnostics, domain.id)
  return { ok: true, mode: 'published', domainId: domain.id, cachePath, stagingPath, files: Object.keys(rendered.files).toSorted() }
}

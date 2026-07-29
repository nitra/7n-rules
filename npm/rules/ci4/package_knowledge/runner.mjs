/**
 * Оркеструє повну генерацію package knowledge у shadow або publish режимі.
 *
 * Runner не має власної semantic schema: він послідовно з'єднує наявні
 * resolver, adapters, parser candidate, planner, claims, renderer, validator
 * та atomic publisher. Усі залежності інʼєктовані, щоб tests перевіряли
 * fail-closed межі без реальних plugin або LLM викликів.
 */

import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { tmpdir } from 'node:os'

import { buildKnowledgeCandidate } from './candidate.mjs'
import { planSemanticChunks } from './chunk-planner.mjs'
import { buildStructuredClaims, CLAIM_PROMPT_VERSION, CLAIM_SCHEMA_VERSION, DEFAULT_MODEL_POLICY } from './claims.mjs'
import { resolveDocumentationDomains } from './domain-resolver.mjs'
import { evaluateGaps } from './gap-engine.mjs'
import { loadKnowledgeAdapters } from './load-adapters.mjs'
import { publishKnowledgeArtifacts } from './publish.mjs'
import { renderKnowledgeArtifacts } from './render.mjs'
import { loadDomainSources } from './source-loader.mjs'
import { discoverTopics } from './topic-discovery.mjs'
import { validateKnowledgeGraph } from './validator.mjs'
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
 *   gapMappings?: unknown[], aliasesByTopicId?: Record<string, string[]>, cache?: object,
 *   cachePath?: string, config?: object, submitBatchImpl?: Function,
 *   resolveDomainsImpl?: typeof resolveDocumentationDomains, loadAdaptersImpl?: typeof loadKnowledgeAdapters,
 *   loadSourcesImpl?: typeof loadDomainSources, buildCandidateImpl?: typeof buildKnowledgeCandidate,
 *   planChunksImpl?: typeof planSemanticChunks, buildClaimsImpl?: typeof buildStructuredClaims,
 *   renderImpl?: typeof renderKnowledgeArtifacts, validateImpl?: typeof validateKnowledgeGraph,
 *   publishImpl?: typeof publishKnowledgeArtifacts, readExistingMarkdownImpl?: typeof readExistingMarkdown,
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

  const config = input.config ?? (await readNRulesConfigLite(repoRoot))
  const loadAdapters = input.loadAdaptersImpl ?? loadKnowledgeAdapters
  const adapters = await loadAdapters({ repoRoot, domainRoot: domain.root, config })
  if (adapters.blocked || !adapters.adapters) return blocked('adapters', adapters.diagnostics, domain.id)
  const extractors = adapters.adapters.extractor
  if (!Array.isArray(extractors) || extractors.length === 0)
    return blocked('adapters', [{ code: 'missing-extractors', message: 'Немає knowledge.extractor@1 adapters.' }], domain.id)

  const extensions = [...new Set(extractors.flatMap(adapter => adapter.extensions))].toSorted()
  const loadSources = input.loadSourcesImpl ?? loadDomainSources
  const loaded = await loadSources({ domain, extensions })
  if (!loaded.ok) return blocked('sources', loaded.diagnostics, domain.id)
  const sourceFingerprint = fingerprint(
    loaded.sources.map(source => ({ path: source.path, content: source.content })).toSorted((left, right) => left.path.localeCompare(right.path))
  )
  const candidateDomain = { ...domain, sourceFingerprint }
  const buildCandidate = input.buildCandidateImpl ?? buildKnowledgeCandidate
  const candidate = await buildCandidate({
    domain: candidateDomain,
    sources: loaded.sources,
    extractors,
    expectedOverlay: input.expectedOverlay ?? {},
    gapMappings: [],
    aliasesByTopicId: input.aliasesByTopicId ?? {}
  })
  if (!candidate.ok) return blocked('candidate', candidate.diagnostics, domain.id)

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

  const cachePath = input.cachePath ?? join(tmpdir(), 'n-rules-package-knowledge', fingerprint(domain.id).slice(7), 'claims.json')
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

  const graphWithClaims = {
    ...candidate.graph,
    claims: [...candidate.graph.claims, ...claims.claims].toSorted((left, right) => left.id.localeCompare(right.id))
  }
  const gaps = evaluateGaps({ graph: graphWithClaims, mappings: input.gapMappings ?? [] })
  if (!gaps.ok) return blocked('gaps', gaps.diagnostics, domain.id)
  const graph = { ...graphWithClaims, topics: discoverTopics(graphWithClaims, { aliasesByTopicId: input.aliasesByTopicId ?? {} }), gaps: gaps.gaps }

  const readExisting = input.readExistingMarkdownImpl ?? readExistingMarkdown
  let existingFiles
  try {
    existingFiles = await readExisting(domain.root)
  } catch (error) {
    return blocked('existing-docs', [{ code: 'existing-docs-read-failed', detail: String(error) }], domain.id)
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

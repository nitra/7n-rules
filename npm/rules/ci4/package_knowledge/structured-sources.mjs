/**
 * Виявляє та нормалізує package-owned structured config, schema і contract sources.
 *
 * Модуль не аналізує language source і не робить text/regex fallback: кожен
 * recognized artifact проходить native structured parser, а malformed input
 * повертає blocking diagnostic до побудови knowledge candidate.
 */

import { createHash } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import { basename, isAbsolute, relative, resolve, sep } from 'node:path'

import { parse as parseGraphql } from 'graphql'
import { globby } from 'globby'
import { parse as parseToml } from 'smol-toml'
import { parseDocument } from 'yaml'

const ARTIFACT_PATTERNS = Object.freeze([
  '**/openapi.{json,yaml,yml}',
  '**/asyncapi.{json,yaml,yml}',
  '**/*.{graphql,gql}',
  '**/*.schema.json',
  '**/schema.json',
  '**/config/**/*.{json,yaml,yml,toml}',
  '**/configs/**/*.{json,yaml,yml,toml}',
  '.n-rules.json',
  'tsconfig.json'
])
const DEFAULT_IGNORES = Object.freeze([
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
const NODE_KINDS = new Set(['config', 'integration'])
const VISIBILITIES = new Set(['public', 'package', 'external'])
const EVIDENCE_KINDS = new Set(['config', 'schema'])
const EDGE_KINDS = new Set(['contains', 'implements'])

/** Creates a stable structured-source diagnostic. */
function diagnostic(code, detail, path = null) {
  return { code, detail, path }
}

/** Returns a short stable digest for graph identities. */
function digest(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 24)
}

/** Returns an exact source content hash. */
function contentHash(content) {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`
}

/** Converts a filesystem path to a stable POSIX relative path. */
function toPosix(path) {
  return path.split(sep).join('/')
}

/** Returns true only for a strict path inside an owned domain. */
function isWithin(root, path) {
  const rel = relative(root, path)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** Builds nested documentation-domain ignore patterns relative to the current domain. */
function nestedDomainIgnores(domain) {
  if (!Array.isArray(domain?.excludedSourceRoots) || typeof domain.sourceRoot !== 'string') return []
  return domain.excludedSourceRoots
    .map(excluded => toPosix(relative(domain.sourceRoot === '.' ? '' : domain.sourceRoot, excluded)))
    .filter(path => path !== '' && path !== '.' && !path.startsWith('../'))
    .flatMap(path => [path, `${path}/**`])
    .toSorted()
}

/** Identifies a recognized structured artifact from its owned relative path. */
function artifactKind(path, manifestName) {
  const name = basename(path).toLowerCase()
  if (name === manifestName.toLowerCase()) return 'manifest'
  if (name.startsWith('openapi.')) return 'openapi'
  if (name.startsWith('asyncapi.')) return 'asyncapi'
  if (path.endsWith('.graphql') || path.endsWith('.gql')) return 'graphql'
  if (path.endsWith('.schema.json') || name === 'schema.json') return 'json-schema'
  return 'config'
}

/** Parses a recognized artifact with its native structured parser only. */
function parseArtifact(kind, path, content) {
  try {
    if (kind === 'graphql') return { ok: true, value: parseGraphql(content), format: 'graphql' }
    if (path.endsWith('.json')) return { ok: true, value: JSON.parse(content), format: 'json' }
    if (path.endsWith('.toml')) return { ok: true, value: parseToml(content), format: 'toml' }
    const document = parseDocument(content)
    if (document.errors.length > 0) throw document.errors[0]
    return { ok: true, value: document.toJS(), format: 'yaml' }
  } catch (error) {
    return {
      ok: false,
      diagnostic: diagnostic(
        'structured-parse-failed',
        `Не вдалося розібрати recognized ${kind} artifact: ${error instanceof Error ? error.message : String(error)}`,
        path
      )
    }
  }
}

/** Reads one discovered artifact without permitting a symlink to leave its domain. */
async function readOwnedArtifact(root, path) {
  const absolute = resolve(root, path)
  try {
    const resolved = await realpath(absolute)
    if (!isWithin(root, resolved)) {
      return { ok: false, diagnostic: diagnostic('structured-outside-domain', `Artifact ${path} виходить за domain boundary.`, path) }
    }
    return { ok: true, content: await readFile(resolved, 'utf8') }
  } catch (error) {
    return {
      ok: false,
      diagnostic: diagnostic('structured-read-failed', error instanceof Error ? error.message : String(error), path)
    }
  }
}

/** Makes a deterministic public/package node and evidence record for one artifact. */
function sourceNode({ domain, path, kind, format, hash, value }) {
  const token = digest(`${kind}:${path}`)
  const base = {
    domainId: domain.id,
    attributes: { sourcePath: path, artifact: kind, format },
    sourceFingerprint: hash
  }
  const evidenceKind = kind === 'manifest' || kind === 'config' ? 'config' : 'schema'
  const source = {
    id: `evidence:${digest(`${evidenceKind}:${path}:${hash}`)}`,
    kind: evidenceKind,
    path,
    contentHash: hash,
    role: 'syntax'
  }
  if (kind === 'manifest' || kind === 'config') {
    const id = `config:${domain.id}:${token}`
    return {
      nodes: [{ id, kind: 'config', name: path, visibility: 'package', ...base }],
      edges: [],
      evidence: [{ ...source, symbolId: id }]
    }
  }
  const label =
    typeof value?.info?.title === 'string'
      ? value.info.title
      : typeof value?.name === 'string'
        ? value.name
        : basename(path)
  const schemaId = `schema:${domain.id}:${token}`
  const contractId = `contract:${domain.id}:${token}`
  return {
    nodes: [
      {
        id: schemaId,
        kind: 'config',
        name: `${label} schema`,
        visibility: 'public',
        ...base,
        attributes: { ...base.attributes, artifact: 'schema' }
      },
      {
        id: contractId,
        kind: 'integration',
        name: label,
        visibility: 'external',
        ...base,
        attributes: { ...base.attributes, boundary: 'contract' }
      }
    ],
    edges: [
      {
        id: `edge:${digest(`${schemaId}:implements:${contractId}:${source.id}`)}`,
        kind: 'implements',
        fromId: schemaId,
        toId: contractId,
        evidenceIds: [source.id]
      }
    ],
    evidence: [{ ...source, symbolId: schemaId }]
  }
}

/** Validates semantic requirements that parsers cannot express by syntax alone. */
function validateArtifact(kind, value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, diagnostic: diagnostic('structured-root-invalid', `${kind} має бути structured object.`, path) }
  }
  if (kind === 'openapi' && typeof value.openapi !== 'string')
    return { ok: false, diagnostic: diagnostic('openapi-version-missing', 'OpenAPI artifact не має string openapi version.', path) }
  if (kind === 'asyncapi' && typeof value.asyncapi !== 'string')
    return { ok: false, diagnostic: diagnostic('asyncapi-version-missing', 'AsyncAPI artifact не має string asyncapi version.', path) }
  if (kind === 'json-schema' && typeof value.$schema !== 'string')
    return { ok: false, diagnostic: diagnostic('json-schema-id-missing', 'JSON Schema не має string $schema.', path) }
  return { ok: true }
}

/**
 * Discovers and parses package-owned structured sources without language adapters.
 * @param {{domain: Record<string, unknown>}} input resolved documentation domain
 * @returns {Promise<{ok: true, fragments: object[], evidenceContentById: Record<string, string>} | {ok: false, diagnostics: object[]}>} graph fragments or blockers
 */
export async function loadStructuredSources({ domain }) {
  if (!domain || typeof domain.root !== 'string' || !isAbsolute(domain.root) || typeof domain.rootManifest !== 'string') {
    return { ok: false, diagnostics: [diagnostic('invalid-structured-domain', 'Domain має містити absolute root і rootManifest.')] }
  }
  let root
  try {
    root = await realpath(domain.root)
  } catch (error) {
    return { ok: false, diagnostics: [diagnostic('structured-domain-unavailable', String(error), domain.root)] }
  }
  const manifestName = basename(domain.rootManifest)
  const discovered = await globby(ARTIFACT_PATTERNS, {
    cwd: root,
    onlyFiles: true,
    gitignore: true,
    followSymbolicLinks: false,
    ignore: [...DEFAULT_IGNORES, ...nestedDomainIgnores(domain)]
  })
  const paths = [...new Set([manifestName, ...discovered.map(toPosix)])].toSorted((left, right) => left.localeCompare(right))
  const fragments = []
  const evidenceContentById = {}
  const diagnostics = []
  for (const path of paths) {
    const loaded = await readOwnedArtifact(root, path)
    if (!loaded.ok) {
      diagnostics.push(loaded.diagnostic)
      continue
    }
    const kind = artifactKind(path, manifestName)
    const parsed = parseArtifact(kind, path, loaded.content)
    if (!parsed.ok) {
      diagnostics.push(parsed.diagnostic)
      continue
    }
    const valid = validateArtifact(kind, parsed.value, path)
    if (!valid.ok) {
      diagnostics.push(valid.diagnostic)
      continue
    }
    const hash = contentHash(loaded.content)
    const projection = sourceNode({ domain, path, kind, format: parsed.format, hash, value: parsed.value })
    for (const evidence of projection.evidence) evidenceContentById[evidence.id] = loaded.content
    fragments.push({ ok: true, file: { path, contentHash: hash }, ...projection })
  }
  if (diagnostics.length > 0) {
    return {
      ok: false,
      diagnostics: diagnostics.toSorted((left, right) => `${left.path ?? ''}:${left.code}`.localeCompare(`${right.path ?? ''}:${right.code}`))
    }
  }
  return {
    ok: true,
    fragments: fragments.toSorted((left, right) => left.file.path.localeCompare(right.file.path)),
    evidenceContentById: Object.fromEntries(Object.entries(evidenceContentById).toSorted(([left], [right]) => left.localeCompare(right)))
  }
}

/** Validates one injected structured graph fragment before it can extend a candidate. */
function validateFragment(fragment, domain) {
  const path = fragment?.file?.path
  if (!fragment || fragment.ok !== true || typeof path !== 'string' || typeof fragment.file.contentHash !== 'string') {
    return { ok: false, diagnostics: [diagnostic('invalid-structured-fragment', 'Structured fragment має містити ok, file.path і contentHash.', path ?? null)] }
  }
  if (!Array.isArray(fragment.nodes) || !Array.isArray(fragment.edges) || !Array.isArray(fragment.evidence)) {
    return { ok: false, diagnostics: [diagnostic('invalid-structured-fragment', 'Structured fragment має nodes, edges і evidence arrays.', path)] }
  }
  const diagnostics = []
  for (const node of fragment.nodes) {
    if (!node || typeof node.id !== 'string' || !NODE_KINDS.has(node.kind) || !VISIBILITIES.has(node.visibility) || node.domainId !== domain.id) {
      diagnostics.push(diagnostic('invalid-structured-node', 'Structured node має known kind, visibility і owning domain.', path))
    }
  }
  for (const evidence of fragment.evidence) {
    if (!evidence || typeof evidence.id !== 'string' || !EVIDENCE_KINDS.has(evidence.kind) || evidence.path !== path || typeof evidence.contentHash !== 'string') {
      diagnostics.push(diagnostic('invalid-structured-evidence', 'Structured evidence має exact source path/content hash і known kind.', path))
    }
  }
  const ids = new Set(fragment.nodes.map(node => node?.id))
  const evidenceIds = new Set(fragment.evidence.map(evidence => evidence?.id))
  for (const edge of fragment.edges) {
    if (!edge || typeof edge.id !== 'string' || !EDGE_KINDS.has(edge.kind) || !ids.has(edge.fromId) || !ids.has(edge.toId) || !Array.isArray(edge.evidenceIds) || edge.evidenceIds.some(id => !evidenceIds.has(id))) {
      diagnostics.push(diagnostic('invalid-structured-edge', 'Structured edge має local nodes і evidence provenance.', path))
    }
  }
  return diagnostics.length > 0 ? { ok: false, diagnostics } : { ok: true, value: fragment }
}

/**
 * Merges deterministic structured fragments into a normalized language graph.
 * @param {{graph: Record<string, unknown>, domain: Record<string, unknown>, fragments?: unknown[]}} input graph and injected fragments
 * @returns {{ok: true, graph: Record<string, unknown>} | {ok: false, diagnostics: object[]}} extended graph or blockers
 */
export function mergeStructuredFragments({ graph, domain, fragments = [] }) {
  if (!Array.isArray(fragments)) return { ok: false, diagnostics: [diagnostic('invalid-structured-fragments', 'structuredFragments має бути масивом.')] }
  const checked = fragments.map(fragment => validateFragment(fragment, domain))
  const diagnostics = checked.flatMap(result => (result.ok ? [] : result.diagnostics))
  if (diagnostics.length > 0) return { ok: false, diagnostics: diagnostics.toSorted((left, right) => `${left.path ?? ''}:${left.code}`.localeCompare(`${right.path ?? ''}:${right.code}`)) }
  const sorted = checked.map(result => result.value).toSorted((left, right) => left.file.path.localeCompare(right.file.path))
  const nodes = [...graph.nodes]
  const edges = [...graph.edges]
  const evidence = [...graph.evidence]
  const nodeIds = new Set(nodes.map(node => node.id))
  const edgeIds = new Set(edges.map(edge => edge.id))
  const evidenceIds = new Set(evidence.map(item => item.id))
  for (const fragment of sorted) {
    for (const node of fragment.nodes) {
      if (nodeIds.has(node.id)) diagnostics.push(diagnostic('duplicate-structured-node', node.id, fragment.file.path))
      else {
        nodeIds.add(node.id)
        nodes.push(node)
      }
    }
    for (const item of fragment.evidence) {
      if (evidenceIds.has(item.id)) diagnostics.push(diagnostic('duplicate-structured-evidence', item.id, fragment.file.path))
      else {
        evidenceIds.add(item.id)
        evidence.push(item)
      }
    }
    for (const edge of fragment.edges) {
      if (edgeIds.has(edge.id)) diagnostics.push(diagnostic('duplicate-structured-edge', edge.id, fragment.file.path))
      else {
        edgeIds.add(edge.id)
        edges.push(edge)
      }
    }
  }
  if (diagnostics.length > 0) return { ok: false, diagnostics: diagnostics.toSorted((left, right) => `${left.path ?? ''}:${left.code}`.localeCompare(`${right.path ?? ''}:${right.code}`)) }
  return {
    ok: true,
    graph: {
      ...graph,
      nodes: nodes.toSorted((left, right) => left.id.localeCompare(right.id)),
      edges: edges.toSorted((left, right) => left.id.localeCompare(right.id)),
      evidence: evidence.toSorted((left, right) => left.id.localeCompare(right.id))
    }
  }
}

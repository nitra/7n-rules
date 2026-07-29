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

import { createImplementedClaimId } from './claims.mjs'

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
const OPENAPI_METHODS = Object.freeze(['delete', 'get', 'head', 'options', 'patch', 'post', 'put', 'trace'])
const GRAPHQL_TYPE_DEFINITIONS = new Set([
  'EnumTypeDefinition',
  'InputObjectTypeDefinition',
  'InterfaceTypeDefinition',
  'ObjectTypeDefinition',
  'ScalarTypeDefinition',
  'UnionTypeDefinition'
])
const STRUCTURED_CLAIM_PREDICATES = new Set([
  'declares-artifact',
  'declares-asyncapi-channel',
  'declares-graphql-definition',
  'declares-json-schema',
  'declares-openapi-operation'
])

/**
 * Creates a stable structured-source diagnostic.
 * @param {string} code machine-readable diagnostic code
 * @param {string} detail human-readable diagnostic detail
 * @param {string | null} [path] owned relative source path
 * @returns {{code: string, detail: string, path: string | null}} stable diagnostic
 */
function diagnostic(code, detail, path = null) {
  return { code, detail, path }
}

/**
 * Returns a short stable digest for graph identities.
 * @param {string} value identity payload
 * @returns {string} SHA-256 digest prefix
 */
function digest(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 24)
}

/**
 * Returns an exact source content hash.
 * @param {string} content source text
 * @returns {string} SHA-256 content fingerprint
 */
function contentHash(content) {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`
}

/**
 * Returns true for a JSON object without array semantics.
 * @param {unknown} value candidate value
 * @returns {boolean} whether value is a non-array object
 */
function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Creates one deterministic, artifact-backed implemented claim.
 * @param {{domainId: string, subjectId: string, predicate: string, value: Record<string, unknown>, evidenceId: string, sourceFingerprint: string}} input claim fields
 * @returns {Record<string, unknown>} normalized implemented claim
 */
function structuredClaim({ domainId, subjectId, predicate, value, evidenceId, sourceFingerprint }) {
  const evidenceIds = [evidenceId]
  return {
    id: createImplementedClaimId({ domainId, subjectId, predicate, value, evidenceIds }),
    subjectId,
    layer: 'implemented',
    predicate,
    value,
    evidenceIds,
    confidence: 1,
    sourceFingerprint
  }
}

/**
 * Returns public OpenAPI operation claims without serializing operation content.
 * @param {{domainId: string, subjectId: string, value: Record<string, unknown>, evidenceId: string, sourceFingerprint: string}} input schema context
 * @returns {Record<string, unknown>[]} public operation claims
 */
function openApiClaims({ domainId, subjectId, value, evidenceId, sourceFingerprint }) {
  if (!isObject(value?.paths)) return []
  return Object.entries(value.paths)
    .filter(([, pathItem]) => isObject(pathItem))
    .toSorted(([left], [right]) => left.localeCompare(right))
    .flatMap(([path, pathItem]) =>
      OPENAPI_METHODS.filter(method => isObject(pathItem[method])).map(method =>
        structuredClaim({
          domainId,
          subjectId,
          predicate: 'declares-openapi-operation',
          value: { path, method },
          evidenceId,
          sourceFingerprint
        })
      )
    )
}

/**
 * Returns public AsyncAPI channel claims without serializing channel messages or bindings.
 * @param {{domainId: string, subjectId: string, value: Record<string, unknown>, evidenceId: string, sourceFingerprint: string}} input schema context
 * @returns {Record<string, unknown>[]} public channel claims
 */
function asyncApiClaims({ domainId, subjectId, value, evidenceId, sourceFingerprint }) {
  if (!isObject(value?.channels)) return []
  return Object.keys(value.channels)
    .toSorted()
    .map(channel =>
      structuredClaim({
        domainId,
        subjectId,
        predicate: 'declares-asyncapi-channel',
        value: { channel },
        evidenceId,
        sourceFingerprint
      })
    )
}

/**
 * Returns GraphQL operation and type-definition surface claims from the parsed AST.
 * @param {{domainId: string, subjectId: string, value: {definitions?: object[]}, evidenceId: string, sourceFingerprint: string}} input schema context
 * @returns {Record<string, unknown>[]} public GraphQL claims
 */
function graphqlClaims({ domainId, subjectId, value, evidenceId, sourceFingerprint }) {
  if (!Array.isArray(value?.definitions)) return []
  return value.definitions
    .flatMap(definition => {
      const name = typeof definition?.name?.value === 'string' ? definition.name.value : null
      if (definition?.kind === 'OperationDefinition') {
        const claimValue = { definition: 'operation', operation: definition.operation }
        if (name) claimValue.name = name
        return [
          structuredClaim({
            domainId,
            subjectId,
            predicate: 'declares-graphql-definition',
            value: claimValue,
            evidenceId,
            sourceFingerprint
          })
        ]
      }
      if (!GRAPHQL_TYPE_DEFINITIONS.has(definition?.kind) || !name) return []
      return [
        structuredClaim({
          domainId,
          subjectId,
          predicate: 'declares-graphql-definition',
          value: { definition: definition.kind, name },
          evidenceId,
          sourceFingerprint
        })
      ]
    })
    .toSorted((left, right) => left.id.localeCompare(right.id))
}

/**
 * Returns a JSON Schema title/type claim without projecting arbitrary schema values.
 * @param {{domainId: string, subjectId: string, value: {title?: unknown, type?: unknown}, evidenceId: string, sourceFingerprint: string}} input schema context
 * @returns {Record<string, unknown>[]} public JSON Schema claims
 */
function jsonSchemaClaims({ domainId, subjectId, value, evidenceId, sourceFingerprint }) {
  const claimValue = {}
  if (typeof value?.title === 'string') claimValue.title = value.title
  if (typeof value?.type === 'string') claimValue.type = value.type
  if (Array.isArray(value?.type) && value.type.every(type => typeof type === 'string')) {
    claimValue.type = [...value.type].toSorted()
  }
  if (Object.keys(claimValue).length === 0) return []
  return [
    structuredClaim({
      domainId,
      subjectId,
      predicate: 'declares-json-schema',
      value: claimValue,
      evidenceId,
      sourceFingerprint
    })
  ]
}

/**
 * Returns deterministic contract-surface claims for a parsed schema artifact.
 * @param {{domain: {id: string}, kind: string, format: string, hash: string, value: Record<string, unknown>, schemaId: string, contractId: string, evidenceId: string}} input artifact context
 * @returns {Record<string, unknown>[]} deterministic claims
 */
function schemaClaims({ domain, kind, format, hash, value, schemaId, contractId, evidenceId }) {
  const claims = [
    structuredClaim({
      domainId: domain.id,
      subjectId: schemaId,
      predicate: 'declares-artifact',
      value: { artifact: kind, format },
      evidenceId,
      sourceFingerprint: hash
    })
  ]
  const context = { domainId: domain.id, subjectId: contractId, value, evidenceId, sourceFingerprint: hash }
  switch (kind) {
    case 'openapi': {
      claims.push(...openApiClaims(context))
      break
    }
    case 'asyncapi': {
      claims.push(...asyncApiClaims(context))
      break
    }
    case 'graphql': {
      claims.push(...graphqlClaims(context))
      break
    }
    case 'json-schema': {
      claims.push(...jsonSchemaClaims({ ...context, subjectId: schemaId }))
      break
    }
  }
  return claims.toSorted((left, right) => left.id.localeCompare(right.id))
}

/**
 * Converts a filesystem path to a stable POSIX relative path.
 * @param {string} path filesystem path
 * @returns {string} POSIX path
 */
function toPosix(path) {
  return path.split(sep).join('/')
}

/**
 * Returns true only for a strict path inside an owned domain.
 * @param {string} root owned absolute root
 * @param {string} path candidate absolute path
 * @returns {boolean} whether the path stays within root
 */
function isWithin(root, path) {
  const rel = relative(root, path)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * Builds nested documentation-domain ignore patterns relative to the current domain.
 * @param {{sourceRoot?: string, excludedSourceRoots?: string[]}} domain resolved domain
 * @returns {string[]} stable glob exclusions
 */
function nestedDomainIgnores(domain) {
  if (!Array.isArray(domain?.excludedSourceRoots) || typeof domain.sourceRoot !== 'string') return []
  return domain.excludedSourceRoots
    .map(excluded => toPosix(relative(domain.sourceRoot === '.' ? '' : domain.sourceRoot, excluded)))
    .filter(path => path !== '' && path !== '.' && !path.startsWith('../'))
    .flatMap(path => [path, `${path}/**`])
    .toSorted()
}

/**
 * Identifies a recognized structured artifact from its owned relative path.
 * @param {string} path owned relative path
 * @param {string} manifestName root manifest basename
 * @returns {'manifest'|'openapi'|'asyncapi'|'graphql'|'json-schema'|'config'} artifact kind
 */
function artifactKind(path, manifestName) {
  const name = basename(path).toLowerCase()
  if (name === manifestName.toLowerCase()) return 'manifest'
  if (name.startsWith('openapi.')) return 'openapi'
  if (name.startsWith('asyncapi.')) return 'asyncapi'
  if (path.endsWith('.graphql') || path.endsWith('.gql')) return 'graphql'
  if (path.endsWith('.schema.json') || name === 'schema.json') return 'json-schema'
  return 'config'
}

/**
 * Parses a recognized artifact with its native structured parser only.
 * @param {string} kind recognized artifact kind
 * @param {string} path owned relative path
 * @param {string} content source text
 * @returns {{ok: true, value: Record<string, unknown>, format: string} | {ok: false, diagnostic: Record<string, unknown>}} parsed artifact or diagnostic
 */
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

/**
 * Reads one discovered artifact without permitting a symlink to leave its domain.
 * @param {string} root owned absolute root
 * @param {string} path owned relative path
 * @returns {Promise<{ok: true, content: string} | {ok: false, diagnostic: Record<string, unknown>}>} owned content or diagnostic
 */
async function readOwnedArtifact(root, path) {
  const absolute = resolve(root, path)
  try {
    const resolved = await realpath(absolute)
    if (!isWithin(root, resolved)) {
      return {
        ok: false,
        diagnostic: diagnostic('structured-outside-domain', `Artifact ${path} виходить за domain boundary.`, path)
      }
    }
    return { ok: true, content: await readFile(resolved, 'utf8') }
  } catch (error) {
    return {
      ok: false,
      diagnostic: diagnostic('structured-read-failed', error instanceof Error ? error.message : String(error), path)
    }
  }
}

/**
 * Makes a deterministic public/package node and evidence record for one artifact.
 * @param {{domain: {id: string}, path: string, kind: string, format: string, hash: string, value: Record<string, unknown>}} input artifact context
 * @returns {{nodes: object[], edges: object[], evidence: object[], claims: object[]}} projected graph fragment
 */
function sourceNode({ domain, path, kind, format, hash, value }) {
  const token = digest(`${kind}:${path}`)
  const base = {
    domainId: domain.id,
    attributes: { sourcePath: path, artifact: kind, format },
    sourceFingerprint: hash
  }
  const evidenceKind = kind === 'manifest' || kind === 'config' ? 'config' : 'schema'
  const evidenceIdentity = `${evidenceKind}:${path}:${hash}`
  const source = {
    id: `evidence:${digest(evidenceIdentity)}`,
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
      evidence: [{ ...source, symbolId: id }],
      claims: [
        structuredClaim({
          domainId: domain.id,
          subjectId: id,
          predicate: 'declares-artifact',
          value: { artifact: kind, format },
          evidenceId: source.id,
          sourceFingerprint: hash
        })
      ]
    }
  }
  let label = basename(path)
  if (typeof value?.info?.title === 'string') label = value.info.title
  else if (typeof value?.name === 'string') label = value.name
  const schemaId = `schema:${domain.id}:${token}`
  const contractId = `contract:${domain.id}:${token}`
  const edgeIdentity = `${schemaId}:implements:${contractId}:${source.id}`
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
        id: `edge:${digest(edgeIdentity)}`,
        kind: 'implements',
        fromId: schemaId,
        toId: contractId,
        evidenceIds: [source.id]
      }
    ],
    evidence: [{ ...source, symbolId: schemaId }],
    claims: schemaClaims({
      domain,
      kind,
      format,
      hash,
      value,
      schemaId,
      contractId,
      evidenceId: source.id
    })
  }
}

/**
 * Validates semantic requirements that parsers cannot express by syntax alone.
 * @param {string} kind recognized artifact kind
 * @param {unknown} value parsed artifact value
 * @param {string} path owned relative path
 * @returns {{ok: true} | {ok: false, diagnostic: Record<string, unknown>}} validation result
 */
function validateArtifact(kind, value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, diagnostic: diagnostic('structured-root-invalid', `${kind} має бути structured object.`, path) }
  }
  if (kind === 'openapi' && typeof value.openapi !== 'string')
    return {
      ok: false,
      diagnostic: diagnostic('openapi-version-missing', 'OpenAPI artifact не має string openapi version.', path)
    }
  if (kind === 'asyncapi' && typeof value.asyncapi !== 'string')
    return {
      ok: false,
      diagnostic: diagnostic('asyncapi-version-missing', 'AsyncAPI artifact не має string asyncapi version.', path)
    }
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
  if (
    !domain ||
    typeof domain.root !== 'string' ||
    !isAbsolute(domain.root) ||
    typeof domain.rootManifest !== 'string'
  ) {
    return {
      ok: false,
      diagnostics: [diagnostic('invalid-structured-domain', 'Domain має містити absolute root і rootManifest.')]
    }
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
  const paths = [...new Set([manifestName, ...discovered.map(path => toPosix(path))])].toSorted((left, right) =>
    left.localeCompare(right)
  )
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
      diagnostics: diagnostics.toSorted((left, right) =>
        `${left.path ?? ''}:${left.code}`.localeCompare(`${right.path ?? ''}:${right.code}`)
      )
    }
  }
  return {
    ok: true,
    fragments: fragments.toSorted((left, right) => left.file.path.localeCompare(right.file.path)),
    evidenceContentById: Object.fromEntries(
      Object.entries(evidenceContentById).toSorted(([left], [right]) => left.localeCompare(right))
    )
  }
}

/**
 * Returns whether a claim value can contain only public artifact metadata.
 * @param {string} predicate claim predicate
 * @param {unknown} value claim payload
 * @returns {boolean} whether the payload is safe public metadata
 */
function isSafeClaimValue(predicate, value) {
  if (!isObject(value)) return false
  const keys = Object.keys(value).toSorted()
  if (predicate === 'declares-artifact') {
    return (
      keys.join(',') === 'artifact,format' && typeof value.artifact === 'string' && typeof value.format === 'string'
    )
  }
  if (predicate === 'declares-openapi-operation') {
    return keys.join(',') === 'method,path' && typeof value.method === 'string' && typeof value.path === 'string'
  }
  if (predicate === 'declares-asyncapi-channel') {
    return keys.join(',') === 'channel' && typeof value.channel === 'string'
  }
  if (predicate === 'declares-graphql-definition') {
    if (!keys.includes('definition') || keys.some(key => !['definition', 'name', 'operation'].includes(key)))
      return false
    return (
      typeof value.definition === 'string' &&
      (value.name === undefined || typeof value.name === 'string') &&
      (value.operation === undefined || typeof value.operation === 'string')
    )
  }
  if (predicate === 'declares-json-schema') {
    if (keys.length === 0 || keys.some(key => !['title', 'type'].includes(key))) return false
    return (
      (value.title === undefined || typeof value.title === 'string') &&
      (value.type === undefined ||
        typeof value.type === 'string' ||
        (Array.isArray(value.type) && value.type.every(type => typeof type === 'string')))
    )
  }
  return false
}

/**
 * Validates one artifact-backed claim before it can join a candidate graph.
 * @param {unknown} claim candidate claim
 * @param {{domain: {id: string}, nodeIds: Set<string>, evidenceIds: Set<string>, contentHash: string}} context local graph context
 * @returns {boolean} whether the claim is deterministic and local
 */
function validStructuredClaim(claim, { domain, nodeIds, evidenceIds, contentHash }) {
  if (!isObject(claim) || claim.layer !== 'implemented' || !STRUCTURED_CLAIM_PREDICATES.has(claim.predicate))
    return false
  if (
    typeof claim.id !== 'string' ||
    typeof claim.subjectId !== 'string' ||
    !nodeIds.has(claim.subjectId) ||
    !Array.isArray(claim.evidenceIds) ||
    claim.evidenceIds.length === 0 ||
    new Set(claim.evidenceIds).size !== claim.evidenceIds.length ||
    claim.evidenceIds.some(id => !evidenceIds.has(id)) ||
    claim.confidence !== 1 ||
    claim.sourceFingerprint !== contentHash ||
    !isSafeClaimValue(claim.predicate, claim.value)
  ) {
    return false
  }
  return (
    claim.id ===
    createImplementedClaimId({
      domainId: domain.id,
      subjectId: claim.subjectId,
      predicate: claim.predicate,
      value: claim.value,
      evidenceIds: claim.evidenceIds
    })
  )
}

/**
 * Validates one injected structured graph fragment before it can extend a candidate.
 * @param {unknown} fragment candidate fragment
 * @param {{id: string}} domain owning domain
 * @returns {{ok: true, value: Record<string, unknown>} | {ok: false, diagnostics: Record<string, unknown>[]}} validated fragment or diagnostics
 */
function validateFragment(fragment, domain) {
  const path = fragment?.file?.path
  if (!fragment || fragment.ok !== true || typeof path !== 'string' || typeof fragment.file.contentHash !== 'string') {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          'invalid-structured-fragment',
          'Structured fragment має містити ok, file.path і contentHash.',
          path ?? null
        )
      ]
    }
  }
  if (
    !Array.isArray(fragment.nodes) ||
    !Array.isArray(fragment.edges) ||
    !Array.isArray(fragment.evidence) ||
    (fragment.claims !== undefined && !Array.isArray(fragment.claims))
  ) {
    return {
      ok: false,
      diagnostics: [
        diagnostic('invalid-structured-fragment', 'Structured fragment має nodes, edges і evidence arrays.', path)
      ]
    }
  }
  const diagnostics = []
  for (const node of fragment.nodes) {
    if (
      !node ||
      typeof node.id !== 'string' ||
      !NODE_KINDS.has(node.kind) ||
      !VISIBILITIES.has(node.visibility) ||
      node.domainId !== domain.id
    ) {
      diagnostics.push(
        diagnostic('invalid-structured-node', 'Structured node має known kind, visibility і owning domain.', path)
      )
    }
  }
  for (const evidence of fragment.evidence) {
    if (
      !evidence ||
      typeof evidence.id !== 'string' ||
      !EVIDENCE_KINDS.has(evidence.kind) ||
      evidence.path !== path ||
      typeof evidence.contentHash !== 'string'
    ) {
      diagnostics.push(
        diagnostic(
          'invalid-structured-evidence',
          'Structured evidence має exact source path/content hash і known kind.',
          path
        )
      )
    }
  }
  const ids = new Set(fragment.nodes.map(node => node?.id))
  const evidenceIds = new Set(fragment.evidence.map(evidence => evidence?.id))
  for (const edge of fragment.edges) {
    if (
      !edge ||
      typeof edge.id !== 'string' ||
      !EDGE_KINDS.has(edge.kind) ||
      !ids.has(edge.fromId) ||
      !ids.has(edge.toId) ||
      !Array.isArray(edge.evidenceIds) ||
      edge.evidenceIds.some(id => !evidenceIds.has(id))
    ) {
      diagnostics.push(
        diagnostic('invalid-structured-edge', 'Structured edge має local nodes і evidence provenance.', path)
      )
    }
  }
  const claims = fragment.claims ?? []
  const claimIds = new Set()
  for (const claim of claims) {
    if (!validStructuredClaim(claim, { domain, nodeIds: ids, evidenceIds, contentHash: fragment.file.contentHash })) {
      diagnostics.push(
        diagnostic('invalid-structured-claim', 'Structured claim має бути deterministic, local та metadata-only.', path)
      )
      continue
    }
    if (claimIds.has(claim.id)) diagnostics.push(diagnostic('duplicate-structured-claim', claim.id, path))
    claimIds.add(claim.id)
  }
  return diagnostics.length > 0 ? { ok: false, diagnostics } : { ok: true, value: { ...fragment, claims } }
}

/**
 * Adds one validated fragment to mutable graph collections or returns identity collisions.
 * @param {{nodes: object[], edges: object[], evidence: object[], claims: object[], file: {path: string}}} fragment validated fragment
 * @param {{nodes: object[], edges: object[], evidence: object[], claims: object[], nodeIds: Set<string>, edgeIds: Set<string>, evidenceIds: Set<string>, claimIds: Set<string>}} collections mutable graph collections
 * @returns {Record<string, unknown>[]} identity-collision diagnostics
 */
function mergeFragmentCollections(
  fragment,
  { nodes, edges, evidence, claims, nodeIds, edgeIds, evidenceIds, claimIds }
) {
  const diagnostics = []
  for (const node of fragment.nodes) {
    if (nodeIds.has(node.id)) diagnostics.push(diagnostic('duplicate-structured-node', node.id, fragment.file.path))
    else {
      nodeIds.add(node.id)
      nodes.push(node)
    }
  }
  for (const item of fragment.evidence) {
    if (evidenceIds.has(item.id))
      diagnostics.push(diagnostic('duplicate-structured-evidence', item.id, fragment.file.path))
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
  for (const claim of fragment.claims) {
    if (claimIds.has(claim.id)) diagnostics.push(diagnostic('duplicate-structured-claim', claim.id, fragment.file.path))
    else {
      claimIds.add(claim.id)
      claims.push(claim)
    }
  }
  return diagnostics
}

/**
 * Merges deterministic structured fragments into a normalized language graph.
 * @param {{graph: Record<string, unknown>, domain: Record<string, unknown>, fragments?: unknown[]}} input graph and injected fragments
 * @returns {{ok: true, graph: Record<string, unknown>} | {ok: false, diagnostics: object[]}} extended graph or blockers
 */
export function mergeStructuredFragments({ graph, domain, fragments = [] }) {
  if (!Array.isArray(fragments))
    return {
      ok: false,
      diagnostics: [diagnostic('invalid-structured-fragments', 'structuredFragments має бути масивом.')]
    }
  const checked = fragments.map(fragment => validateFragment(fragment, domain))
  const diagnostics = checked.flatMap(result => (result.ok ? [] : result.diagnostics))
  if (diagnostics.length > 0)
    return {
      ok: false,
      diagnostics: diagnostics.toSorted((left, right) =>
        `${left.path ?? ''}:${left.code}`.localeCompare(`${right.path ?? ''}:${right.code}`)
      )
    }
  const sorted = checked
    .map(result => result.value)
    .toSorted((left, right) => left.file.path.localeCompare(right.file.path))
  const nodes = [...graph.nodes]
  const edges = [...graph.edges]
  const evidence = [...graph.evidence]
  const claims = Array.isArray(graph.claims) ? [...graph.claims] : []
  const nodeIds = new Set(nodes.map(node => node.id))
  const edgeIds = new Set(edges.map(edge => edge.id))
  const evidenceIds = new Set(evidence.map(item => item.id))
  const claimIds = new Set(claims.map(claim => claim.id))
  for (const fragment of sorted) {
    diagnostics.push(
      ...mergeFragmentCollections(fragment, { nodes, edges, evidence, claims, nodeIds, edgeIds, evidenceIds, claimIds })
    )
  }
  if (diagnostics.length > 0)
    return {
      ok: false,
      diagnostics: diagnostics.toSorted((left, right) =>
        `${left.path ?? ''}:${left.code}`.localeCompare(`${right.path ?? ''}:${right.code}`)
      )
    }
  return {
    ok: true,
    graph: {
      ...graph,
      nodes: nodes.toSorted((left, right) => left.id.localeCompare(right.id)),
      edges: edges.toSorted((left, right) => left.id.localeCompare(right.id)),
      claims: claims.toSorted((left, right) => left.id.localeCompare(right.id)),
      evidence: evidence.toSorted((left, right) => left.id.localeCompare(right.id))
    }
  }
}

/**
 * Надає read-only CLI для committed package knowledge та explicit build surface.
 *
 * Read commands не викликають LLM і не генерують документацію. Explicit
 * `build` запускає generation runner у SHADOW за замовчуванням і публікує
 * artifacts лише з `--publish`; index/slice/validate лишаються read-only.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import Ajv2020 from 'ajv/dist/2020.js'

import { resolveDocumentationDomains } from './domain-resolver.mjs'
import { createImpactSlice } from './impact.mjs'

const SCHEMA_PATH = join(import.meta.dirname, 'schema', 'knowledge-graph-v1.schema.json')

/**
 * Дістає значення обовʼязкового CLI flag.
 * @param {string[]} args command arguments
 * @param {string} name flag name
 * @returns {string | null} flag value
 */
function flagValue(args, name) {
  const index = args.indexOf(name)
  return index === -1 || !args[index + 1] || args[index + 1].startsWith('--') ? null : args[index + 1]
}

/**
 * Пише stable JSON одним CLI record.
 * @param {(line: string) => void} writer output sink
 * @param {unknown} value serializable value
 * @returns {void}
 */
function writeJson(writer, value) {
  writer(JSON.stringify(value, null, 2))
}

/**
 * Забирає absolute runtime paths із публічного domain index.
 * @param {Record<string, unknown>} domain resolved runtime domain
 * @returns {Record<string, unknown>} portable domain description
 */
function publicDomain(domain) {
  return {
    id: domain.id,
    ecosystem: domain.ecosystem,
    name: domain.name,
    rootManifest: domain.rootManifest,
    sourceRoots: domain.sourceRoots,
    excludedSourceRoots: domain.excludedSourceRoots
  }
}

/**
 * Резолвить domain і зупиняє CLI на будь-якій identity/manifest помилці.
 * @param {string} repoRoot repository root
 * @param {string | null} domainId requested domain ID
 * @returns {Promise<object>} resolved domain або structured failure
 */
async function resolveRequestedDomain(repoRoot, domainId) {
  const { domains, diagnostics } = await resolveDocumentationDomains(repoRoot)
  if (diagnostics.length > 0) {
    return {
      ok: false,
      code: 'domain-resolution-blocked',
      message: 'Package knowledge domain resolution має blocking diagnostics.',
      diagnostics
    }
  }
  if (!domainId) return { ok: false, code: 'domain-required', message: 'Потрібен --domain <id>.' }
  const domain = domains.find(candidate => candidate.id === domainId)
  if (!domain) {
    return {
      ok: false,
      code: 'domain-not-found',
      message: `Domain "${domainId}" не знайдено.`,
      diagnostics: domains.map(domainItem => publicDomain(domainItem))
    }
  }
  return { ok: true, domain, domains }
}

/**
 * Читає committed manifest без fallback до cache або legacy doc-files.
 * @param {Record<string, unknown>} domain resolved domain
 * @returns {Promise<object>} parsed manifest або structured failure
 */
async function readManifest(domain) {
  const path = join(domain.root, 'docs', '.docgen', 'manifest.json')
  try {
    const manifest = JSON.parse(await readFile(path, 'utf8'))
    return { ok: true, manifest, path }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      code: 'manifest-unavailable',
      message: `Не вдалося прочитати package knowledge manifest ${path}: ${detail}`
    }
  }
}

/**
 * Валідує manifest schema та identity owning domain-а.
 * @param {Record<string, unknown>} manifest parsed manifest
 * @param {Record<string, unknown>} domain resolved domain
 * @returns {Promise<{ ok: true } | { ok: false, code: string, message: string, errors?: unknown[] }>} validation result
 */
async function validateManifest(manifest, domain) {
  const schema = JSON.parse(await readFile(SCHEMA_PATH, 'utf8'))
  const validate = new Ajv2020({ strict: false }).compile(schema)
  if (!validate(manifest)) {
    return {
      ok: false,
      code: 'manifest-schema-invalid',
      message: 'Manifest не відповідає knowledge graph schema v1.',
      errors: validate.errors ?? []
    }
  }
  if (manifest.domain.id !== domain.id) {
    return {
      ok: false,
      code: 'manifest-domain-mismatch',
      message: `Manifest належить ${manifest.domain.id}, але requested domain має identity ${domain.id}.`
    }
  }
  return { ok: true }
}

/**
 * Будує compact topic index без private symbols і повного evidence graph.
 * @param {Record<string, unknown>} manifest validated manifest
 * @returns {Record<string, unknown>} portable index
 */
function createIndex(manifest) {
  const gapsByStatus = Object.fromEntries(
    ['satisfied', 'missing', 'diverged', 'unresolved'].map(status => [
      status,
      manifest.gaps.filter(gap => gap.status === status).length
    ])
  )
  return {
    schemaVersion: manifest.schemaVersion,
    domain: manifest.domain,
    topics: manifest.topics.map(topic => ({
      id: topic.id,
      kind: topic.kind,
      title: topic.title,
      aliases: topic.aliases ?? []
    })),
    gapsByStatus
  }
}

/**
 * Будує self-contained topic slice з claims, gaps і мінімальним evidence.
 * Private code-unit nodes лишаються traceability data лише в manifest і не
 * потрапляють у цей human/agent-facing view.
 * @param {Record<string, unknown>} manifest validated manifest
 * @param {string} topicId requested topic
 * @returns {{ ok: true, slice: Record<string, unknown> } | { ok: false, code: string, message: string }} topic slice або failure
 */
function createSlice(manifest, topicId) {
  const topic = manifest.topics.find(candidate => candidate.id === topicId || candidate.aliases?.includes(topicId))
  if (!topic) return { ok: false, code: 'topic-not-found', message: `Topic "${topicId}" не знайдено.` }
  const impactResult = createImpactSlice({ graph: manifest, topics: manifest.topics, topicId: topic.id })
  if (!impactResult.ok) {
    return { ok: false, code: impactResult.code, message: impactResult.detail }
  }

  const anchorIds = new Set(topic.anchorIds)
  const claims = manifest.claims.filter(claim => anchorIds.has(claim.subjectId))
  const claimIds = new Set(claims.map(claim => claim.id))
  const gaps = manifest.gaps.filter(
    gap => claimIds.has(gap.expectedClaimId) || gap.implementedClaimIds?.some(id => claimIds.has(id))
  )
  const evidenceIds = new Set([
    ...claims.flatMap(claim => claim.evidenceIds),
    ...gaps.flatMap(gap => gap.evidenceIds ?? [])
  ])
  const evidence = manifest.evidence
    .filter(item => evidenceIds.has(item.id))
    .map(({ symbolId: _privateSymbolId, ...item }) => item)
  const { domain: _impactDomain, topics: _impactTopics, ...impact } = impactResult.slice

  return {
    ok: true,
    slice: {
      schemaVersion: manifest.schemaVersion,
      domain: manifest.domain,
      topic,
      nodes: manifest.nodes.filter(node => anchorIds.has(node.id) && node.visibility !== 'private'),
      claims,
      gaps,
      evidence,
      impact
    }
  }
}

/**
 * Виконує `n-rules docs` read-only surface.
 * @param {string[]} args аргументи після `docs`
 * @param {{ repoRoot?: string, stdout?: (line: string) => void, stderr?: (line: string) => void }} [options] testable I/O і root
 * @returns {Promise<number>} process exit code
 */
export async function runDocsCli(args, options = {}) {
  const repoRoot = options.repoRoot ?? process.cwd()
  const stdout = options.stdout ?? console.log
  const stderr = options.stderr ?? console.error
  const [command] = args

  if (command === 'domains') {
    const result = await resolveDocumentationDomains(repoRoot)
    writeJson(stdout, {
      domains: result.domains.map(domainItem => publicDomain(domainItem)),
      diagnostics: result.diagnostics
    })
    return result.diagnostics.length === 0 ? 0 : 1
  }

  if (command === 'build') {
    const domainId = flagValue(args, '--domain')
    if (!domainId) {
      writeJson(stderr, { code: 'domain-required', message: 'Потрібен --domain <id>.' })
      return 1
    }
    const unknownFlags = args.filter(argument => argument.startsWith('--') && !['--domain', '--publish'].includes(argument))
    if (unknownFlags.length > 0) {
      writeJson(stderr, { code: 'unknown-build-option', message: `Невідома build option: ${unknownFlags[0]}.` })
      return 1
    }
    const build = options.buildImpl ?? (await import('./runner.mjs')).buildPackageKnowledge
    const result = await build({ repoRoot, domainId, publish: args.includes('--publish') })
    writeJson(result.ok ? stdout : stderr, result)
    return result.ok ? 0 : 1
  }

  if (!['index', 'slice', 'validate'].includes(command)) {
    writeJson(stderr, {
      code: 'unknown-docs-command',
      message:
        'Очікується: docs domains | build --domain <id> [--publish] | index --domain <id> | slice --domain <id> --topic <id> | validate --domain <id>.'
    })
    return 1
  }

  const resolved = await resolveRequestedDomain(repoRoot, flagValue(args, '--domain'))
  if (!resolved.ok) {
    writeJson(stderr, resolved)
    return 1
  }
  const loaded = await readManifest(resolved.domain)
  if (!loaded.ok) {
    writeJson(stderr, loaded)
    return 1
  }
  const validation = await validateManifest(loaded.manifest, resolved.domain)
  if (!validation.ok) {
    writeJson(stderr, validation)
    return 1
  }

  if (command === 'validate') {
    writeJson(stdout, { ok: true, domainId: resolved.domain.id, manifest: loaded.path })
    return 0
  }
  if (command === 'index') {
    writeJson(stdout, createIndex(loaded.manifest))
    return 0
  }

  const topicId = flagValue(args, '--topic')
  if (!topicId) {
    writeJson(stderr, { code: 'topic-required', message: 'Потрібен --topic <id>.' })
    return 1
  }
  const sliced = createSlice(loaded.manifest, topicId)
  if (!sliced.ok) {
    writeJson(stderr, sliced)
    return 1
  }
  writeJson(stdout, sliced.slice)
  return 0
}

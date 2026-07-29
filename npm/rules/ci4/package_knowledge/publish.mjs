/**
 * Публікує validated package knowledge artifacts атомарною заміною docs tree.
 *
 * Staging на тому самому volume і rollback гарантують, що parser, validator
 * або protected-zone failure не залишить частково оновлену документацію.
 */

import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

import { assertProtectedZonesPreserved, parseKnowledgeZones } from './zones.mjs'

const DOCS_PREFIX = 'docs/'
const MANIFEST_PATH = 'docs/.docgen/manifest.json'
const GENERATED_PAGE_PATH =
  /^docs\/(?:index\.md|implementation-gaps\.md|explanation\/architecture\.md|explanation\/(?:capabilities|processes)\/[a-f0-9]{24}\.md|reference\/contracts\/[a-f0-9]{24}\.md)$/u

/**
 * Створює publication diagnostic.
 * @param {string} code machine code
 * @param {string} detail explanation
 * @returns {{code: string, detail: string}} diagnostic
 */
function diagnostic(code, detail) {
  return { code, detail }
}

/**
 * Перевіряє docs-relative candidate path.
 * @param {string} path candidate path
 * @returns {boolean} whether it is a safe docs-relative candidate path
 */
function isSafeDocsPath(path) {
  return (
    typeof path === 'string' &&
    path.startsWith(DOCS_PREFIX) &&
    !isAbsolute(path) &&
    !relative('docs', path).startsWith('..')
  )
}

/**
 * Підтверджує, що committed manifest належить package-knowledge projection.
 * @param {string} content committed manifest bytes
 * @returns {boolean} true лише для мінімально впізнаваного knowledge graph
 */
function isKnowledgeManifest(content) {
  try {
    const manifest = JSON.parse(content)
    return (
      manifest?.schemaVersion === 1 &&
      typeof manifest.domain?.id === 'string' &&
      Array.isArray(manifest.nodes) &&
      Array.isArray(manifest.topics)
    )
  } catch {
    return false
  }
}

/**
 * Визначає expected AUTOGEN zone ID за canonical generated page path.
 * @param {string} path docs-relative Markdown path
 * @returns {string | null} owning zone ID або null для не-package page
 */
function zoneIdForGeneratedPath(path) {
  if (path === 'docs/index.md') return 'package-index'
  if (path === 'docs/explanation/architecture.md') return 'package-architecture'
  if (path === 'docs/implementation-gaps.md') return 'implementation-gaps'
  const match = path.match(/^docs\/(?:explanation\/(capabilities|processes)|reference\/(contracts))\/([a-f0-9]{24})\.md$/u)
  if (!match) return null
  const kind = match[1] === 'capabilities' ? 'capability' : match[1] === 'processes' ? 'process' : 'contract'
  return `${kind}-${match[3]}`
}

/**
 * Збирає всі Markdown paths у docs без переходу за symlink boundaries.
 * @param {string} root absolute domain root
 * @param {string} [directory] docs-relative directory
 * @returns {Promise<string[]>} sorted docs-relative Markdown paths
 */
async function listMarkdownPaths(root, directory = 'docs') {
  const absolute = join(root, directory)
  let entries
  try {
    entries = await readdir(absolute, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
  const paths = []
  for (const entry of entries) {
    const path = `${directory}/${entry.name}`
    if (entry.isDirectory()) paths.push(...(await listMarkdownPaths(root, path)))
    else if (entry.isFile() && path.endsWith('.md')) paths.push(path)
  }
  return paths.toSorted((left, right) => left.localeCompare(right))
}

/**
 * Finds obsolete package-knowledge pages from a prior valid manifest. A page is
 * owned only when its canonical route and AUTOGEN ID agree; legacy docs remain
 * outside this set even when they live under docs/.
 * @param {{root: string, files: Record<string, string>}} input current root and candidate files
 * @returns {Promise<{ok: true, paths: string[]} | {ok: false, diagnostics: object[]}>} stale paths or migration blockers
 */
async function staleGeneratedPages({ root, files }) {
  const previousManifestPath = join(root, MANIFEST_PATH)
  if (!existsSync(previousManifestPath) || !isKnowledgeManifest(await readFile(previousManifestPath, 'utf8')))
    return { ok: true, paths: [] }
  const candidatePaths = new Set(Object.keys(files))
  const paths = []
  const diagnostics = []
  for (const path of await listMarkdownPaths(root)) {
    if (candidatePaths.has(path) || !GENERATED_PAGE_PATH.test(path)) continue
    const parsed = parseKnowledgeZones(await readFile(join(root, path), 'utf8'), path)
    if (!parsed.ok) continue
    const zoneId = zoneIdForGeneratedPath(path)
    if (!zoneId || !parsed.zones.some(zone => zone.kind === 'AUTOGEN' && zone.id === zoneId)) continue
    const protectedZones = parsed.zones.filter(zone => zone.kind === 'MANUAL' || zone.kind === 'EXPECTED')
    if (protectedZones.length > 0 || parsed.implicitManual.some(content => content !== '')) {
      diagnostics.push(
        diagnostic('stale-generated-protected', `Obsolete generated page ${path} містить authored protected content.`, path)
      )
      continue
    }
    paths.push(path)
  }
  return diagnostics.length > 0 ? { ok: false, diagnostics } : { ok: true, paths }
}

/**
 * Прибирає тимчасовий path без маскування основного publication result.
 * @param {string} path temporary path
 * @returns {Promise<boolean>} чи cleanup завершився без помилки
 */
async function bestEffortRemove(path) {
  try {
    await rm(path, { recursive: true, force: true })
    return true
  } catch {
    return false
  }
}

/* eslint-disable sonarjs/cognitive-complexity -- publication transaction keeps validation, swap and rollback in one boundary */
/**
 * Atomically publishes caller-validated docs candidates. All writes first land in a same-volume
 * staging directory; a failed validator, zone check or staging operation leaves committed docs
 * and manifest bytes untouched.
 * @param {{ domainRoot: string, files: Record<string, string>, validate: (input: { files: Record<string, string> }) => Promise<{ ok: boolean, diagnostics?: object[] }> | { ok: boolean, diagnostics?: object[] } }} input publishing request
 * @returns {Promise<{ ok: true } | { ok: false, diagnostics: object[] }>} publication result
 */
export async function publishKnowledgeArtifacts(input) {
  const root = input?.domainRoot
  if (typeof root !== 'string' || !isAbsolute(root))
    return { ok: false, diagnostics: [diagnostic('invalid-domain-root', 'domainRoot має бути absolute path.')] }
  const files = input?.files
  if (!files || typeof files !== 'object' || Array.isArray(files) || !Object.hasOwn(files, MANIFEST_PATH)) {
    return { ok: false, diagnostics: [diagnostic('missing-manifest', `Candidate має містити ${MANIFEST_PATH}.`)] }
  }
  for (const [path, content] of Object.entries(files)) {
    if (!isSafeDocsPath(path) || typeof content !== 'string')
      return { ok: false, diagnostics: [diagnostic('invalid-candidate-file', `Недійсний candidate file ${path}.`)] }
  }
  if (typeof input.validate !== 'function')
    return { ok: false, diagnostics: [diagnostic('missing-validator', 'Publication вимагає caller validation.')] }
  try {
    const validation = await input.validate({ files })
    if (!validation?.ok)
      return {
        ok: false,
        diagnostics: validation?.diagnostics ?? [
          diagnostic('caller-validation-failed', 'Caller validation не пройшла.')
        ]
      }
  } catch (error) {
    return {
      ok: false,
      diagnostics: [diagnostic('caller-validation-threw', error instanceof Error ? error.message : String(error))]
    }
  }

  const docsRoot = resolve(root, 'docs')
  for (const [path, candidate] of Object.entries(files)) {
    if (!path.endsWith('.md')) continue
    const target = resolve(root, path)
    if (!existsSync(target)) {
      const parsed = parseKnowledgeZones(candidate, path)
      if (!parsed.ok) return parsed
      continue
    }
    const previous = await readFile(target, 'utf8')
    const preserved = assertProtectedZonesPreserved(previous, candidate, path)
    if (!preserved.ok) return preserved
  }
  const stale = await staleGeneratedPages({ root, files })
  if (!stale.ok) return stale

  let stage = null
  let backup = null
  let committed = false
  try {
    stage = await mkdtemp(join(root, '.package-knowledge-stage-'))
    const stageDocs = join(stage, 'docs')
    if (existsSync(docsRoot)) await cp(docsRoot, stageDocs, { recursive: true })
    else await mkdir(stageDocs, { recursive: true })
    for (const [path, content] of Object.entries(files).toSorted(([left], [right]) => left.localeCompare(right))) {
      const target = join(stage, path)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, content, 'utf8')
    }
    for (const path of stale.paths) await rm(join(stage, path), { force: true })
    backup = await mkdtemp(join(root, '.package-knowledge-backup-'))
    await rm(backup, { recursive: true, force: true })
    if (existsSync(docsRoot)) await rename(docsRoot, backup)
    try {
      await rename(stageDocs, docsRoot)
      committed = true
    } catch (error) {
      if (existsSync(backup)) await rename(backup, docsRoot)
      throw error
    }
    if (existsSync(backup)) await bestEffortRemove(backup)
    await bestEffortRemove(stage)
    return { ok: true }
  } catch (error) {
    if (!committed && backup && existsSync(backup) && !existsSync(docsRoot)) {
      try {
        await rename(backup, docsRoot)
      } catch {
        // Original publication error remains the authoritative diagnostic.
      }
    }
    return {
      ok: false,
      diagnostics: [diagnostic('publish-failed', error instanceof Error ? error.message : String(error))]
    }
  } finally {
    if (stage) await bestEffortRemove(stage)
    if (backup && existsSync(backup)) await bestEffortRemove(backup)
  }
}
/* eslint-enable sonarjs/cognitive-complexity */

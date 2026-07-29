/**
 * Публікує validated package knowledge artifacts атомарною заміною docs tree.
 *
 * Staging на тому самому volume і rollback гарантують, що parser, validator
 * або protected-zone failure не залишить частково оновлену документацію.
 */

import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

import { assertProtectedZonesPreserved, parseKnowledgeZones } from './zones.mjs'

const DOCS_PREFIX = 'docs/'
const MANIFEST_PATH = 'docs/.docgen/manifest.json'

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

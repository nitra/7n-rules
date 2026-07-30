/**
 * Завантажує source inputs рівно одного package knowledge domain.
 *
 * Loader використовує manifest boundary та exclusions nested domains, поважає
 * gitignore і не переходить через symlinks. Він повертає stable relative paths
 * і content, придатні для deterministic candidate pipeline.
 */

import { readFile, realpath } from 'node:fs/promises'
import { extname, isAbsolute, resolve } from 'node:path'

import { globby } from 'globby'

import { isWithin, nestedDomainIgnores, toPosix } from './domain-paths.mjs'

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
const EXTENSION_RE = /^\.[a-z0-9]+$/iu
const SUPPORTED_CODE_EXTENSIONS = Object.freeze([
  '.cjs',
  '.js',
  '.jsx',
  '.mjs',
  '.php',
  '.py',
  '.rs',
  '.ts',
  '.tsx',
  '.vue'
])

/**
 * Створює blocking source diagnostic.
 * @param {string} code stable code
 * @param {string} detail user-facing detail
 * @param {string | null} [path] related path
 * @returns {{code: string, detail: string, path: string | null}} diagnostic
 */
function diagnostic(code, detail, path = null) {
  return { code, detail, path }
}

/**
 * Нормалізує owned extensions для glob.
 * @param {unknown} extensions adapter extensions
 * @returns {{ok: true, extensions: string[]} | {ok: false, diagnostics: Array<Record<string, unknown>>}} normalized extensions
 */
function normalizeExtensions(extensions) {
  if (
    !Array.isArray(extensions) ||
    extensions.length === 0 ||
    extensions.some(extension => typeof extension !== 'string' || !EXTENSION_RE.test(extension))
  ) {
    return {
      ok: false,
      diagnostics: [diagnostic('invalid-source-extensions', 'extensions має містити розширення на кшталт .mjs.')]
    }
  }
  return { ok: true, extensions: [...new Set(extensions.map(extension => extension.toLowerCase()))].toSorted() }
}

/**
 * Читає один file і повторно перевіряє realpath containment проти symlink escape.
 * @param {string} root real domain root
 * @param {string} path domain-relative path
 * @returns {Promise<{ok: true, source: {path: string, content: string}} | {ok: false, diagnostic: Record<string, unknown>}>} source або blocker
 */
async function readDomainSource(root, path) {
  const absolute = resolve(root, path)
  try {
    const real = await realpath(absolute)
    if (!isWithin(root, real)) {
      return {
        ok: false,
        diagnostic: diagnostic('source-outside-domain', `Source ${path} виходить за domain boundary.`, path)
      }
    }
    return { ok: true, source: { path: toPosix(path), content: await readFile(real, 'utf8') } }
  } catch (error) {
    return {
      ok: false,
      diagnostic: diagnostic(
        'source-read-failed',
        error instanceof Error ? error.message : String(error),
        toPosix(path)
      )
    }
  }
}

/**
 * Виявляє наявні підтримувані code extensions без залежності від встановлених adapters.
 *
 * Кожен recognized file перечитується через той самий containment gate, тому race,
 * unreadable file або symlink escape блокує вибір adapter-ів до candidate pipeline.
 * @param {{domain: Record<string, unknown>}} input resolved domain
 * @returns {Promise<{ok: true, extensions: string[]} | {ok: false, diagnostics: Array<Record<string, unknown>>}>} present extensions або blockers
 */
export async function discoverDomainCodeExtensions({ domain }) {
  if (!domain || typeof domain.root !== 'string' || !isAbsolute(domain.root)) {
    return {
      ok: false,
      diagnostics: [diagnostic('invalid-domain-root', 'Resolved domain мусить мати absolute root.')]
    }
  }
  let root
  try {
    root = await realpath(domain.root)
  } catch (error) {
    return {
      ok: false,
      diagnostics: [
        diagnostic('domain-root-unavailable', error instanceof Error ? error.message : String(error), domain.root)
      ]
    }
  }
  const paths = await globby(
    SUPPORTED_CODE_EXTENSIONS.map(extension => `**/*${extension}`),
    {
      cwd: root,
      onlyFiles: true,
      gitignore: true,
      followSymbolicLinks: false,
      ignore: [...DEFAULT_IGNORES, ...nestedDomainIgnores(domain)]
    }
  )
  const results = await Promise.all(paths.toSorted().map(path => readDomainSource(root, path)))
  const diagnostics = results.filter(result => !result.ok).map(result => result.diagnostic)
  if (diagnostics.length > 0) return { ok: false, diagnostics }
  return {
    ok: true,
    extensions: [...new Set(results.map(result => extname(result.source.path).toLowerCase()))].toSorted()
  }
}

/**
 * Завантажує всі source files одного domain без source nested packages.
 * @param {{domain: Record<string, unknown>, extensions: string[]}} input resolved domain та adapter extensions
 * @returns {Promise<{ok: true, sources: Array<{path: string, content: string}>} | {ok: false, diagnostics: Array<Record<string, unknown>>}>} stable sources або blockers
 */
export async function loadDomainSources({ domain, extensions }) {
  if (!domain || typeof domain.root !== 'string' || !isAbsolute(domain.root)) {
    return {
      ok: false,
      diagnostics: [diagnostic('invalid-domain-root', 'Resolved domain мусить мати absolute root.')]
    }
  }
  const normalized = normalizeExtensions(extensions)
  if (!normalized.ok) return normalized

  let root
  try {
    root = await realpath(domain.root)
  } catch (error) {
    return {
      ok: false,
      diagnostics: [
        diagnostic('domain-root-unavailable', error instanceof Error ? error.message : String(error), domain.root)
      ]
    }
  }
  const patterns = normalized.extensions.map(extension => `**/*${extension}`)
  const paths = await globby(patterns, {
    cwd: root,
    onlyFiles: true,
    gitignore: true,
    followSymbolicLinks: false,
    ignore: [...DEFAULT_IGNORES, ...nestedDomainIgnores(domain)]
  })
  const results = await Promise.all(paths.toSorted().map(path => readDomainSource(root, path)))
  const diagnostics = results.filter(result => !result.ok).map(result => result.diagnostic)
  if (diagnostics.length > 0) return { ok: false, diagnostics }
  return { ok: true, sources: results.map(result => result.source) }
}

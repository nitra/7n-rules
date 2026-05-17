/**
 * Reads template/ for a concern directory and returns a merged structure indexed
 * by target basename. For each <target>, returns whichever of snippet/deny/contains
 * exist (parsed in native format by extension).
 *
 * @param {string} concernDir absolute path to fix/<concern>/ or policy/<concern>/
 * @returns {Promise<Record<string, { snippet?: any, deny?: any, contains?: any }>>}
 */
import { existsSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'

import { parse as parseToml } from 'smol-toml'

const SLOTS = ['snippet', 'deny', 'contains']

/** Parse file contents by extension; returns JS object for structured formats, string for text. */
async function parseByExt(path) {
  const raw = await readFile(path, 'utf8')
  const ext = extname(path).toLowerCase()
  if (ext === '.json' || ext === '.jsonc') return JSON.parse(stripJsonComments(raw))
  if (ext === '.toml') return parseToml(raw)
  if (ext === '.yml' || ext === '.yaml') {
    const { parse: parseYaml } = await import('yaml')
    return parseYaml(raw)
  }
  return raw // text-only
}

function stripJsonComments(s) {
  // Minimal: strip // line comments and /* */ block comments. JSON-with-comments format.
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

async function walk(dir, base = dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await walk(full, base)))
    else out.push(relative(base, full))
  }
  return out
}

/**
 * Parse "<target>.<slot>.<ext>" or "<target>" (text-only).
 * Returns { target, slot } where slot is one of snippet|deny|contains|null (null = text-only target).
 */
function classifyTemplateFile(relPath) {
  // Try ".<slot>." suffix detection
  for (const slot of SLOTS) {
    const m = relPath.match(new RegExp(`^(?<target>.+)\\.${slot}\\.[^.]+$`))
    if (m?.groups?.target) return { target: m.groups.target, slot }
  }
  // No slot suffix → text-only canon for the literal target name
  return { target: relPath, slot: null }
}

function formatPath(parts) {
  return parts
    .map(p => (typeof p === 'number' ? `[${p}]` : /^[a-zA-Z_$][\w$]*$/.test(p) ? p : JSON.stringify(p)))
    .reduce((acc, p) => (acc === '' ? p : p.startsWith('[') ? acc + p : acc + '.' + p), '')
}

function quote(v) {
  return typeof v === 'string' ? JSON.stringify(v) : String(v)
}

/**
 * Deep subset-of check. Every leaf in `snippet` must equal same path in `actual`.
 * Arrays in snippet: every element must be present in actual array.
 * Returns array of violation messages.
 */
export function checkSnippet(actual, snippet, opts, path = []) {
  if (snippet == null) return []
  const { targetPath, source } = opts
  const violations = []
  if (Array.isArray(snippet)) {
    if (!Array.isArray(actual)) {
      violations.push(`${targetPath}: ${formatPath(path)} має бути масивом (${source})`)
      return violations
    }
    for (const needle of snippet) {
      const found = actual.some(a => JSON.stringify(a) === JSON.stringify(needle))
      if (!found) {
        violations.push(`${targetPath}: ${formatPath(path)} має містити ${quote(needle)} (${source})`)
      }
    }
    return violations
  }
  if (snippet !== null && typeof snippet === 'object') {
    if (actual == null || typeof actual !== 'object' || Array.isArray(actual)) {
      violations.push(`${targetPath}: ${formatPath(path)} має бути об'єктом (${source})`)
      return violations
    }
    for (const [k, v] of Object.entries(snippet)) {
      violations.push(...checkSnippet(actual[k], v, opts, [...path, k]))
    }
    return violations
  }
  // Leaf (string/number/boolean)
  if (actual !== snippet) {
    violations.push(`${targetPath}: ${formatPath(path)} має бути ${quote(snippet)} (${source})`)
  }
  return violations
}

/**
 * Walks deny tree; for any leaf path that exists in actual, returns violation
 * with the deny's leaf string as reason.
 */
export function checkDeny(actual, deny, opts, path = []) {
  if (deny == null) return []
  const { targetPath, source } = opts
  if (deny !== null && typeof deny === 'object' && !Array.isArray(deny)) {
    const out = []
    for (const [k, v] of Object.entries(deny)) {
      const childActual = actual && typeof actual === 'object' ? actual[k] : undefined
      out.push(...checkDeny(childActual, v, opts, [...path, k]))
    }
    return out
  }
  // Leaf reached — if actual has this path at all (any value), it's a violation
  if (actual !== undefined) {
    const reason = typeof deny === 'string' ? deny : 'заборонено'
    return [`${targetPath}: ${formatPath(path)} — ${reason} (${source})`]
  }
  return []
}

export async function loadTemplate(concernDir) {
  const tplDir = join(concernDir, 'template')
  if (!existsSync(tplDir)) return {}
  if (!(await stat(tplDir)).isDirectory()) return {}
  const files = await walk(tplDir)
  const result = {}
  for (const rel of files) {
    const { target, slot } = classifyTemplateFile(rel)
    if (!result[target]) result[target] = {}
    const value = await parseByExt(join(tplDir, rel))
    if (slot === null) result[target].snippet = value // text-only treated as snippet
    else result[target][slot] = value
  }
  return result
}

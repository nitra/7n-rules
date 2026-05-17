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

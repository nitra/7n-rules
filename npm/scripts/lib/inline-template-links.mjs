import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'

const MD_LINK_RE = /\[([^\]]{1,200})\]\((\.\/[^)]{1,500})\)/g
const TEMPLATE_SEGMENT_RE = /\/templates?\//
/** Статичні regexp-літерали `^(.+)\.<slot>\.<ext>$` — без `RegExp(variable)`. */
const SLOT_SUFFIX_RES = [/^(.+)\.snippet\.[^.]+$/, /^(.+)\.deny\.[^.]+$/, /^(.+)\.contains\.[^.]+$/]

/**
 * @param {string} filePath шлях до файлу
 * @returns {string} назва мови для fenced-блока
 */
function langFromExt(filePath) {
  const ext = extname(filePath)
  if (ext === '.json') return 'json'
  if (ext === '.toml') return 'toml'
  if (ext === '.yml' || ext === '.yaml') return 'yaml'
  return ''
}

// Strip `.<slot>.<ext>` suffix (slot ∈ snippet/deny/contains) to recover the
// real target file name (e.g. `package.json.snippet.json` → `package.json`).
/**
 * @param {string} fileBasename базове ім'я template-файлу
 * @returns {string} ім'я реального target-файлу
 */
function normalizeTargetName(fileBasename) {
  for (const re of SLOT_SUFFIX_RES) {
    const m = fileBasename.match(re)
    if (m) return m[1]
  }
  return fileBasename
}

/**
 * Finds markdown links whose path contains /template/ and replaces them with
 * inline fenced blocks. Reads file from join(ruleDir, rel-path).
 * Throws Error if a matched link target doesn't exist (fail loud — user must know).
 * @param {string} text .mdc file contents
 * @param {string} ruleDir absolute path to the rule directory (e.g. .../npm/rules/security/)
 * @returns {Promise<string>} transformed text
 */
export async function inlineTemplateLinks(text, ruleDir) {
  const matches = [...text.matchAll(MD_LINK_RE)].filter(m => TEMPLATE_SEGMENT_RE.test(m[2]))
  if (matches.length === 0) return text

  let result = text
  for (const match of matches) {
    const [fullMatch, , href] = match
    // href starts with ./ (regex) and contains /template/ (filter above)
    const relPath = href.slice(2) // strip leading ./
    const absPath = join(ruleDir, relPath)

    if (!existsSync(absPath)) {
      throw new Error(`inlineTemplateLinks: file not found: ${absPath} (referenced from .mdc)`)
    }

    const raw = await readFile(absPath, 'utf8')
    const contents = raw.trim()
    const lang = langFromExt(absPath)
    const targetName = normalizeTargetName(basename(absPath))
    const replacement = `\`${targetName}\`:\n\n\`\`\`${lang}\n${contents}\n\`\`\``
    result = result.replace(fullMatch, () => replacement)
  }

  return result
}

/**
 * Appends all *.mdc files auto-discovered in js/ and policy/<concern>/ subdirectories.
 * js/ direct files come first (alphabetically), then policy concern directories
 * (alphabetically by concern name, then by file name within each concern).
 * @param {string} text rule content (after inlineTemplateLinks)
 * @param {string} ruleDir absolute path to the rule directory
 * @returns {Promise<string>} text with discovered concern docs appended
 */
export async function appendDiscoveredMdcFiles(text, ruleDir) {
  const sections = []

  const jsDir = join(ruleDir, 'js')
  if (existsSync(jsDir)) {
    const entries = await readdir(jsDir, { withFileTypes: true })
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.isFile() && e.name.endsWith('.mdc')) {
        sections.push((await readFile(join(jsDir, e.name), 'utf8')).trim())
      }
    }
  }

  const policyDir = join(ruleDir, 'policy')
  if (existsSync(policyDir)) {
    const concerns = (await readdir(policyDir, { withFileTypes: true }))
      .filter(e => e.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name))
    for (const concern of concerns) {
      const concernDir = join(policyDir, concern.name)
      const files = (await readdir(concernDir, { withFileTypes: true }))
        .filter(e => e.isFile() && e.name.endsWith('.mdc'))
        .sort((a, b) => a.name.localeCompare(b.name))
      for (const f of files) {
        sections.push((await readFile(join(concernDir, f.name), 'utf8')).trim())
      }
    }
  }

  if (sections.length === 0) return text
  return text.trimEnd() + '\n\n' + sections.join('\n\n') + '\n'
}

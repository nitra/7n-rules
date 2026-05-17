import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'

const TEMPLATE_LINK_RE = /\[([^\]]+)\]\((\.\/[^)]*\/template\/[^)]+)\)/g

function langFromExt(filePath) {
  const ext = extname(filePath)
  if (ext === '.json') return 'json'
  if (ext === '.toml') return 'toml'
  if (ext === '.yml' || ext === '.yaml') return 'yaml'
  return ''
}

/**
 * Finds markdown links whose path contains /template/ and replaces them with
 * inline fenced blocks. Reads file from join(ruleDir, rel-path).
 * Throws Error if a matched link target doesn't exist (fail loud — user must know).
 *
 * @param {string} text .mdc file contents
 * @param {string} ruleDir absolute path to the rule directory (e.g. .../npm/rules/security/)
 * @returns {Promise<string>} transformed text
 */
export async function inlineTemplateLinks(text, ruleDir) {
  const matches = [...text.matchAll(TEMPLATE_LINK_RE)]
  if (matches.length === 0) return text

  let result = text
  for (const match of matches) {
    const [fullMatch, label, href] = match
    // href starts with ./ and contains /template/ — already guaranteed by regex
    const relPath = href.slice(2) // strip leading ./
    const absPath = join(ruleDir, relPath)

    if (!existsSync(absPath)) {
      throw new Error(`inlineTemplateLinks: file not found: ${absPath} (referenced from .mdc)`)
    }

    const contents = (await readFile(absPath, 'utf8')).trim()
    const lang = langFromExt(absPath)
    const replacement = `\`${label}\`:\n\n\`\`\`${lang}\n${contents}\n\`\`\``
    result = result.replace(fullMatch, () => replacement)
  }

  return result
}

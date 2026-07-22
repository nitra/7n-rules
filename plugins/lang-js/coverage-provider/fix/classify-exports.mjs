/**
 * Classifies named exports of a JS/MJS source file by test-generation complexity.
 * Used to route: trivial/simple → local LLM, complex → cloud LLM.
 */

const EXPORT_RE = /^export\s+(?:async\s+)?(?:const|function|class|let)\s+(\w+)/gm
const PRIMITIVE_LITERAL_RE = /^(?:\d[\d_]*(?:\.\d+)?|'[^']*'|"[^"]*"|true|false|null)\s*$/
const NEXT_EXPORT_RE = /\nexport\s/m

/**
 * Patterns that flag an export as too complex for local model.
 * Matched against the export's extracted body (up to 3000 chars).
 */
const COMPLEX_SIGNALS = [
  /\bfetch\b/,
  /\bnew\s+Date\b/,
  /\bprocess\.env\b/,
  /\benv\.[A-Z_]{2,}/,
  /\bFormData\b/,
  /\bcheckEnv\b/,
  /\bXMLHttpRequest\b/,
  /\bWebSocket\b/,
  /\bsetTimeout\b|\bsetInterval\b/
]

/**
 * @typedef {'trivial'|'simple'|'complex'} ExportComplexity
 * @typedef {{ name: string, complexity: ExportComplexity }} ExportInfo
 */

/**
 * Extracts all named exports and classifies each by test complexity.
 * @param {string} content source file text
 * @returns {ExportInfo[]} named exports with complexity labels
 */
export function extractExportsWithComplexity(content) {
  const names = Array.from(content.matchAll(EXPORT_RE), m => m[1])
  return names.map(name => ({ name, complexity: classifyExport(name, content) }))
}

/**
 * Classifies one export by inspecting the code region that defines it.
 * @param {string} name export name
 * @param {string} content source file text
 * @returns {ExportComplexity} complexity label
 */
function classifyExport(name, content) {
  if (isPrimitiveConstExport(name, content)) return 'trivial'

  const body = extractBody(name, content)
  if (!body) return 'simple'
  if (COMPLEX_SIGNALS.some(re => re.test(body))) return 'complex'
  return 'simple'
}

/**
 * Checks whether the export is a primitive `export const NAME = <literal>`.
 * @param {string} name export name
 * @param {string} content source file text
 * @returns {boolean} true when the export is a primitive constant
 */
function isPrimitiveConstExport(name, content) {
  const prefix = `export const ${name} =`
  for (const line of content.split('\n')) {
    if (!line.startsWith(prefix)) continue
    return PRIMITIVE_LITERAL_RE.test(line.slice(prefix.length).trim())
  }
  return false
}

/**
 * Finds the declaration start for a named export.
 * @param {string} name export name
 * @param {string} content source file text
 * @returns {number} start index or `-1`
 */
function findExportStart(name, content) {
  const prefixes = [
    `export async function ${name}`,
    `export function ${name}`,
    `export const ${name}`,
    `export class ${name}`,
    `export let ${name}`
  ]
  let start = -1
  for (const prefix of prefixes) {
    const idx = content.indexOf(prefix)
    if (idx !== -1 && (start === -1 || idx < start)) start = idx
  }
  return start
}

/**
 * Extracts the code region from the export declaration to the next export.
 * Used for complexity signal matching only — not exact AST.
 * @param {string} name export name
 * @param {string} content source file text
 * @returns {string|null} declaration snippet or `null`
 */
function extractBody(name, content) {
  const start = findExportStart(name, content)
  if (start === -1) return null

  const after = content.slice(start)
  const nextExport = after.search(NEXT_EXPORT_RE)
  const end = nextExport === -1 ? Math.min(after.length, 3000) : nextExport
  return after.slice(0, end)
}

/**
 * Витягує Python module/class/function docstring-и для дослівної doc-files-документації.
 * Завдяки цьому повністю прокоментований Python-файл не потребує LLM-генерації.
 * @see ./docs/extractors.md
 */

/** Top-level public class/function. */
const PUBLIC_DEF_RE = /^(?:async\s+)?(def|class)\s+([A-Za-z]\w*)/
const DOCSTRING_START_RE = /^\s*(?:[bB]?[fF]?[rR]?[uU]?)("""|''')/
const HEADER_SKIP_RE = /^(?:#!|#|\s*$|from\s+__future__\s+import\s+)/
const WRITE_RE = /\b(?:open\([^)]*,\s*['"][wa+]|Path\([^)]*\)\.(?:write_text|write_bytes)|os\.(?:remove|unlink|mkdir)|shutil\.)/
const NETWORK_RE = /\b(?:requests|httpx|aiohttp|urllib|socket)\b/i
const CACHE_RE = /\b(?:cache|cached|lru_cache|memoize)\b/i

/**
 * Нормалізує авторський docstring для Markdown, зберігаючи текст і абзаци.
 * @param {string[]} lines рядки між потрійними лапками
 * @returns {string} текст без спільного відступу
 */
function cleanDocstring(lines) {
  return lines
    .map(line => line.trim())
    .join('\n')
    .trim()
}

/**
 * Читає docstring, що починається на заданому рядку.
 * @param {string[]} lines рядки Python-файлу
 * @param {number} start індекс першого рядка docstring
 * @returns {{ text:string, end:number }|null} текст і рядок закриття
 */
function readDocstring(lines, start) {
  const first = lines[start]
  const match = first.match(DOCSTRING_START_RE)
  if (!match) return null
  const quote = match[1]
  const tail = first.slice(first.indexOf(quote) + quote.length)
  const sameLineEnd = tail.indexOf(quote)
  if (sameLineEnd !== -1) return { text: tail.slice(0, sameLineEnd).trim(), end: start }
  const body = tail.trim() ? [tail] : []
  for (let i = start + 1; i < lines.length; i++) {
    const end = lines[i].indexOf(quote)
    if (end !== -1) {
      body.push(lines[i].slice(0, end))
      return { text: cleanDocstring(body), end: i }
    }
    body.push(lines[i])
  }
  return null
}

/**
 * Індекс рядка з кінцевим `:` заголовка class/function.
 * @param {string[]} lines рядки Python-файлу
 * @param {number} start початок декларації
 * @returns {number} індекс кінця заголовка або -1
 */
function headerEndLine(lines, start) {
  for (let i = start; i < Math.min(start + 20, lines.length); i++) {
    if (lines[i].split('#', 1)[0].trimEnd().endsWith(':')) return i
  }
  return -1
}

/**
 * Перший docstring після header class/function.
 * @param {string[]} lines рядки Python-файлу
 * @param {number} headerEnd індекс кінця заголовка
 * @returns {string} авторський опис або порожній рядок
 */
function docstringAfterHeader(lines, headerEnd) {
  for (let i = headerEnd + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue
    return readDocstring(lines, i)?.text ?? ''
  }
  return ''
}

/**
 * Module docstring: перший значущий рядок, як у python/doc_comments rule.
 * @param {string[]} lines рядки Python-файлу
 * @returns {string} авторський опис модуля або порожній рядок
 */
function moduleDocstring(lines) {
  for (let i = 0; i < lines.length; i++) {
    if (HEADER_SKIP_RE.test(lines[i])) continue
    return readDocstring(lines, i)?.text ?? ''
  }
  return ''
}

/**
 * Витягує top-level public class/function та їхні docstring-и.
 * @param {string[]} lines рядки Python-файлу
 * @returns {Array<{name:string,kind:string,desc:string}>} public API
 */
function collectExports(lines) {
  const exports = []
  for (const [line, text] of lines.entries()) {
    const match = text.match(PUBLIC_DEF_RE)
    if (!match) continue
    const headerEnd = headerEndLine(lines, line)
    exports.push({ name: match[2], kind: match[1], desc: headerEnd === -1 ? '' : docstringAfterHeader(lines, headerEnd) })
  }
  return exports
}

/**
 * Витягує факт-лист Python без AST-залежності: module/class/function docstring-и
 * стають авторитетними полями `header` та `exports` для zero-LLM doc-files.
 * @param {string} src вміст Python-файлу
 * @param {string} relPath відносний шлях
 * @returns {object} факт-лист для doc-files
 */
export function extractFactsPython(src, relPath) {
  const lines = src.split('\n')
  const exports = collectExports(lines)
  const imports = Array.from(src.matchAll(/^(?:from\s+([\w.]+)|import\s+([\w.]+))/gm), match => match[1] ?? match[2])
  return {
    relPath,
    lang: 'py',
    header: moduleDocstring(lines),
    exports,
    imports: { stdlib: [], external: imports, internal: [] },
    internalSymbols: [],
    localSymbols: [],
    markers: {
      readOnly: !WRITE_RE.test(src),
      catchesErrors: /\bexcept\b/.test(src),
      returnsFalsyOnFail: /\bexcept\b[\s\S]{0,400}?\breturn\s+(?:None|False|['"]{2})/.test(src),
      network: NETWORK_RE.test(src),
      caches: CACHE_RE.test(src),
      skips: []
    }
  }
}

/** Handler extension-point `doc-files` для Python. */
const pythonDocFilesExtractor = {
  id: 'python',
  extensions: ['.py'],
  extractFacts: extractFactsPython
}

/**
 * Експортує Python extractor як default extension-point для doc-files.
 */
export default pythonDocFilesExtractor

/** @see ./docs/docgen-extract.md */

import { isRunAsCli } from '../../../scripts/cli-entry.mjs'
import { readFileSync } from 'node:fs'

const BUILTIN_MODULES = new Set([
  'fs',
  'path',
  'crypto',
  'os',
  'util',
  'stream',
  'events',
  'http',
  'https',
  'url',
  'child_process',
  'process',
  'assert',
  'buffer',
  'zlib',
  'readline'
])

const JSDOC_OPEN_RE = /^\s*\/\*\*?/
const JSDOC_CLOSE_RE = /\*\/\s*$/
const STAR_PREFIX_RE = /^\s*\*?\s?/
const PARAM_LINE_RE = /^@param[ \t]{1,8}(?:\{[^}]{0,200}\}[ \t]{1,8})?\[?([\w.]{1,80})\]?[ \t]{0,8}(.{0,400})$/
const RETURNS_LINE_RE = /^@returns?[ \t]{1,8}(?:\{[^}]{0,200}\}[ \t]{1,8})?(.{0,400})$/
const FILE_HEADER_RE = /^\s*\/\*\*([\s\S]*?)\*\//
const PRECEDING_JSDOC_RE = /\/\*\*(?:(?!\*\/)[\s\S])*\*\/\s*$/
const EXPORT_DECL_RE = /export\s+(?:async\s+)?(function|const|class)\s+(\w+)/g
const IMPORT_FROM_RE = /^import[ \t]{1,8}[\s\S]{0,300}?from\s{1,8}['"]([^'"]+)['"]/gm
const NODE_PREFIX_RE = /^node:/
const INTERNAL_IMPORT_RE = /import[ \t]{1,8}([^'"]{0,300}?)from[ \t]{1,8}['"]\.[^'"]{1,300}['"]/g
const NAMED_BRACES_RE = /\{([^}]{1,400})\}/
const IDENT_RE = /^[\w$]{1,80}$/
const IMPORT_AS_RE = /[ \t]{1,8}as[ \t]{1,8}.{0,200}/
const WRITE_FS_RE = /\b(writeFile|mkdir|rmdir|unlink|appendFile|createWriteStream|rm\()/
const CATCH_RE = /catch\s*\(/
const TRY_RE = /\btry\s*\{/
const FALSY_RETURN_RE = /return\s+(false|null|''|"")/
const NETWORK_RE = /\bfetch\(|https?\.|axios|got\(/
const CACHE_RE = /new Map\(\)|Cache|cache/

/**
 * Прибирає `/** *​/`-обрамлення й `*`-префікси, повертає чистий текст рядками.
 * @param {string} raw сирий JSDoc-блок з обрамленням
 * @returns {string} очищений текст без обрамлення й префіксів
 */
function cleanJsDoc(raw) {
  return raw
    .replace(JSDOC_OPEN_RE, '')
    .replace(JSDOC_CLOSE_RE, '')
    .split('\n')
    .map(l => l.replace(STAR_PREFIX_RE, '').trimEnd())
    .join('\n')
    .trim()
}

/**
 * Опис (без @-тегів) + параметри з @param як «name — опис».
 * @param {string} raw сирий JSDoc-блок
 * @returns {{desc:string, params:Array<{name:string, desc:string}>, ret:string}} розпарсений опис, параметри й опис повернення
 */
function parseJsDoc(raw) {
  const text = cleanJsDoc(raw)
  const lines = text.split('\n')
  const descLines = []
  const params = []
  let ret = ''
  for (const l of lines) {
    const pm = l.match(PARAM_LINE_RE)
    const rm = l.match(RETURNS_LINE_RE)
    if (pm) {
      const desc = pm[2].trim()
      // «опис.» — JSDoc-заглушка без сенсу; не тягнемо її як факт
      params.push({ name: pm[1], desc: desc === 'опис.' ? '' : desc })
      continue
    }
    if (rm) {
      ret = rm[1].trim()
      continue
    }
    if (l.startsWith('@')) continue
    descLines.push(l)
  }
  return { desc: descLines.join('\n').trim(), params, ret }
}

/**
 * Провідний блок-коментар файлу (намір), якщо він перед першим import/кодом.
 * @param {string} src вміст файлу
 * @returns {string} текст header-коментаря або порожній рядок
 */
function extractFileHeader(src) {
  const m = src.match(FILE_HEADER_RE)
  if (!m) return ''
  // має бути на самому початку (до import/код)
  if (src.slice(0, m.index).trim() !== '') return ''
  return parseJsDoc(m[0]).desc
}

/**
 * Блок-коментар, що стоїть ВПРИТУЛ перед позицією (лише пробіли між ними).
 * `(?:(?!\*​/)[\s\S])*` гарантує, що тіло не містить `*​/`, тож захоплюється рівно один
 * найближчий блок — без жадібного «перестрибування» через імпорти/код.
 * @param {string} prefix вміст файлу до позиції експорту
 * @returns {string|null} JSDoc-блок або null якщо немає
 */
function precedingJsDoc(prefix) {
  const m = prefix.match(PRECEDING_JSDOC_RE)
  return m ? m[0] : null
}

/**
 * Експорти + JSDoc, що безпосередньо передує кожному.
 * @param {string} src вміст файлу
 * @returns {Array<object>} список експортів із метаданими
 */
function extractExports(src) {
  const out = []
  for (const m of src.matchAll(EXPORT_DECL_RE)) {
    const [, kind, name] = m
    const jsdocRaw = precedingJsDoc(src.slice(0, m.index))
    out.push({ name, kind, ...(jsdocRaw ? parseJsDoc(jsdocRaw) : { desc: '', params: [], ret: '' }) })
  }
  return out
}

/**
 * Імпорти, класифіковані на stdlib / npm / internal.
 * @param {string} src вміст файлу
 * @returns {{stdlib:Array<string>, npm:Array<string>, internal:Array<string>}} розкласифіковані шляхи імпортів
 */
function extractImports(src) {
  const internal = new Set(),
    npm = new Set(),
    stdlib = new Set()
  for (const m of src.matchAll(IMPORT_FROM_RE)) {
    const s = m[1]
    if (s.startsWith('node:') || BUILTIN_MODULES.has(s.split('/')[0])) stdlib.add(s.replace(NODE_PREFIX_RE, ''))
    else if (s.startsWith('.') || s.startsWith('/')) internal.add(s)
    else npm.add(s)
  }
  return { stdlib: [...stdlib], npm: [...npm], internal: [...internal] }
}

/**
 * Імена символів, імпортованих із внутрішніх модулів — їх модель не має згадувати.
 * @param {string} src вміст файлу
 * @returns {Array<string>} список імен внутрішніх символів
 */
function extractInternalSymbols(src) {
  const out = new Set()
  for (const m of src.matchAll(INTERNAL_IMPORT_RE)) {
    const clause = m[1]
    const named = clause.match(NAMED_BRACES_RE)
    if (named) {
      for (const n of named[1].split(',')) {
        const name = n.replace(IMPORT_AS_RE, '').trim()
        if (name) out.add(name)
      }
    }
    const defName = clause.replace(NAMED_BRACES_RE, '').replaceAll(',', ' ').trim().split(' ')[0]
    if (defName && IDENT_RE.test(defName)) out.add(defName)
  }
  return [...out]
}

/**
 * Поведінкові маркери — евристики регулярками.
 * @param {string} src вміст файлу
 * @returns {object} набір прапорців-евристик
 */
function extractMarkers(src) {
  // помітні «пропуски»: dir/segment-літерали у фільтрах
  const skips = new Set()
  for (const lit of ['.github', '.git', 'node_modules', 'base/', 'ua/', '.firebase']) {
    if (src.includes(`'${lit}`) || src.includes(`"${lit}`) || src.includes(`/${lit}`)) skips.add(lit)
  }
  return {
    readOnly: !WRITE_FS_RE.test(src),
    catchesErrors: CATCH_RE.test(src) || TRY_RE.test(src),
    returnsFalsyOnFail: FALSY_RETURN_RE.test(src),
    network: NETWORK_RE.test(src),
    caches: CACHE_RE.test(src),
    skips: [...skips]
  }
}

/**
 * Головний екстрактор: код файлу → факт-лист.
 * @param {string} src вміст файлу
 * @param {string} relPath шлях (для контексту/мови екстрактора)
 * @returns {{relPath:string, lang:string, header:string, exports:Array, imports:object, markers:object}} структура фактів про файл
 */
export function extractFacts(src, relPath) {
  const lang = relPath.split('.').pop()
  if (!['js', 'mjs', 'ts'].includes(lang)) {
    return { relPath, lang, unsupported: true, header: '', exports: [], imports: {}, markers: {} }
  }
  return {
    relPath,
    lang,
    header: extractFileHeader(src),
    exports: extractExports(src),
    imports: extractImports(src),
    internalSymbols: extractInternalSymbols(src),
    markers: extractMarkers(src)
  }
}

// CLI для інспекції: node docgen-extract.mjs <file>
if (isRunAsCli(import.meta.url)) {
  const file = process.argv[2]
  if (!file) {
    throw new Error('Usage: node docgen-extract.mjs <file>')
  }
  const facts = extractFacts(readFileSync(file, 'utf8'), file)
  console.log(JSON.stringify(facts, null, 2))
}

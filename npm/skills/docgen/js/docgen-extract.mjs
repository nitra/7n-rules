/** @see ./docs/docgen-extract.md */

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

/** Прибирає `/** *​/`-обрамлення й `*`-префікси, повертає чистий текст рядками. */
function cleanJsDoc(raw) {
  return raw
    .replace(/^\s*\/\*\*?/, '')
    .replace(/\*\/\s*$/, '')
    .split('\n')
    .map(l => l.replace(/^\s*\*?\s?/, '').trimEnd())
    .join('\n')
    .trim()
}

/** Опис (без @-тегів) + параметри з @param як «name — опис». */
function parseJsDoc(raw) {
  const text = cleanJsDoc(raw)
  const lines = text.split('\n')
  const descLines = []
  const params = []
  let ret = ''
  for (const l of lines) {
    const pm = l.match(/^@param\s+(?:\{[^}]*\}\s+)?\[?([A-Za-z0-9_.]+)\]?\s*(.*)$/)
    const rm = l.match(/^@returns?\s+(?:\{[^}]*\}\s+)?(.*)$/)
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

/** Провідний блок-коментар файлу (намір), якщо він перед першим import/кодом. */
function extractFileHeader(src) {
  const m = src.match(/^\s*\/\*\*([\s\S]*?)\*\//)
  if (!m) return ''
  // має бути на самому початку (до import/код)
  if (src.slice(0, m.index).trim() !== '') return ''
  return parseJsDoc(m[0]).desc
}

/**
 * Блок-коментар, що стоїть ВПРИТУЛ перед позицією (лише пробіли між ними).
 * `(?:(?!\*​/)[\s\S])*` гарантує, що тіло не містить `*​/`, тож захоплюється рівно один
 * найближчий блок — без жадібного «перестрибування» через імпорти/код.
 */
function precedingJsDoc(prefix) {
  const m = prefix.match(/\/\*\*(?:(?!\*\/)[\s\S])*\*\/\s*$/)
  return m ? m[0] : null
}

/** Експорти + JSDoc, що безпосередньо передує кожному. */
function extractExports(src) {
  const out = []
  const re = /export\s+(?:async\s+)?(function|const|class)\s+([A-Za-z0-9_]+)/g
  let m
  while ((m = re.exec(src))) {
    const [, kind, name] = m
    const jsdocRaw = precedingJsDoc(src.slice(0, m.index))
    out.push({ name, kind, ...(jsdocRaw ? parseJsDoc(jsdocRaw) : { desc: '', params: [], ret: '' }) })
  }
  return out
}

/** Імпорти, класифіковані на stdlib / npm / internal. */
function extractImports(src) {
  const stdlib = new Set(),
    npm = new Set(),
    internal = new Set()
  const re = /^import\s+[\s\S]*?from\s+['"]([^'"]+)['"]/gm
  let m
  while ((m = re.exec(src))) {
    const s = m[1]
    if (s.startsWith('node:') || BUILTIN_MODULES.has(s.split('/')[0])) stdlib.add(s.replace(/^node:/, ''))
    else if (s.startsWith('.') || s.startsWith('/')) internal.add(s)
    else npm.add(s)
  }
  return { stdlib: [...stdlib], npm: [...npm], internal: [...internal] }
}

/** Імена символів, імпортованих із внутрішніх модулів — їх модель не має згадувати. */
function extractInternalSymbols(src) {
  const out = new Set()
  const re = /import\s+(?:([A-Za-z0-9_$]+)\s*,?\s*)?(?:\{([^}]+)\})?\s+from\s+['"](\.[^'"]+)['"]/g
  let m
  while ((m = re.exec(src))) {
    if (m[1]) out.add(m[1].trim())
    if (m[2])
      for (const n of m[2].split(',')) {
        const name = n.replace(/\s+as\s+.*/, '').trim()
        if (name) out.add(name)
      }
  }
  return [...out]
}

/** Поведінкові маркери — евристики регулярками. */
function extractMarkers(src) {
  // помітні «пропуски»: dir/segment-літерали у фільтрах
  const skips = new Set()
  for (const lit of ['.github', '.git', 'node_modules', 'base/', 'ua/', '.firebase']) {
    if (src.includes(`'${lit}`) || src.includes(`"${lit}`) || src.includes(`/${lit}`)) skips.add(lit)
  }
  return {
    readOnly: !/\b(writeFile|mkdir|rmdir|unlink|appendFile|createWriteStream|rm\()/.test(src),
    catchesErrors: /catch\s*\(/.test(src) || /\btry\s*\{/.test(src),
    returnsFalsyOnFail: /return\s+(false|null|''|"")/.test(src),
    network: /\bfetch\(|https?\.|axios|got\(/.test(src),
    caches: /new Map\(\)|Cache|cache/.test(src),
    skips: [...skips]
  }
}

/**
 * Головний екстрактор: код файлу → факт-лист.
 * @param {string} src вміст файлу
 * @param {string} relPath шлях (для контексту/мови екстрактора)
 * @returns {{relPath:string, lang:string, header:string, exports:Array, imports:object, markers:object}}
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
import { isRunAsCli } from '../../../scripts/cli-entry.mjs'
import { readFileSync } from 'node:fs'
if (isRunAsCli(import.meta.url)) {
  const file = process.argv[2]
  if (!file) {
    console.error('Usage: node docgen-extract.mjs <file>')
    process.exit(1)
  }
  const facts = extractFacts(readFileSync(file, 'utf8'), file)
  console.log(JSON.stringify(facts, null, 2))
}

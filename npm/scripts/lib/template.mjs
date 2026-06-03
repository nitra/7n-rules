/**
 * Reads template/ for a concern directory and returns a merged structure indexed
 * by target basename. For each <target>, returns whichever of snippet/deny/contains
 * exist (parsed in native format by extension).
 * @param {string} concernDir absolute path to fix/<concern>/ or policy/<concern>/
 * @returns {Promise<Record<string, { snippet?: unknown, deny?: unknown, contains?: unknown }>>}
 */
import { existsSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { basename as _basename, extname, join, relative } from 'node:path'

import { parse as parseToml } from 'smol-toml'

/** `<target>.<slot>.<ext>` класифікатори — статичні regexp-літерали (без `RegExp(variable)`). */
const SLOT_CLASSIFIERS = [
  { slot: 'snippet', re: /^(?<target>.+)\.snippet\.[^.]+$/ },
  { slot: 'deny', re: /^(?<target>.+)\.deny\.[^.]+$/ },
  { slot: 'contains', re: /^(?<target>.+)\.contains\.[^.]+$/ }
]
const IDENT_RE = /^[a-zA-Z_$][\w$]*$/
const NEWLINE_RE = /\r?\n/
const LEADING_BANG_RE = /^!/

/**
 * Parse file contents by extension; returns JS object for structured formats, string for text.
 * @param {string} path шлях до файлу
 * @returns {Promise<unknown>} розпарсений вміст
 */
export async function parseByExt(path) {
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

/**
 * @param {string} s сирий вміст JSON/JSONC
 * @returns {string} текст без коментарів, рядкові літерали збережено
 */
function stripJsonComments(s) {
  // Match string literals OR comments. Strings are returned unchanged so we never
  // strip `/*` / `//` / `*/` that appear inside values (e.g. glob `**/node_modules/**`).
  return s.replaceAll(/"(?:\\.|[^"\\])*"|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, m => (m.startsWith('"') ? m : ''))
}

/**
 * @param {string} dir каталог для рекурсивного обходу
 * @param {string} [base] базовий шлях для відносних результатів
 * @returns {Promise<string[]>} список відносних шляхів файлів
 */
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
 * @param {string} relPath відносний шлях template-файлу
 * @returns {{ target: string, slot: string | null }} класифікація
 */
function classifyTemplateFile(relPath) {
  // Try ".<slot>." suffix detection
  for (const { slot, re } of SLOT_CLASSIFIERS) {
    const m = relPath.match(re)
    if (m?.groups?.target) return { target: m.groups.target, slot }
  }
  // No slot suffix → text-only canon for the literal target name
  return { target: relPath, slot: null }
}

/**
 * @param {string|number} p сегмент шляху
 * @returns {string} токен у форматі ідентифікатор / [n] / JSON-рядок
 */
function tokenizePathPart(p) {
  if (typeof p === 'number') return `[${p}]`
  if (IDENT_RE.test(p)) return p
  return JSON.stringify(p)
}

/**
 * @param {Array<string|number>} parts сегменти шляху
 * @returns {string} дотовий шлях для повідомлень
 */
function formatPath(parts) {
  const tokens = parts.map(p => tokenizePathPart(p))
  let out = ''
  for (const p of tokens) {
    if (out === '') out = p
    else if (p.startsWith('[')) out += p
    else out += '.' + p
  }
  return out
}

/**
 * @param {unknown} v значення
 * @returns {string} JSON-рядок для рядків, інакше String(v)
 */
function quote(v) {
  return typeof v === 'string' ? JSON.stringify(v) : String(v)
}

/** Ключі, за якими ідентифікуємо елемент масиву обʼєктів у повідомленні (напр. workflow-крок). */
const ELEMENT_ID_KEYS = ['uses', 'name', 'id', 'run']

/**
 * Людинозрозумілий опис елемента масиву для повідомлення про відсутність.
 * Для скаляра — `quote`; для обʼєкта — перший наявний ідентифікуючий ключ
 * (`uses`/`name`/`id`/`run`), інакше компактний JSON.
 * @param {unknown} needle елемент сніпета, якого бракує в actual
 * @returns {string} опис для тексту порушення
 */
function describeElement(needle) {
  if (needle !== null && typeof needle === 'object' && !Array.isArray(needle)) {
    const obj = /** @type {Record<string, unknown>} */ (needle)
    for (const k of ELEMENT_ID_KEYS) {
      if (typeof obj[k] === 'string') return `елемент з ${k}: ${quote(obj[k])}`
    }
    return `елемент ${JSON.stringify(needle)}`
  }
  return quote(needle)
}

/**
 * Deep subset-of check. Every leaf in `snippet` must equal same path in `actual`.
 * Arrays in snippet: every element must be present in actual array.
 * Returns array of violation messages.
 * @param {unknown} actual фактичне значення з документа
 * @param {unknown} snippet канонічний фрагмент із template
 * @param {{ targetPath: string, source: string }} opts опції джерела
 * @param {Array<string|number>} [path] поточний шлях у дереві
 * @returns {string[]} список порушень
 */
export function checkSnippet(actual, snippet, opts, path = []) {
  if (snippet === null || snippet === undefined) return []
  const { targetPath, source } = opts
  const violations = []
  if (Array.isArray(snippet)) {
    if (!Array.isArray(actual)) {
      violations.push(`${targetPath}: ${formatPath(path)} має бути масивом (${source})`)
      return violations
    }
    // Subset-of, order-insensitive: кожен елемент сніпета має структурно міститись
    // хоча б в одному елементі actual. Для обʼєктів — рекурсивний subset
    // (`checkSnippet` без порушень), тож порядок ключів, зайві поля й зайві елементи
    // не ламають збіг. Критично для впорядкованих масивів як `steps`, де елементи
    // сортувати не можна (порядок кроків семантичний) — матч лишається за наявністю.
    for (const needle of snippet) {
      const found = actual.some(a => checkSnippet(a, needle, opts, [...path, '[]']).length === 0)
      if (!found) {
        violations.push(`${targetPath}: ${formatPath(path)} має містити ${describeElement(needle)} (${source})`)
      }
    }
    return violations
  }
  if (typeof snippet === 'object') {
    if (actual === null || actual === undefined || typeof actual !== 'object' || Array.isArray(actual)) {
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
 * @param {unknown} actual фактичне значення з документа
 * @param {unknown} deny дерево заборонених шляхів із template
 * @param {{ targetPath: string, source: string }} opts опції джерела
 * @param {Array<string|number>} [path] поточний шлях у дереві
 * @returns {string[]} список порушень
 */
export function checkDeny(actual, deny, opts, path = []) {
  if (deny === null || deny === undefined) return []
  const { targetPath, source } = opts
  if (typeof deny === 'object' && !Array.isArray(deny)) {
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

/**
 * For each leaf path that has an array of strings in `contains`, every string
 * must appear as substring in the same path of `actual` (string leaf).
 * @param {unknown} actual фактичне значення з документа
 * @param {unknown} contains дерево обов'язкових підрядків із template
 * @param {{ targetPath: string, source: string }} opts опції джерела
 * @param {Array<string|number>} [path] поточний шлях у дереві
 * @returns {string[]} список порушень
 */
export function checkContains(actual, contains, opts, path = []) {
  if (contains === null || contains === undefined) return []
  const { targetPath, source } = opts
  if (Array.isArray(contains)) {
    const out = []
    const haystack = typeof actual === 'string' ? actual : ''
    for (const needle of contains) {
      if (!haystack.includes(needle)) {
        out.push(`${targetPath}: ${formatPath(path)} має містити ${quote(needle)} (${source})`)
      }
    }
    return out
  }
  if (typeof contains === 'object') {
    const out = []
    for (const [k, v] of Object.entries(contains)) {
      const childActual = actual && typeof actual === 'object' ? actual[k] : undefined
      out.push(...checkContains(childActual, v, opts, [...path, k]))
    }
    return out
  }
  return []
}

/**
 * For text-only targets (e.g. .stylelintignore): every non-empty, non-comment
 * line in `template` must appear (trimmed) in `actual`.
 * @param {unknown} actual фактичний текст документа
 * @param {unknown} template канонічний текст із template
 * @param {{ targetPath: string, source: string }} opts опції джерела
 * @returns {string[]} список порушень
 */
export function checkTextSubset(actual, template, opts) {
  if (template === null || template === undefined) return []
  const { targetPath, source } = opts
  const actualLines = new Set(
    String(actual ?? '')
      .split(NEWLINE_RE)
      .map(l => l.trim())
  )
  const out = []
  for (const raw of String(template).split(NEWLINE_RE)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    if (!actualLines.has(line)) {
      out.push(`${targetPath}: відсутній рядок ${quote(line)} (${source})`)
    }
  }
  return out
}

/**
 * @param {string} concernDir абсолютний шлях до fix/<concern>/ або policy/<concern>/
 * @returns {Promise<Record<string, { snippet?: unknown, deny?: unknown, contains?: unknown }>>} merged template-дерево, індексоване за target
 */
export async function loadTemplate(concernDir) {
  const tplDir = join(concernDir, 'template')
  if (!existsSync(tplDir)) return {}
  const tplStat = await stat(tplDir)
  if (!tplStat.isDirectory()) return {}
  const files = await walk(tplDir)
  const result = {}
  for (const rel of files) {
    const { target, slot } = classifyTemplateFile(rel)
    if (!result[target]) result[target] = {}
    const value = await parseByExt(join(tplDir, rel))
    if (slot === null)
      result[target].snippet = value // text-only treated as snippet
    else result[target][slot] = value
  }
  return result
}

/**
 * Resolves which template[<target>] to pass for a concern, based on its target.json.
 * For `single` targets — basename. For `walkGlob` — basename of first non-negated entry.
 * @param {string} concernAbsDir absolute path to fix/<concern>/ or policy/<concern>/
 * @param {{ files?: { single?: string, walkGlob?: string|string[] } }} targetJson parsed target.json
 * @returns {Promise<object|undefined>} template tree for the resolved target basename, or undefined
 */
export async function resolveConcernTemplateData(concernAbsDir, targetJson) {
  const tpl = await loadTemplate(concernAbsDir)
  const single = targetJson?.files?.single
  if (single) return tpl[_basename(single)]
  const glob = targetJson?.files?.walkGlob
  if (typeof glob === 'string') return tpl[_basename(glob.replace(LEADING_BANG_RE, ''))]
  if (Array.isArray(glob)) {
    for (const g of glob) {
      if (g.startsWith('!')) continue
      const data = tpl[_basename(g)]
      if (data) return data
    }
  }
}

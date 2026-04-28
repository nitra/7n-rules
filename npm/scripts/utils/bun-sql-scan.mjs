/**
 * AST-сканер небезпечних патернів Bun SQL (`import { sql, SQL } from 'bun'`).
 *
 * Знаходить:
 * - `new SQL(...)` всередині функції — пул має бути singleton на рівні модуля,
 *   а не на кожен виклик handler-а.
 * - Виклик `sql.unsafe(\`...${expr}...\`)` з даними у TemplateLiteral —
 *   `sql.unsafe` приймає лише статичний SQL (плюс масив параметрів); інтерполяція
 *   у текст руйнує параметризацію і відкриває SQL injection.
 * - Динамічні SQL-списки у tagged template `sql\`... IN (${arr.join(',')}) ...\``:
 *   навіть «через tagged template» у запит потрапляє готовий шматок SQL замість
 *   параметризованих значень — треба `sql([...])`.
 *
 * Семантика — через **oxc-parser**, без regex по тексту коду.
 * Якщо файл не парситься / містить синтаксичні помилки — повертаємо порожній
 * результат: спочатку треба полагодити синтаксис, потім перезапустити перевірку.
 */
import { parseSync } from 'oxc-parser'

const SOURCE_FILE_RE = /\.([cm]?[jt]sx?)$/u
const SQL_LIST_CONTEXT_RE = /\b(in|values)\b\s*\(/iu
const BUN_SQL_IMPORT_RE = /\bimport\s*\{[\s\S]*?\b(sql|SQL)\b[\s\S]*?\}\s*from\s*["']bun["']/u

/**
 * Мова для Oxc за шляхом файлу (розширення).
 * @param {string} filePath віртуальний або реальний шлях до файлу
 * @returns {'js' | 'jsx' | 'ts' | 'tsx'} значення опції `lang` для `parseSync`
 */
function langFromPath(filePath) {
  const lower = filePath.toLowerCase()
  if (lower.endsWith('.tsx')) return 'tsx'
  if (lower.endsWith('.ts') || lower.endsWith('.mts') || lower.endsWith('.cts')) return 'ts'
  if (lower.endsWith('.jsx')) return 'jsx'
  return 'js'
}

/**
 * Номер рядка (1-based) за зміщенням у буфері.
 * @param {string} content повний текст файлу
 * @param {number} offset байтове зміщення початку фрагмента
 * @returns {number} номер рядка від 1
 */
function offsetToLine(content, offset) {
  let line = 1
  const n = Math.min(offset, content.length)
  for (let i = 0; i < n; i++) {
    if (content.codePointAt(i) === 10) line++
  }
  return line
}

/**
 * Стискає пробіли для повідомлення про порушення.
 * @param {string} s фрагмент коду
 * @returns {string} скорочений однорядковий рядок
 */
function normalizeSnippet(s) {
  return s.replaceAll(/\s+/gu, ' ').trim().slice(0, 180)
}

/**
 * Чи є вузол функцією.
 * @param {unknown} node AST node
 * @returns {boolean} true, якщо це будь-який вузол-функція
 */
function isFunctionNode(node) {
  return (
    !!node &&
    typeof node === 'object' &&
    typeof node.type === 'string' &&
    (node.type === 'FunctionDeclaration' ||
      node.type === 'FunctionExpression' ||
      node.type === 'ArrowFunctionExpression')
  )
}

/**
 * Рекурсивний обхід AST з предками, щоб визначати контекст (всередині функції чи ні).
 * @param {unknown} node поточний вузол
 * @param {unknown[]} ancestors масив предків від кореня до parent
 * @param {(n: Record<string, unknown>, ancestors: unknown[]) => void} visit відвідувач для вузлів з `type`
 * @returns {void}
 */
function walkAstWithAncestors(node, ancestors, visit) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const item of node) walkAstWithAncestors(item, ancestors, visit)
    return
  }

  const rec = /** @type {Record<string, unknown>} */ (node)
  if (typeof rec.type === 'string') {
    visit(rec, ancestors)
    ancestors = [...ancestors, rec]
  }

  for (const key of Object.keys(node)) {
    if (key === 'parent') continue
    const v = rec[key]
    if (v && typeof v === 'object') {
      walkAstWithAncestors(v, ancestors, visit)
    }
  }
}

/**
 * Парсить файл та повертає program або null, якщо є синтаксичні помилки.
 * @param {string} content вихідний код
 * @param {string} virtualPath шлях для вибору `lang`
 * @returns {unknown | null} `result.program` або null
 */
function parseProgramOrNull(content, virtualPath) {
  const lang = langFromPath(virtualPath || 'scan.ts')
  let result
  try {
    result = parseSync(virtualPath || 'scan.ts', content, { lang, sourceType: 'module' })
  } catch {
    return null
  }
  if (result.errors?.length) return null
  return result.program
}

/**
 * Чи це `new SQL(...)` (Identifier callee з імʼям `SQL`).
 * @param {unknown} node AST node
 * @returns {boolean} true, якщо це `new SQL(...)`
 */
function isNewSqlConstructor(node) {
  if (!node || node.type !== 'NewExpression') return false
  const callee = node.callee
  return !!callee && callee.type === 'Identifier' && callee.name === 'SQL'
}

/**
 * Чи це виклик `<obj>.unsafe(...)` з TemplateLiteral як першим аргументом і expressions усередині нього.
 * Допустимий лише `sql.unsafe('static text', [params])`; з `${...}` у TemplateLiteral — небезпечно.
 * @param {unknown} node AST node
 * @returns {boolean} true для небезпечного `sql.unsafe(\`... ${x} ...\`)`
 */
function isUnsafeCallWithInterpolatedTemplate(node) {
  if (!node || node.type !== 'CallExpression') return false
  const callee = node.callee
  if (!callee || callee.type !== 'MemberExpression' || callee.computed) return false
  const prop = callee.property
  if (!prop || prop.type !== 'Identifier' || prop.name !== 'unsafe') return false
  const args = node.arguments
  if (!Array.isArray(args) || args.length === 0) return false
  const first = args[0]
  if (!first || first.type !== 'TemplateLiteral') return false
  const expressions = first.expressions
  return Array.isArray(expressions) && expressions.length > 0
}

/**
 * Чи це `.join(...)` виклик (типово для динамічних списків у SQL).
 * @param {unknown} node AST node
 * @returns {boolean} true, якщо це CallExpression `*.join(...)`
 */
function isJoinCall(node) {
  if (!node || node.type !== 'CallExpression') return false
  const callee = node.callee
  if (!callee || callee.type !== 'MemberExpression' || callee.computed) return false
  const prop = callee.property
  return !!prop && prop.type === 'Identifier' && prop.name === 'join'
}

/**
 * Текст quasis у TemplateLiteral (без expressions).
 * @param {unknown} template TemplateLiteral
 * @returns {string} обʼєднаний raw-текст
 */
function templateQuasisText(template) {
  if (!template || template.type !== 'TemplateLiteral') return ''
  const quasis = template.quasis
  if (!Array.isArray(quasis) || quasis.length === 0) return ''
  let out = ''
  for (const q of quasis) {
    if (!q || typeof q !== 'object') continue
    const value = q.value
    if (!value || typeof value !== 'object') continue
    if (typeof value.raw === 'string') out += value.raw
  }
  return out
}

/**
 * Чи виглядає TemplateLiteral як SQL-контекст зі списком (IN/VALUES (...)).
 * @param {unknown} template TemplateLiteral
 * @returns {boolean} true, якщо текст містить `IN (` або `VALUES (`
 */
function isSqlListContextTemplate(template) {
  return SQL_LIST_CONTEXT_RE.test(templateQuasisText(template))
}

/**
 * Знаходить `new SQL(...)` всередині функцій (handler на кожен запит замість singleton).
 * @param {string} content вихідний код
 * @param {string} [virtualPath] шлях для вибору `lang`
 * @returns {{ line: number, snippet: string }[]} список порушень
 */
export function findBunSqlPerRequestConnectionInText(content, virtualPath = 'scan.ts') {
  const program = parseProgramOrNull(content, virtualPath)
  if (!program) return []

  /** @type {{ line: number, snippet: string }[]} */
  const out = []
  walkAstWithAncestors(program, [], (node, ancestors) => {
    if (!isNewSqlConstructor(node)) return
    const insideFunction = ancestors.some(n => isFunctionNode(n))
    if (!insideFunction) return
    out.push({
      line: offsetToLine(content, node.start),
      snippet: normalizeSnippet(content.slice(node.start, node.end))
    })
  })
  return out
}

/**
 * Знаходить виклики `sql.unsafe(\`...${...}...\`)` (TemplateLiteral з expressions).
 * @param {string} content вихідний код
 * @param {string} [virtualPath] шлях для вибору `lang`
 * @returns {{ line: number, snippet: string }[]} список порушень
 */
export function findUnsafeBunSqlUnsafeCallInText(content, virtualPath = 'scan.ts') {
  const program = parseProgramOrNull(content, virtualPath)
  if (!program) return []

  /** @type {{ line: number, snippet: string }[]} */
  const out = []
  walkAstWithAncestors(program, [], node => {
    if (!isUnsafeCallWithInterpolatedTemplate(node)) return
    out.push({
      line: offsetToLine(content, node.start),
      snippet: normalizeSnippet(content.slice(node.start, node.end))
    })
  })
  return out
}

/**
 * Знаходить динамічні SQL-списки у TaggedTemplateExpression / TemplateLiteral в контексті
 * `IN (...)` або `VALUES (...)`, де серед expressions є виклик `.join(...)`.
 * @param {string} content вихідний код
 * @param {string} [virtualPath] шлях для вибору `lang`
 * @returns {{ line: number, snippet: string }[]} список порушень
 */
export function findUnsafeBunSqlDynamicSqlListInText(content, virtualPath = 'scan.ts') {
  const program = parseProgramOrNull(content, virtualPath)
  if (!program) return []

  /** @type {{ line: number, snippet: string }[]} */
  const out = []
  walkAstWithAncestors(program, [], node => {
    /** @type {unknown} */
    let template = null
    if (node.type === 'TemplateLiteral') {
      template = node
    } else if (node.type === 'TaggedTemplateExpression') {
      template = node.quasi
    }
    if (!template || typeof template !== 'object' || template.type !== 'TemplateLiteral') return
    if (!isSqlListContextTemplate(template)) return
    const expressions = template.expressions
    if (!Array.isArray(expressions) || expressions.length === 0) return
    if (!expressions.some(expr => isJoinCall(expr))) return
    out.push({
      line: offsetToLine(content, template.start),
      snippet: normalizeSnippet(content.slice(template.start, template.end))
    })
  })
  return out
}

/**
 * Чи містить текст джерела імпорт імені `sql` або `SQL` з `"bun"`.
 * Скан по сирому тексту — без AST, щоб бути дешевим: викликається на кожному
 * JS/TS-файлі при зборі ознак для авто-детекту правил.
 * @param {string} content вміст файлу
 * @returns {boolean}
 */
export function textHasBunSqlImport(content) {
  return BUN_SQL_IMPORT_RE.test(content)
}

/**
 * Чи сканувати цей файл за розширенням (JS/TS-сімʼя, без `.d.ts`).
 * @param {string} relativePathPosix відносний шлях (posix)
 * @returns {boolean} true, якщо розширення підходить для AST-скану
 */
export function isBunSqlScanSourceFile(relativePathPosix) {
  return SOURCE_FILE_RE.test(relativePathPosix) && !relativePathPosix.endsWith('.d.ts')
}

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
import {
  isFunctionNode,
  isJoinCall,
  isSqlListContextTemplate,
  normalizeSnippet,
  offsetToLine,
  parseProgramOrNull,
  walkAstWithAncestors
} from './ast-scan-utils.mjs'

const SOURCE_FILE_RE = /\.([cm]?[jt]sx?)$/u
const BUN_SQL_IMPORT_RE = /\bimport\s*\{[\s\S]*?\b(sql|SQL)\b[\s\S]*?\}\s*from\s*["']bun["']/u

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
 * @returns {boolean} true, якщо є імпорт sql або SQL з модуля bun
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

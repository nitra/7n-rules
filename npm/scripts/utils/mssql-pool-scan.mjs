/**
 * Знаходить небезпечні патерни використання `mssql`, які створюють підключення/пул
 * всередині функцій (наприклад handler на кожен запит), замість того щоб мати один
 * singleton `sql.ConnectionPool` на рівні модуля та повторно використовувати його.
 *
 * Також знаходить небезпечний виклик `query(\`...\`)` — це НЕ tagged template, а звичайний
 * виклик з інтерполяцією рядка, який може призвести до SQL injection. Натомість має
 * використовуватись tagged template `query\`...\`` (див. js-mssql.mdc).
 *
 * Додатково знаходить:
 * - shared `Request` (наприклад `export const request = pool.request()`), який не можна
 *   повторно використовувати між запитами.
 * - небезпечні “динамічні списки” в SQL, коли в TemplateLiteral/TaggedTemplateExpression
 *   підставляють рядки, зібрані через `.join(',')` (типово для `IN (...)` або `VALUES (...)`).
 * - підстановки `IN (${expr})`, де `expr` не пройшов числовий парсер (parseInt/Number/BigInt
 *   /parseFloat або унарний `+`) і не є літеральним масивом чисел — навіть у tagged template
 *   це додатковий шар захисту від SQL injection (див. js-mssql.mdc).
 *
 * Семантика береться з **oxc-parser** по AST, щоб не покладатися на regex.
 * Якщо файл не парситься або містить синтаксичні помилки — повертаємо порожній
 * результат (спочатку треба полагодити синтаксис, потім перезапустити перевірку).
 */
import { parseSync } from 'oxc-parser'

import {
  isFunctionNode,
  isJoinCall,
  isSqlListContextTemplate,
  langFromPath,
  normalizeSnippet,
  offsetToLine,
  walkAstWithAncestors
} from './ast-scan-utils.mjs'

const SOURCE_FILE_RE = /\.([cm]?[jt]sx?)$/
const IN_PLACEHOLDER_END_RE = /\bin\s*\(\s*$/iu
const NUMERIC_PARSE_FN_NAMES = new Set(['parseInt', 'parseFloat', 'Number', 'BigInt'])

/**
 * Чи містить тест if-умови перевірку “список порожній”.
 * Підтримує базові форми:
 * - `if (!ids.length) ...`
 * - `if (ids.length === 0) ...` / `<= 0` / `< 1`
 *
 * @param {unknown} test IfStatement.test
 * @param {string} name імʼя змінної списку
 * @returns {boolean}
 */
function isEmptyListTest(test, name) {
  if (!test || typeof test !== 'object') return false

  if (test.type === 'UnaryExpression' && test.operator === '!') {
    const arg = test.argument
    if (!arg || typeof arg !== 'object') return false
    if (arg.type === 'MemberExpression' && !arg.computed) {
      const obj = arg.object
      const prop = arg.property
      return !!obj && obj.type === 'Identifier' && obj.name === name && !!prop && prop.type === 'Identifier' && prop.name === 'length'
    }
  }

  if (test.type === 'BinaryExpression') {
    const { left, right, operator } = test
    const isLen = node =>
      !!node &&
      typeof node === 'object' &&
      node.type === 'MemberExpression' &&
      !node.computed &&
      node.object &&
      node.object.type === 'Identifier' &&
      node.object.name === name &&
      node.property &&
      node.property.type === 'Identifier' &&
      node.property.name === 'length'
    const isZero = node =>
      !!node &&
      typeof node === 'object' &&
      ((node.type === 'NumericLiteral' && node.value === 0) || (node.type === 'Literal' && node.value === 0))

    if (!['===', '==', '<=', '<'].includes(operator)) return false
    if (isLen(left) && isZero(right)) return true
    // допускаємо `0 === ids.length` теж
    if (isZero(left) && isLen(right) && (operator === '===' || operator === '==')) return true
  }

  return false
}

/**
 * Чи є в consequent (або в його BlockStatement) ThrowStatement.
 * @param {unknown} consequent IfStatement.consequent
 * @returns {boolean}
 */
function consequentHasThrow(consequent) {
  if (!consequent || typeof consequent !== 'object') return false
  if (consequent.type === 'ThrowStatement') return true
  if (consequent.type === 'BlockStatement' && Array.isArray(consequent.body)) {
    return consequent.body.some(s => s && typeof s === 'object' && s.type === 'ThrowStatement')
  }
  return false
}

/**
 * Шукає “guard” `if (empty) throw` перед statementIndex у межах того ж BlockStatement.
 * @param {unknown} block BlockStatement
 * @param {number} statementIndex індекс statement, перед яким шукаємо guard
 * @param {string} name імʼя змінної списку
 * @returns {boolean}
 */
function hasEmptyGuardBefore(block, statementIndex, name) {
  if (!block || typeof block !== 'object' || block.type !== 'BlockStatement') return false
  const body = block.body
  if (!Array.isArray(body)) return false
  for (let i = 0; i < statementIndex; i++) {
    const st = body[i]
    if (!st || typeof st !== 'object') continue
    if (st.type !== 'IfStatement') continue
    if (!isEmptyListTest(st.test, name)) continue
    if (!consequentHasThrow(st.consequent)) continue
    return true
  }
  return false
}

/**
 * Знаходить найближчий enclosing BlockStatement і statement всередині нього.
 * @param {unknown[]} ancestors ancestors масив з walkAstWithAncestors
 * @returns {{ block: unknown, index: number } | null}
 */
function findEnclosingBlockAndStatementIndex(ancestors) {
  if (!Array.isArray(ancestors) || ancestors.length === 0) return null

  // statement — перший зверху вузол, який лежить у block.body
  // шукаємо пару (block, statement), де statement ∈ block.body
  for (let i = ancestors.length - 1; i >= 1; i--) {
    const maybeStatement = ancestors[i]
    const maybeBlock = ancestors[i - 1]
    if (!maybeBlock || typeof maybeBlock !== 'object' || maybeBlock.type !== 'BlockStatement') continue
    if (!Array.isArray(maybeBlock.body)) continue
    const idx = maybeBlock.body.indexOf(maybeStatement)
    if (idx !== -1) return { block: maybeBlock, index: idx }
  }
  return null
}

/**
 * Чи це `new sql.ConnectionPool(...)` або `new mssql.ConnectionPool(...)`.
 * @param {unknown} node AST node
 * @returns {boolean} true, якщо це створення ConnectionPool
 */
function isNewConnectionPool(node) {
  if (!node || node.type !== 'NewExpression') return false
  const callee = node.callee
  if (!callee || callee.type !== 'MemberExpression') return false
  if (callee.computed) return false
  const obj = callee.object
  const prop = callee.property
  if (!obj || obj.type !== 'Identifier') return false
  if (!prop || prop.type !== 'Identifier' || prop.name !== 'ConnectionPool') return false
  return obj.name === 'sql' || obj.name === 'mssql'
}

/**
 * Чи це виклик `.query(...)` з TemplateLiteral як першим аргументом (`query(\`...\`)`).
 * @param {unknown} node AST node
 * @returns {boolean} true, якщо це небезпечний патерн `query(\`...\`)`
 */
function isUnsafeQueryCallWithTemplateLiteral(node) {
  if (!node || node.type !== 'CallExpression') return false
  const callee = node.callee
  if (!callee || callee.type !== 'MemberExpression') return false
  if (callee.computed) return false
  const prop = callee.property
  if (!prop || prop.type !== 'Identifier' || prop.name !== 'query') return false
  const args = node.arguments
  if (!Array.isArray(args) || args.length === 0) return false
  const first = args[0]
  return !!first && typeof first === 'object' && first.type === 'TemplateLiteral'
}

/**
 * Чи це `something.request()` (наприклад `pool.request()`), яку не можна шарити між запитами.
 * @param {unknown} node AST node
 * @returns {boolean} true, якщо це CallExpression з `.request()`
 */
function isRequestFactoryCall(node) {
  if (!node || node.type !== 'CallExpression') return false
  const callee = node.callee
  if (!callee || callee.type !== 'MemberExpression') return false
  if (callee.computed) return false
  const prop = callee.property
  return !!prop && prop.type === 'Identifier' && prop.name === 'request'
}

/**
 * Знаходить створення `ConnectionPool` всередині функцій.
 * @param {string} content вихідний код
 * @param {string} [virtualPath] шлях для вибору `lang` (наприклад `pkg/src/db.ts`)
 * @returns {{ line: number, snippet: string }[]} список порушень
 */
export function findMssqlPerRequestConnectionInText(content, virtualPath = 'scan.ts') {
  const lang = langFromPath(virtualPath || 'scan.ts')
  let result
  try {
    result = parseSync(virtualPath, content, { lang, sourceType: 'module' })
  } catch {
    return []
  }
  if (result.errors?.length) return []

  /** @type {{ line: number, snippet: string }[]} */
  const out = []

  walkAstWithAncestors(result.program, [], (node, ancestors) => {
    const insideFunction = ancestors.some(n => isFunctionNode(n))
    if (!insideFunction) return

    if (isNewConnectionPool(node)) {
      out.push({
        line: offsetToLine(content, node.start),
        snippet: normalizeSnippet(content.slice(node.start, node.end))
      })
    }
  })

  return out
}

/**
 * Знаходить небезпечні виклики `query(\`...\`)` (CallExpression з TemplateLiteral-аргументом).
 * @param {string} content вихідний код
 * @param {string} [virtualPath] шлях для вибору `lang` (наприклад `pkg/src/db.ts`)
 * @returns {{ line: number, snippet: string }[]} список порушень
 */
export function findUnsafeMssqlQueryTemplateCallInText(content, virtualPath = 'scan.ts') {
  const lang = langFromPath(virtualPath || 'scan.ts')
  let result
  try {
    result = parseSync(virtualPath, content, { lang, sourceType: 'module' })
  } catch {
    return []
  }
  if (result.errors?.length) return []

  /** @type {{ line: number, snippet: string }[]} */
  const out = []
  walkAstWithAncestors(result.program, [], node => {
    if (isUnsafeQueryCallWithTemplateLiteral(node)) {
      out.push({
        line: offsetToLine(content, node.start),
        snippet: normalizeSnippet(content.slice(node.start, node.end))
      })
    }
  })
  return out
}

/**
 * Знаходить shared Request (`export const request = pool.request()` та подібні), які не можна
 * повторно використовувати між запитами.
 * @param {string} content вихідний код
 * @param {string} [virtualPath] шлях для вибору `lang`
 * @returns {{ line: number, snippet: string }[]} список порушень
 */
export function findSharedMssqlRequestInText(content, virtualPath = 'scan.ts') {
  const lang = langFromPath(virtualPath || 'scan.ts')
  let result
  try {
    result = parseSync(virtualPath, content, { lang, sourceType: 'module' })
  } catch {
    return []
  }
  if (result.errors?.length) return []

  /** @type {{ line: number, snippet: string }[]} */
  const out = []
  walkAstWithAncestors(result.program, [], node => {
    if (node.type !== 'VariableDeclarator') return
    const id = node.id
    const init = node.init
    if (!id || id.type !== 'Identifier') return
    if (id.name !== 'request') return
    if (!init || typeof init !== 'object') return
    if (!isRequestFactoryCall(init)) return

    out.push({
      line: offsetToLine(content, node.start),
      snippet: normalizeSnippet(content.slice(node.start, node.end))
    })
  })
  return out
}

/**
 * Знаходить небезпечні динамічні списки в SQL, коли у TemplateLiteral/TaggedTemplateExpression
 * підставляють рядки, зібрані через `.join(...)` у контексті `IN (...)` або `VALUES (...)`.
 *
 * Цей патерн небезпечний навіть якщо зовні використовується tagged template, бо в запит
 * потрапляє “готовий шматок SQL”, а не параметризовані значення.
 * @param {string} content вихідний код
 * @param {string} [virtualPath] шлях для вибору `lang`
 * @returns {{ line: number, snippet: string }[]} список порушень
 */
export function findUnsafeMssqlDynamicSqlListInText(content, virtualPath = 'scan.ts') {
  const lang = langFromPath(virtualPath || 'scan.ts')
  let result
  try {
    result = parseSync(virtualPath, content, { lang, sourceType: 'module' })
  } catch {
    return []
  }
  if (result.errors?.length) return []

  /** @type {{ line: number, snippet: string }[]} */
  const out = []
  walkAstWithAncestors(result.program, [], node => {
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

    const hasJoin = expressions.some(expr => isJoinCall(expr))
    if (!hasJoin) return

    out.push({
      line: offsetToLine(content, template.start),
      snippet: normalizeSnippet(content.slice(template.start, template.end))
    })
  })

  return out
}

/**
 * Чи елементи літерального масиву — лише числові (numeric/bigint) літерали.
 * Такі масиви безпечні в `IN (...)` навіть без явного парсера.
 * @param {unknown} node AST node
 * @returns {boolean} true, якщо це непорожній масив суто числових літералів
 */
function isLiteralNumericArrayExpression(node) {
  if (!node || typeof node !== 'object' || node.type !== 'ArrayExpression') return false
  const elements = node.elements
  if (!Array.isArray(elements) || elements.length === 0) return false
  return elements.every(el => {
    if (!el || typeof el !== 'object') return false
    if (el.type === 'NumericLiteral' || el.type === 'BigIntLiteral') return true
    if (el.type === 'Literal' && (typeof el.value === 'number' || typeof el.value === 'bigint')) {
      return true
    }
    return false
  })
}

/**
 * Чи це безпосередній виклик числового парсера (parseInt/parseFloat/Number/BigInt)
 * або обʼєктний доступ до них (наприклад `Number.parseInt(...)`).
 * @param {Record<string, unknown>} node AST CallExpression
 * @returns {boolean} true, якщо callee — числовий парсер
 */
function isNumericParseCallExpression(node) {
  if (node.type !== 'CallExpression') return false
  const callee = node.callee
  if (!callee) return false
  if (callee.type === 'Identifier' && NUMERIC_PARSE_FN_NAMES.has(callee.name)) return true
  if (callee.type === 'MemberExpression' && !callee.computed) {
    const prop = callee.property
    return !!prop && prop.type === 'Identifier' && NUMERIC_PARSE_FN_NAMES.has(prop.name)
  }
  return false
}

/**
 * Чи містить піддерево виклик числового парсера (parseInt/parseFloat/Number/BigInt)
 * або унарний `+` (приведення до Number). Це сигнал, що значення гарантовано числове
 * і не може містити SQL-метасимволи.
 * @param {unknown} node AST node
 * @returns {boolean} true, якщо знайдено числовий парсер у піддереві
 */
function subtreeHasNumericParseCall(node) {
  if (!node || typeof node !== 'object') return false
  if (Array.isArray(node)) return node.some(item => subtreeHasNumericParseCall(item))

  if (isNumericParseCallExpression(node)) return true
  if (node.type === 'UnaryExpression' && node.operator === '+') return true

  for (const key of Object.keys(node)) {
    if (key === 'parent') continue
    const v = node[key]
    if (v && typeof v === 'object' && subtreeHasNumericParseCall(v)) return true
  }
  return false
}

/**
 * Збирає всі VariableDeclarator-вузли в AST (для трасування Identifier-ів до їх init).
 * @param {unknown} programNode AST root (Program)
 * @returns {Array<Record<string, unknown>>} список VariableDeclarator-ів
 */
function collectVariableDeclarators(programNode) {
  /** @type {Array<Record<string, unknown>>} */
  const out = []
  walkAstWithAncestors(programNode, [], node => {
    if (node.type === 'VariableDeclarator') out.push(node)
  })
  return out
}

/**
 * Чи виглядає вираз, який підставляється в `IN (${...})`, як «безпечно розпарсений»:
 * - літеральний масив чисел;
 * - саме піддерево містить виклик числового парсера (parseInt/Number/BigInt/parseFloat/+x);
 * - Identifier, чий init у файлі рекурсивно задовольняє ці умови.
 *
 * Якщо для Identifier немає видимого init (наприклад параметр функції чи import),
 * вираз вважається не парсованим — потрібен явний парсер на місці підстановки.
 * @param {unknown} expr вираз з template.expressions
 * @param {Array<Record<string, unknown>>} declarators VariableDeclarator-и файлу
 * @param {Set<string>} [seen] іменa Identifier-ів, що вже трасуються (анти-цикл)
 * @returns {boolean} true, якщо вираз можна вважати безпечно числовим
 */
function isInListExpressionParsed(expr, declarators, seen = new Set()) {
  if (!expr || typeof expr !== 'object') return false
  if (isLiteralNumericArrayExpression(expr)) return true
  if (subtreeHasNumericParseCall(expr)) return true

  if (expr.type === 'Identifier' && typeof expr.name === 'string') {
    if (seen.has(expr.name)) return false
    const nextSeen = new Set(seen)
    nextSeen.add(expr.name)
    const inits = declarators
      .filter(d => {
        const id = d.id
        return !!id && typeof id === 'object' && id.type === 'Identifier' && id.name === expr.name && !!d.init
      })
      .map(d => d.init)
    if (inits.length === 0) return false
    return inits.every(init => isInListExpressionParsed(init, declarators, nextSeen))
  }

  return false
}

/**
 * Сирий текст quasi-елемента TemplateLiteral на позиції перед expressions[i].
 * @param {unknown} q quasi-елемент TemplateLiteral
 * @returns {string} `q.value.raw` або порожній рядок, якщо структура не підходить
 */
function quasiRawText(q) {
  return q && typeof q === 'object' && q.value && typeof q.value === 'object' && typeof q.value.raw === 'string'
    ? q.value.raw
    : ''
}

/**
 * Збирає порушення для одного TemplateLiteral вузла: знаходить expressions, що
 * стоять одразу після `IN (` без числового парсера значень.
 * @param {Record<string, unknown>} node TemplateLiteral
 * @param {string} content вихідний код
 * @param {Array<Record<string, unknown>>} declarators VariableDeclarator-и для трасування
 * @param {{ line: number, snippet: string }[]} out буфер результатів
 */
function collectInListUnparsedFromTemplate(node, content, declarators, out) {
  if (node.type !== 'TemplateLiteral') return
  const quasis = node.quasis
  const expressions = node.expressions
  if (!Array.isArray(quasis) || !Array.isArray(expressions) || expressions.length === 0) return

  for (const [i, expr] of expressions.entries()) {
    if (!IN_PLACEHOLDER_END_RE.test(quasiRawText(quasis[i]))) continue
    if (!expr || typeof expr !== 'object') continue
    if (isJoinCall(expr)) continue
    if (isInListExpressionParsed(expr, declarators)) continue

    const startOffset = typeof expr.start === 'number' ? expr.start : node.start
    out.push({
      line: offsetToLine(content, startOffset),
      snippet: normalizeSnippet(content.slice(node.start, node.end))
    })
  }
}

/**
 * Збирає порушення для одного TemplateLiteral: якщо у `IN (${...})`:
 * - `${...}` не є Identifier (значення не винесені у змінну);
 * - або це Identifier, але перед запитом немає guard `if (empty) throw`.
 *
 * @param {Record<string, unknown>} node TemplateLiteral
 * @param {unknown[]} ancestors ancestors від walkAstWithAncestors
 * @param {string} content вихідний код
 * @param {{ line: number, snippet: string, reason: 'not_var' | 'missing_guard', name?: string }[]} out буфер результатів
 */
function collectInListMissingEmptyGuardFromTemplate(node, ancestors, content, out) {
  if (node.type !== 'TemplateLiteral') return
  const quasis = node.quasis
  const expressions = node.expressions
  if (!Array.isArray(quasis) || !Array.isArray(expressions) || expressions.length === 0) return

  for (const [i, expr] of expressions.entries()) {
    if (!IN_PLACEHOLDER_END_RE.test(quasiRawText(quasis[i]))) continue
    if (!expr || typeof expr !== 'object') continue

    if (expr.type !== 'Identifier' || typeof expr.name !== 'string') {
      out.push({
        line: offsetToLine(content, node.start),
        snippet: normalizeSnippet(content.slice(node.start, node.end)),
        reason: 'not_var'
      })
      continue
    }

    const place = findEnclosingBlockAndStatementIndex(ancestors)
    if (!place || !hasEmptyGuardBefore(place.block, place.index, expr.name)) {
      out.push({
        line: offsetToLine(content, node.start),
        snippet: normalizeSnippet(content.slice(node.start, node.end)),
        reason: 'missing_guard',
        name: expr.name
      })
    }
  }
}

/**
 * Знаходить підстановки IN (вираз) у TemplateLiteral, де вираз не пройшов числовий парсер.
 *
 * Навіть у безпечному tagged template pool.request().query краще явно парсити значення (parseInt,
 * Number, BigInt, parseFloat) та фільтрувати NaN. Див. також findUnsafeMssqlDynamicSqlListInText для
 * випадків arr.join у списках.
 * @param {string} content вихідний код
 * @param {string} [virtualPath] шлях для вибору мови парсера (lang)
 * @returns {{ line: number, snippet: string }[]} список порушень
 */
export function findUnsafeMssqlInListUnparsedInText(content, virtualPath = 'scan.ts') {
  const lang = langFromPath(virtualPath || 'scan.ts')
  let result
  try {
    result = parseSync(virtualPath, content, { lang, sourceType: 'module' })
  } catch {
    return []
  }
  if (result.errors?.length) return []

  const declarators = collectVariableDeclarators(result.program)

  /** @type {{ line: number, snippet: string }[]} */
  const out = []
  walkAstWithAncestors(result.program, [], node => collectInListUnparsedFromTemplate(node, content, declarators, out))

  return out
}

/**
 * Знаходить підстановки списків у `IN (${...})`, які:
 * - не винесені в окрему змінну (в `${...}` стоїть не Identifier);
 * - або винесені, але перед запитом немає перевірки на пустоту з `throw`.
 *
 * @param {string} content вихідний код
 * @param {string} [virtualPath] шлях для вибору мови парсера (lang)
 * @returns {{ line: number, snippet: string, reason: 'not_var' | 'missing_guard', name?: string }[]} список порушень
 */
export function findUnsafeMssqlInListMissingEmptyGuardInText(content, virtualPath = 'scan.ts') {
  const lang = langFromPath(virtualPath || 'scan.ts')
  let result
  try {
    result = parseSync(virtualPath, content, { lang, sourceType: 'module' })
  } catch {
    return []
  }
  if (result.errors?.length) return []

  /** @type {{ line: number, snippet: string, reason: 'not_var' | 'missing_guard', name?: string }[]} */
  const out = []
  walkAstWithAncestors(result.program, [], (node, ancestors) =>
    collectInListMissingEmptyGuardFromTemplate(node, ancestors, content, out)
  )
  return out
}

/**
 * Чи сканувати цей файл за розширенням (JS/TS-сім'я).
 * @param {string} relativePathPosix відносний шлях (posix)
 * @returns {boolean} `true`, якщо розширення підходить для AST-скану
 */
export function isMssqlScanSourceFile(relativePathPosix) {
  return SOURCE_FILE_RE.test(relativePathPosix) && !relativePathPosix.endsWith('.d.ts')
}

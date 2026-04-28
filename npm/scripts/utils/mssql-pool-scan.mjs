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

const SOURCE_FILE_RE = /\.([cm]?[jt]sx?)$/
const SQL_LIST_CONTEXT_RE = /\b(in|values)\b\s*\(/iu
const IN_PLACEHOLDER_END_RE = /\bin\s*\(\s*$/iu
const NUMERIC_PARSE_FN_NAMES = new Set(['parseInt', 'parseFloat', 'Number', 'BigInt'])

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
  return s.replaceAll(/\s+/g, ' ').trim().slice(0, 180)
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
    if (key === 'parent') {
      continue
    }
    const v = rec[key]
    if (v && typeof v === 'object') {
      walkAstWithAncestors(v, ancestors, visit)
    }
  }
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
 * Чи це `.join(...)` виклик (часто використовується для динамічних списків в SQL).
 * @param {unknown} node AST node
 * @returns {boolean} true, якщо це CallExpression `*.join(...)`
 */
function isJoinCall(node) {
  if (!node || node.type !== 'CallExpression') return false
  const callee = node.callee
  if (!callee || callee.type !== 'MemberExpression') return false
  if (callee.computed) return false
  const prop = callee.property
  return !!prop && prop.type === 'Identifier' && prop.name === 'join'
}

/**
 * Повертає текст quasis у TemplateLiteral (без expressions).
 * @param {unknown} template TemplateLiteral
 * @returns {string} обʼєднаний текст
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
 *
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
 * Чи містить піддерево виклик числового парсера (parseInt/parseFloat/Number/BigInt)
 * або унарний `+` (приведення до Number). Це сигнал, що значення гарантовано числове
 * і не може містити SQL-метасимволи.
 * @param {unknown} node AST node
 * @returns {boolean} true, якщо знайдено числовий парсер у піддереві
 */
function subtreeHasNumericParseCall(node) {
  if (!node || typeof node !== 'object') return false
  if (Array.isArray(node)) return node.some(subtreeHasNumericParseCall)

  if (node.type === 'CallExpression') {
    const callee = node.callee
    if (callee && callee.type === 'Identifier' && NUMERIC_PARSE_FN_NAMES.has(callee.name)) {
      return true
    }
    if (callee && callee.type === 'MemberExpression' && !callee.computed) {
      const prop = callee.property
      if (prop && prop.type === 'Identifier' && NUMERIC_PARSE_FN_NAMES.has(prop.name)) {
        return true
      }
    }
  }
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
 *
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
        return (
          !!id &&
          typeof id === 'object' &&
          id.type === 'Identifier' &&
          id.name === expr.name &&
          !!d.init
        )
      })
      .map(d => d.init)
    if (inits.length === 0) return false
    return inits.every(init => isInListExpressionParsed(init, declarators, nextSeen))
  }

  return false
}

/**
 * Знаходить підстановки `IN (${expr})` у TemplateLiteral, де `expr` не пройшов числовий парсер.
 *
 * Навіть у безпечному `pool.request().query\`...\`` краще явно парсити значення (parseInt/
 * Number/BigInt/parseFloat) та фільтрувати NaN — це гарантує, що жодний елемент не може
 * містити SQL-метасимволи, навіть якщо колись query-функція або обгортка зміняться. У
 * небезпечних контекстах (наприклад `pool.query(String.raw\`...\`)`) це єдиний бар'єр від SQL
 * injection.
 *
 * Випадки `${arr.join(',')}` свідомо ігноруються — їх ловить
 * {@link findUnsafeMssqlDynamicSqlListInText}.
 *
 * @param {string} content вихідний код
 * @param {string} [virtualPath] шлях для вибору `lang`
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
  walkAstWithAncestors(result.program, [], node => {
    if (node.type !== 'TemplateLiteral') return
    const quasis = node.quasis
    const expressions = node.expressions
    if (!Array.isArray(quasis) || !Array.isArray(expressions) || expressions.length === 0) return

    for (let i = 0; i < expressions.length; i++) {
      const q = quasis[i]
      const rawText =
        q && typeof q === 'object' && q.value && typeof q.value === 'object' && typeof q.value.raw === 'string'
          ? q.value.raw
          : ''
      if (!IN_PLACEHOLDER_END_RE.test(rawText)) continue

      const expr = expressions[i]
      if (!expr || typeof expr !== 'object') continue
      if (isJoinCall(expr)) continue
      if (isInListExpressionParsed(expr, declarators)) continue

      const startOffset = typeof expr.start === 'number' ? expr.start : node.start
      out.push({
        line: offsetToLine(content, startOffset),
        snippet: normalizeSnippet(content.slice(node.start, node.end))
      })
    }
  })

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


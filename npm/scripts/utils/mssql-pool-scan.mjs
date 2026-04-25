/**
 * Знаходить небезпечні патерни використання `mssql`, які створюють підключення/пул
 * всередині функцій (наприклад handler на кожен запит), замість того щоб мати один
 * singleton `sql.ConnectionPool` на рівні модуля та повторно використовувати його.
 *
 * Також знаходить небезпечний виклик `query(\`...\`)` — це НЕ tagged template, а звичайний
 * виклик з інтерполяцією рядка, який може призвести до SQL injection. Натомість має
 * використовуватись tagged template `query\`...\`` (див. js-mssql.mdc).
 *
 * Семантика береться з **oxc-parser** по AST, щоб не покладатися на regex.
 * Якщо файл не парситься або містить синтаксичні помилки — повертаємо порожній
 * результат (спочатку треба полагодити синтаксис, потім перезапустити перевірку).
 */
import { parseSync } from 'oxc-parser'

const SOURCE_FILE_RE = /\.([cm]?[jt]sx?)$/

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
 * Чи сканувати цей файл за розширенням (JS/TS-сім'я).
 * @param {string} relativePathPosix відносний шлях (posix)
 * @returns {boolean} `true`, якщо розширення підходить для AST-скану
 */
export function isMssqlScanSourceFile(relativePathPosix) {
  return SOURCE_FILE_RE.test(relativePathPosix) && !relativePathPosix.endsWith('.d.ts')
}


/**
 * Спільні утиліти для AST-сканерів JS/TS на oxc-parser:
 * вибір мови за розширенням, переклад зміщення в номер рядка, стиснення сніпета,
 * обхід AST з предками, парсинг програми з безпечним поверненням `null`,
 * розпізнавання типових вузлів (функцій, `*.join(...)`),
 * робота з `TemplateLiteral` (текст quasis, контекст SQL-списку).
 *
 * Використовується сканерами у `rules/<rule>/js/...` (наприклад,
 * `@7n/rules-lang-js`: rules/js-bun-db, rules/js-mssql, rules/js-run —
 * фаза 5c spec lang-plugins-extraction) для уникнення дублювання boilerplate.
 */
import { parseSync } from 'oxc-parser'

const SQL_LIST_CONTEXT_RE = /\b(in|values)\b\s*\(/iu

/**
 * Мова для Oxc за шляхом файлу (розширення).
 * @param {string} filePath віртуальний або реальний шлях до файлу
 * @returns {'js' | 'jsx' | 'ts' | 'tsx'} значення опції `lang` для `parseSync`
 */
export function langFromPath(filePath) {
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
export function offsetToLine(content, offset) {
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
export function normalizeSnippet(s) {
  return s.replaceAll(/\s+/gu, ' ').trim().slice(0, 180)
}

/**
 * Чи є вузол функцією.
 * @param {unknown} node AST node
 * @returns {boolean} true, якщо це будь-який вузол-функція
 */
export function isFunctionNode(node) {
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
export function walkAstWithAncestors(node, ancestors, visit) {
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
 * Парсить файл і повертає `program` або null, якщо є синтаксичні помилки чи виняток.
 * @param {string} content вихідний код
 * @param {string} virtualPath шлях для вибору `lang` (також для діагностики)
 * @returns {unknown | null} `result.program` або null, якщо парсинг не вдався
 */
export function parseProgramOrNull(content, virtualPath) {
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
 * Парсить файл і повертає `{ program, comments }` або null. Окремий вхід для перевірок,
 * яким потрібні коментарі (наприклад, маркер `// allow-unsafe: ...` біля виклику) —
 * базовий `parseProgramOrNull` свідомо лишається без коментарів, щоб не змінювати API.
 * @param {string} content вихідний код
 * @param {string} virtualPath шлях для вибору `lang` (також для діагностики)
 * @returns {{ program: unknown, comments: { type: 'Line' | 'Block', value: string, start: number, end: number }[] } | null} `program` + список коментарів, або `null` якщо парсер віддав помилки/exception
 */
export function parseProgramAndCommentsOrNull(content, virtualPath) {
  const lang = langFromPath(virtualPath || 'scan.ts')
  let result
  try {
    result = parseSync(virtualPath || 'scan.ts', content, { lang, sourceType: 'module' })
  } catch {
    return null
  }
  if (result.errors?.length) return null
  return {
    program: result.program,
    comments: Array.isArray(result.comments) ? result.comments : []
  }
}

/**
 * Чи це `.join(...)` виклик (типово для динамічних списків у SQL).
 * @param {unknown} node AST node
 * @returns {boolean} true, якщо це CallExpression `*.join(...)`
 */
export function isJoinCall(node) {
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
export function templateQuasisText(template) {
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
export function isSqlListContextTemplate(template) {
  return SQL_LIST_CONTEXT_RE.test(templateQuasisText(template))
}

/**
 * Перевіряє, чи це виклик `require('<module>')` з рядковим аргументом.
 * Спільне для сканерів імпортів (`bunyan-imports`, `redis-imports`, ...).
 * @param {Record<string, unknown> | null | undefined} node вузол AST
 * @returns {string | null} ім'я модуля з аргументу, інакше `null`
 */
export function requireCallModule(node) {
  if (!node || node.type !== 'CallExpression') return null
  const callee = node.callee
  if (!callee || callee.type !== 'Identifier' || callee.name !== 'require') return null
  const arg = node.arguments?.[0]
  if (!arg || arg.type !== 'Literal' || typeof arg.value !== 'string') return null
  return arg.value
}

/**
 * Перевіряє, чи це динамічний `import('<module>')` з рядковим аргументом.
 * Спільне для сканерів імпортів.
 * @param {Record<string, unknown> | null | undefined} node вузол AST
 * @returns {string | null} ім'я модуля, інакше `null`
 */
export function dynamicImportModule(node) {
  if (!node || node.type !== 'ImportExpression') return null
  const src = node.source
  if (!src || src.type !== 'Literal' || typeof src.value !== 'string') return null
  return src.value
}

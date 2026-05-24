/**
 * AST-сканер небезпечних патернів Bun SQL (`import { sql, SQL } from 'bun'`).
 *
 * Знаходить:
 * - `new SQL(...)` всередині функції — пул має бути singleton на рівні модуля,
 *   а не на кожен виклик handler-а.
 * - Будь-який виклик `<obj>.unsafe(...)` без маркера-коментаря `// allow-unsafe: <reason>`
 *   на тому ж рядку або рядком вище. `sql.unsafe` за замовчуванням заборонено: дозволено
 *   тільки якщо значення контролюється кодом (не user input) і потрібно підставити
 *   назву таблиці/колонки або dynamic SQL/DDL. Інакше — переробити на tagged template
 *   `sql\`...\${value}...\``. Маркер фіксує цю причину для ревʼюера.
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
  parseProgramAndCommentsOrNull,
  parseProgramOrNull,
  templateQuasisText,
  walkAstWithAncestors
} from '../../../scripts/utils/ast-scan-utils.mjs'

const SOURCE_FILE_RE = /\.([cm]?[jt]sx?)$/u
const BUN_SQL_IMPORT_RE = /\bimport\s*\{[\s\S]*?\b(sql|SQL)\b[\s\S]*?\}\s*from\s*["']bun["']/u
// Імпорт із npm-пакета `pg` — будь-яка з форм: default, named, namespace, side-effect,
// а також `require('pg')`. `pg-format`/`pg-pool` свідомо НЕ матчаться: на них діє
// окрема заборона (denylist) і свої повідомлення. Виключення для LISTEN/NOTIFY
// стосується лише самого клієнта `pg`.
const PG_LIB_IMPORT_RE = /(?:\bimport\b[\s\S]*?\bfrom\s*["']pg["']|\brequire\s*\(\s*["']pg["']\s*\))/u
// Першоквазі-рядок або string literal, що починається з LISTEN / UNLISTEN / NOTIFY
// (case-insensitive), з опційним leading whitespace. Сигнал, що в коді запит
// `LISTEN ch` / `NOTIFY ch, 'msg'` / `UNLISTEN *` — це функціонал, якого Bun SQL
// поки не має, тож у проекті лишається легітимна потреба у клієнті `pg`.
const PG_LISTEN_NOTIFY_SQL_RE = /^\s*(LISTEN|UNLISTEN|NOTIFY)\b/iu
const IN_PLACEHOLDER_END_RE = /\bin\s*(\(\s*)?$/iu
// `// allow-unsafe: <reason>` — `allow-unsafe`, двокрапка, **непорожня** причина.
// Без причини маркер не приймається: ціль — лишити слід для ревʼюера, а не «німий» прапорець.
const ALLOW_UNSAFE_MARKER_RE = /\ballow-unsafe\s*:\s*\S+/u
// `// allow-pg-leftover: <reason>` — opt-in для виправданих `.connect()` / `.end()`
// у файлах з Bun SQL (наприклад, `sql.end()` у graceful shutdown або `.connect()`
// на сторонньому об'єкті, що випадково ділить імʼя методу з `pg`).
const ALLOW_PG_LEFTOVER_MARKER_RE = /\ballow-pg-leftover\s*:\s*\S+/u
// pg-API, які не потрібні з Bun SQL: pool/client життєвий цикл вручну.
// `release` не входить — Bun SQL такого методу не має, а `.connect()` / `.end()`
// формально існують і там, тому опт-аут маркером лишається доречним.
const PG_LEFTOVER_METHOD_NAMES = new Set(['connect', 'end'])

// pg-format placeholders — `%L` (literal), `%I` (identifier), `%s` (raw string).
// Якщо у тілі функції з підозрілим іменем зустрічається такий літерал/regex —
// це pg-format-сумісний шим (drop-in замінник pg-format поверх Bun SQL).
const PG_FORMAT_PLACEHOLDER_RE = /%[LIs]/u
// Імена функцій-кандидатів на pg-format-шим. Спрацьовує лише у поєднанні
// з наявністю `%L` / `%I` / `%s` у тілі — щоб не плутати з невинним `format(date)`.
const PG_FORMAT_SHIM_FUNC_NAMES = new Set(['format', 'pgFormat', 'sqlFormat', 'pgFmt'])
// Імена quote/escape-хелперів — самі по собі сильний сигнал pg-format-шиму,
// без додаткової перевірки тіла. Це pg-format-специфічні API, нерідко публікуються
// як named export з модуля-обгортки.
const QUOTE_HELPER_NAMES = new Set(['quoteLiteral', 'quoteIdent', 'escapeLiteral', 'escapeIdent'])

// Імена першого параметра pg-style query-обгортки (`function query(text, params)` тощо).
const PG_QUERY_FIRST_PARAM_RE = /^(text|sql|query)$/u

/**
 * @param {unknown} node AST node
 * @param {string} name імʼя змінної
 * @returns {boolean} true, якщо це MemberExpression `${name}.length`
 */
function isLengthMember(node, name) {
  return (
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
  )
}

/**
 * @param {unknown} node AST node
 * @returns {boolean} true, якщо це числовий 0-літерал
 */
function isZeroNumberLiteral(node) {
  return (
    !!node &&
    typeof node === 'object' &&
    ((node.type === 'NumericLiteral' && node.value === 0) || (node.type === 'Literal' && node.value === 0))
  )
}

/**
 * @param {unknown} node AST node
 * @returns {boolean} true, якщо це Identifier з імʼям `sql`
 */
function isSqlHelperIdentifier(node) {
  return !!node && typeof node === 'object' && node.type === 'Identifier' && node.name === 'sql'
}

/**
 * Витягає імʼя змінної списку для `IN ...`:
 * - `${ids}` → `ids`
 * - `${sql(ids)}` → `ids`
 * @param {unknown} expr template expression
 * @returns {{ name: string } | { error: 'not_var' } | { error: 'sql_helper_not_var' }} імʼя змінної або причина відмови
 */
function extractInListVarNameFromExpr(expr) {
  if (!expr || typeof expr !== 'object') return { error: 'not_var' }
  if (expr.type === 'Identifier' && typeof expr.name === 'string') return { name: expr.name }

  if (expr.type === 'CallExpression' && isSqlHelperIdentifier(expr.callee)) {
    const args = expr.arguments
    if (!Array.isArray(args) || args.length === 0) return { error: 'sql_helper_not_var' }
    const first = args[0]
    if (first && typeof first === 'object' && first.type === 'Identifier' && typeof first.name === 'string') {
      return { name: first.name }
    }
    return { error: 'sql_helper_not_var' }
  }

  return { error: 'not_var' }
}

/**
 * Чи містить тест if-умови перевірку “список порожній”.
 * Підтримує базові форми:
 * - `if (!ids.length) ...`
 * - `if (ids.length === 0) ...` / `<= 0` / `< 1`
 * @param {unknown} test IfStatement.test
 * @param {string} name імʼя змінної списку
 * @returns {boolean} true, якщо це перевірка на пустоту списку
 */
function isEmptyListTest(test, name) {
  if (!test || typeof test !== 'object') return false

  if (test.type === 'UnaryExpression' && test.operator === '!') {
    const arg = test.argument
    if (!arg || typeof arg !== 'object') return false
    return isLengthMember(arg, name)
  }

  if (test.type === 'BinaryExpression') {
    const { left, right, operator } = test
    if (!['===', '==', '<=', '<'].includes(operator)) return false
    if (isLengthMember(left, name) && isZeroNumberLiteral(right)) return true
    // допускаємо `0 === ids.length` теж
    if (isZeroNumberLiteral(left) && isLengthMember(right, name) && (operator === '===' || operator === '=='))
      return true
  }

  return false
}

/**
 * Чи є в consequent (або в його BlockStatement) ThrowStatement.
 * @param {unknown} consequent IfStatement.consequent
 * @returns {boolean} true, якщо consequent містить throw
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
 * @returns {boolean} true, якщо guard знайдено
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
 * @returns {{ block: unknown, index: number } | null} block+індекс statement або null
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
 * Чи це виклик `<obj>.unsafe(...)` (будь-який обʼєкт, не тільки `sql`).
 * Файл сканується лише якщо є `import { sql|SQL } from 'bun'`, тож у практиці це
 * або `sql.unsafe`, або `tx.unsafe` всередині `sql.begin(async tx => ...)` —
 * обидва однаково небезпечні, тому розрізняти імʼя обʼєкта не треба.
 * @param {unknown} node AST node
 * @returns {boolean} true для будь-якого `<obj>.unsafe(...)`
 */
function isUnsafeCall(node) {
  if (!node || node.type !== 'CallExpression') return false
  const callee = node.callee
  if (!callee || callee.type !== 'MemberExpression' || callee.computed) return false
  const prop = callee.property
  return !!prop && prop.type === 'Identifier' && prop.name === 'unsafe'
}

/**
 * Чи є біля виклику маркер-коментар, що матчиться на `markerRe`, на тому ж рядку,
 * що й початок виклику, або на рядку, що передує початку виклику. Це навмисно строга
 * суміжність: відірваний коментар через порожній рядок не зараховується — щоб маркер
 * стояв саме біля виклику, а не «загубився десь вище».
 *
 * Використовується для opt-in маркерів типу `// allow-unsafe: ...` і `// allow-pg-leftover: ...`.
 * @param {{ start: number }} callNode виклик
 * @param {{ type: 'Line' | 'Block', value: string, start: number, end: number }[]} comments коментарі з парсера
 * @param {string} content вихідний код
 * @param {RegExp} markerRe регекс, що валідує текст маркера в `comment.value`
 * @returns {boolean} true, якщо маркер знайдено
 */
function hasMarkerCommentNear(callNode, comments, content, markerRe) {
  const callStartLine = offsetToLine(content, callNode.start)
  for (const c of comments) {
    if (!c || (c.type !== 'Line' && c.type !== 'Block')) continue
    if (typeof c.value !== 'string' || !markerRe.test(c.value)) continue
    const startLine = offsetToLine(content, c.start)
    const endLine = offsetToLine(content, c.end)
    // trailing-коментар на тому ж рядку (`<call> // marker: ...`)
    if (startLine === callStartLine) return true
    // коментар на рядку, що безпосередньо передує виклику — для блокових
    // коментарів важливим є саме `endLine`, бо block може займати кілька рядків.
    if (endLine === callStartLine - 1) return true
  }
  return false
}

/**
 * Чи це pg-leftover виклик: `<obj>.connect(...)` або `<obj>.end(...)`. Bun SQL пулом
 * керує сам — і `.connect()`, і `.end()` у файлах з Bun SQL зазвичай зайві, тож такі
 * виклики прапоруються (з opt-in маркером для рідкісних легітимних випадків).
 * @param {unknown} node AST node
 * @returns {{ name: 'connect' | 'end' } | null} ім'я pg-leftover методу або null
 */
function asPgLeftoverCall(node) {
  if (!node || node.type !== 'CallExpression') return null
  const callee = node.callee
  if (!callee || callee.type !== 'MemberExpression' || callee.computed) return null
  const prop = callee.property
  if (!prop || prop.type !== 'Identifier' || typeof prop.name !== 'string') return null
  if (!PG_LEFTOVER_METHOD_NAMES.has(prop.name)) return null
  return { name: /** @type {'connect' | 'end'} */ (prop.name) }
}

// Локальний alias на `isUnsafeCall` — щоб у nodeContainsUnsafeCall (під query-шимом)
// був семантично-говорящий call-site, але без дубля логіки з основним сканом.
const isUnsafeCallNode = isUnsafeCall

/**
 * Витягує ім'я ключа з AST `Property.key`. Підтримує `Identifier` (`{ foo: … }`)
 * та `Literal` (`{ 'foo': … }` / `{ 5: … }`); інші форми (computed expression тощо) — `null`.
 * @param {unknown} key AST `Property.key`
 * @returns {string | number | null} ім'я ключа або null
 */
function propertyKeyName(key) {
  if (!key || typeof key !== 'object') return null
  if (key.type === 'Identifier' && typeof key.name === 'string') return key.name
  if (key.type === 'Literal' && (typeof key.value === 'string' || typeof key.value === 'number')) return key.value
  return null
}

/**
 * Чи містить піддерево вузла рядковий або regex-літерал з `%L` / `%I` / `%s`.
 * Покриває:
 * - `Literal` зі строковим `value`,
 * - `StringLiteral` (oxc),
 * - `TemplateLiteral` (через текст quasis),
 * - `RegExpLiteral` / `Literal` з `regex.pattern`.
 * @param {unknown} root корінь піддерева (зазвичай тіло функції)
 * @returns {boolean} true, якщо знайдено pg-format-плейсхолдер
 */
function nodeContainsPgFormatPlaceholder(root) {
  let found = false
  walkAstWithAncestors(root, [], n => {
    if (found) return
    const t = n.type
    if (t === 'Literal' || t === 'StringLiteral') {
      if (typeof n.value === 'string' && PG_FORMAT_PLACEHOLDER_RE.test(n.value)) {
        found = true
        return
      }
      const regex = n.regex
      if (regex && typeof regex.pattern === 'string' && PG_FORMAT_PLACEHOLDER_RE.test(regex.pattern)) {
        found = true
        return
      }
    }
    if (t === 'RegExpLiteral' && typeof n.pattern === 'string' && PG_FORMAT_PLACEHOLDER_RE.test(n.pattern)) {
      found = true
      return
    }
    if (t === 'TemplateLiteral' && PG_FORMAT_PLACEHOLDER_RE.test(templateQuasisText(n))) {
      found = true
    }
  })
  return found
}

/**
 * Витягає (name, body) з вузла, що оголошує функцію верхнього рівня:
 * - `function format(...) {...}`,
 * - `const format = (...) => {...}` / `= function(...) {...}`.
 * @param {Record<string, unknown>} node AST node
 * @returns {{ name: string, body: unknown } | null} ім'я та тіло, або null
 */
function asNamedFunctionDecl(node) {
  if (node.type === 'FunctionDeclaration' && node.id?.type === 'Identifier') {
    return { name: node.id.name, body: node.body }
  }
  if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier') {
    const init = node.init
    if (init && (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression')) {
      return { name: node.id.name, body: init.body }
    }
  }
  return null
}

/**
 * Знаходить визначення pg-format-сумісних шимів у джерелі. Прапорує:
 * - функції з іменами `format` / `pgFormat` / `sqlFormat` / `pgFmt`, у тілі яких
 *   зустрічається літерал/regex з `%L` / `%I` / `%s` — це drop-in pg-format;
 * - функції з іменами `quoteLiteral` / `quoteIdent` / `escapeLiteral` / `escapeIdent`
 *   незалежно від тіла — це pg-format-специфічні API, не потрібні з Bun SQL.
 *
 * Скан запускається лише в файлах, де є `import { sql|SQL } from 'bun'`, щоб
 * не плутати, наприклад, форматер дат чи URL-escape з SQL-шимом.
 * @param {string} content вихідний код
 * @param {string} [virtualPath] шлях для вибору `lang`
 * @returns {{ line: number, snippet: string, kind: 'format_function' | 'quote_helper', name: string }[]} список порушень
 */
export function findPgFormatShimDefinitionInText(content, virtualPath = 'scan.ts') {
  if (!textHasBunSqlImport(content)) return []
  const program = parseProgramOrNull(content, virtualPath)
  if (!program) return []

  /** @type {{ line: number, snippet: string, kind: 'format_function' | 'quote_helper', name: string }[]} */
  const out = []
  walkAstWithAncestors(program, [], node => {
    const decl = asNamedFunctionDecl(node)
    if (!decl) return
    /** @type {'format_function' | 'quote_helper' | null} */
    let kind = null
    if (QUOTE_HELPER_NAMES.has(decl.name)) {
      kind = 'quote_helper'
    } else if (PG_FORMAT_SHIM_FUNC_NAMES.has(decl.name) && nodeContainsPgFormatPlaceholder(decl.body)) {
      kind = 'format_function'
    }
    if (!kind) return
    out.push({
      line: offsetToLine(content, node.start),
      snippet: normalizeSnippet(content.slice(node.start, Math.min(node.end, node.start + 240))),
      kind,
      name: decl.name
    })
  })
  return out
}

/**
 * Знаходить pg-сумісні query-обгортки виду
 * `{ query(text, params) { return <sql>.unsafe(text, params) } }`
 * у файлах, що імпортують Bun SQL. Така обгортка маскує `unsafe` під
 * «безпечним» ім'ям і повертає injection-поверхню в код.
 *
 * Спрацьовує, коли всі умови виконані:
 * - вузол — `Property` з `key.name === 'query'` всередині `ObjectExpression`;
 * - значення — функція з 1–2 параметрами, перший — Identifier з типовим
 *   pg-іменем (`text` / `sql` / `query`);
 * - у тілі функції є виклик `<obj>.unsafe(...)`.
 * @param {string} content вихідний код
 * @param {string} [virtualPath] шлях для вибору `lang`
 * @returns {{ line: number, snippet: string }[]} список порушень
 */
export function findPgFormatLikeQueryWrapperInText(content, virtualPath = 'scan.ts') {
  if (!textHasBunSqlImport(content)) return []
  const program = parseProgramOrNull(content, virtualPath)
  if (!program) return []

  /** @type {{ line: number, snippet: string }[]} */
  const out = []
  walkAstWithAncestors(program, [], node => {
    if (node.type !== 'ObjectExpression' || !Array.isArray(node.properties)) return
    for (const prop of node.properties) {
      const queryProp = asPgFormatLikeQueryProp(prop)
      if (!queryProp) continue
      out.push({
        line: offsetToLine(content, queryProp.start),
        snippet: normalizeSnippet(content.slice(queryProp.start, queryProp.end))
      })
    }
  })
  return out
}

/**
 * Чи є цей вузол `Property` тим самим pg-сумісним `{ query(text, params) { … unsafe … } }`?
 * Повертає сам `prop` (для зручного `start`/`end`) або `null`.
 * @param {unknown} prop AST вузол `Property`
 * @returns {{ start: number, end: number } | null} `prop` як власний рекорд або `null`
 */
function asPgFormatLikeQueryProp(prop) {
  if (!prop || typeof prop !== 'object' || prop.type !== 'Property') return null
  if (propertyKeyName(prop.key) !== 'query') return null
  const value = prop.value
  if (!value || (value.type !== 'FunctionExpression' && value.type !== 'ArrowFunctionExpression')) return null
  if (!hasPgQuerySignature(value.params)) return null
  if (!nodeContainsUnsafeCall(value.body)) return null
  return { start: prop.start, end: prop.end }
}

/**
 * Чи виглядає сигнатура функції як pg-style `query(text, params?)`: 1–2 параметри,
 * перший — Identifier з типовим pg-іменем (`text` / `sql` / `query`).
 * @param {unknown} params AST `params` (масив)
 * @returns {boolean} true, якщо схоже на pg-обгортку
 */
function hasPgQuerySignature(params) {
  if (!Array.isArray(params) || params.length < 1 || params.length > 2) return false
  const first = params[0]
  if (!first || first.type !== 'Identifier' || typeof first.name !== 'string') return false
  return PG_QUERY_FIRST_PARAM_RE.test(first.name)
}

/**
 * Чи є у піддереві виклик `<obj>.unsafe(...)`.
 * @param {unknown} root корінь піддерева
 * @returns {boolean} true, якщо знайдено
 */
function nodeContainsUnsafeCall(root) {
  let found = false
  walkAstWithAncestors(root, [], n => {
    if (found) return
    if (isUnsafeCallNode(n)) found = true
  })
  return found
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
 * Знаходить виклики `<obj>.unsafe(...)` без маркера-коментаря `// allow-unsafe: <reason>`
 * на тому ж рядку або рядком вище. `sql.unsafe` за замовчуванням заборонено: дозволено
 * лише коли значення контролюється кодом (не user input) і потрібно підставити те, що
 * не можна параметризувати — назву таблиці/колонки або dynamic SQL/DDL. У всіх інших
 * випадках — переробити на tagged template виду `sql` із інтерполяцією значень.
 * Маркер-коментар фіксує причину для ревʼюера й одночасно слугує opt-in: без нього
 * перевірка падає, навіть якщо у `unsafe` лежить статичний рядок без інтерполяції.
 * @param {string} content вихідний код
 * @param {string} [virtualPath] шлях для вибору `lang`
 * @returns {{ line: number, snippet: string }[]} список порушень
 */
export function findBunSqlUnsafeUseWithoutAllowMarkerInText(content, virtualPath = 'scan.ts') {
  const parsed = parseProgramAndCommentsOrNull(content, virtualPath)
  if (!parsed) return []
  const { program, comments } = parsed

  /** @type {{ line: number, snippet: string }[]} */
  const out = []
  walkAstWithAncestors(program, [], node => {
    if (!isUnsafeCall(node)) return
    if (hasMarkerCommentNear(node, comments, content, ALLOW_UNSAFE_MARKER_RE)) return
    out.push({
      line: offsetToLine(content, node.start),
      snippet: normalizeSnippet(content.slice(node.start, node.end))
    })
  })
  return out
}

/**
 * Знаходить `<obj>.unsafe(template_literal_with_interpolation)` — навіть із маркером
 * `// allow-unsafe`. Шаблонна підстановка `${name}` у `sql.unsafe`-рядок **не екранує**
 * identifier'ів (reserved words, спецсимволи) і ніяк не біндить значення — це
 * структурна injection-поверхня, яку легко не помітити в ревʼю. Канон — побудувати
 * `text` через `@scaleleap/pg-format` `format('%I', name)` (для identifiers) або
 * звичайні позиційні `$N`-placeholder'и (для values), і передати в `sql.unsafe(text, [params])`.
 *
 * Прапорує саме `TemplateLiteral` з `expressions.length > 0`; статичні рядки
 * (`Literal`, `StringLiteral`, `TemplateLiteral` без `${...}`) і виклики з готовим
 * `text` як змінною — не зачіпає (для них діє основна перевірка allow-unsafe).
 * @param {string} content вихідний код
 * @param {string} [virtualPath] шлях для вибору `lang`
 * @returns {{ line: number, snippet: string }[]} список порушень
 */
export function findBunSqlUnsafeWithInterpolatedTemplateInText(content, virtualPath = 'scan.ts') {
  const program = parseProgramOrNull(content, virtualPath)
  if (!program) return []

  /** @type {{ line: number, snippet: string }[]} */
  const out = []
  walkAstWithAncestors(program, [], node => {
    if (!isUnsafeCall(node)) return
    const args = node.arguments
    if (!Array.isArray(args) || args.length === 0) return
    const first = args[0]
    if (!first || first.type !== 'TemplateLiteral') return
    const expressions = first.expressions
    if (!Array.isArray(expressions) || expressions.length === 0) return
    out.push({
      line: offsetToLine(content, node.start),
      snippet: normalizeSnippet(content.slice(node.start, node.end))
    })
  })
  return out
}

/**
 * Знаходить pg-leftover виклики `<obj>.connect(...)` / `<obj>.end(...)` без маркера
 * `// allow-pg-leftover: <reason>` у файлах, де **в цьому ж файлі** є `import { sql|SQL } from 'bun'`.
 *
 * Скоп навмисно вузький: ці метод-імена занадто загальні (WebSocket, Stream, інші бібліотеки),
 * тож сканер обмежений файлами, що вже використовують Bun SQL — там pg-залишок є явним
 * багом міграції. У не-Bun-SQL файлах прапоратися не буде, навіть якщо проєкт у цілому
 * мігрував.
 * @param {string} content вихідний код
 * @param {string} [virtualPath] шлях для вибору `lang`
 * @returns {{ line: number, snippet: string, methodName: 'connect' | 'end' }[]} список порушень
 */
export function findBunSqlPgLeftoverCallInText(content, virtualPath = 'scan.ts') {
  if (!textHasBunSqlImport(content)) return []
  const parsed = parseProgramAndCommentsOrNull(content, virtualPath)
  if (!parsed) return []
  const { program, comments } = parsed

  /** @type {{ line: number, snippet: string, methodName: 'connect' | 'end' }[]} */
  const out = []
  walkAstWithAncestors(program, [], node => {
    const m = asPgLeftoverCall(node)
    if (!m) return
    if (hasMarkerCommentNear(node, comments, content, ALLOW_PG_LEFTOVER_MARKER_RE)) return
    out.push({
      line: offsetToLine(content, node.start),
      snippet: normalizeSnippet(content.slice(node.start, node.end)),
      methodName: m.name
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
 * Збирає порушення для одного TemplateLiteral вузла: `IN ... ${...}` потребує
 * змінної + guard `if (empty) throw`.
 * @param {Record<string, unknown>} template TemplateLiteral
 * @param {unknown[]} ancestors ancestors з walkAstWithAncestors
 * @param {string} content вихідний код
 * @param {{ line: number, snippet: string, reason: 'not_var' | 'sql_helper_not_var' | 'missing_guard', name?: string }[]} out буфер результатів
 */
function collectInListGuardViolationsFromTemplate(template, ancestors, content, out) {
  const expressions = template.expressions
  const quasis = template.quasis
  if (!Array.isArray(expressions) || expressions.length === 0) return
  if (!Array.isArray(quasis) || quasis.length === 0) return

  for (const [i, expr] of expressions.entries()) {
    const q = quasis[i]
    const raw =
      q && typeof q === 'object' && q.value && typeof q.value === 'object' && typeof q.value.raw === 'string'
        ? q.value.raw
        : ''
    if (!IN_PLACEHOLDER_END_RE.test(raw)) continue

    const extracted = extractInListVarNameFromExpr(expr)
    if ('error' in extracted) {
      out.push({
        line: offsetToLine(content, template.start),
        snippet: normalizeSnippet(content.slice(template.start, template.end)),
        reason: extracted.error
      })
      continue
    }

    const place = findEnclosingBlockAndStatementIndex(ancestors)
    if (!place || !hasEmptyGuardBefore(place.block, place.index, extracted.name)) {
      out.push({
        line: offsetToLine(content, template.start),
        snippet: normalizeSnippet(content.slice(template.start, template.end)),
        reason: 'missing_guard',
        name: extracted.name
      })
    }
  }
}

/**
 * Знаходить підстановки списків у `IN (...)`, які:
 * - не винесені в окрему змінну (в `${...}` стоїть не Identifier або `sql(<non-Identifier>)`);
 * - або винесені, але перед запитом немає перевірки на пустоту з `throw`.
 * @param {string} content вихідний код
 * @param {string} [virtualPath] шлях для вибору `lang`
 * @returns {{ line: number, snippet: string, reason: 'not_var' | 'sql_helper_not_var' | 'missing_guard', name?: string }[]} список порушень
 */
export function findUnsafeBunSqlInListMissingEmptyGuardInText(content, virtualPath = 'scan.ts') {
  const program = parseProgramOrNull(content, virtualPath)
  if (!program) return []

  /** @type {{ line: number, snippet: string, reason: 'not_var' | 'sql_helper_not_var' | 'missing_guard', name?: string }[]} */
  const out = []

  walkAstWithAncestors(program, [], (node, ancestors) => {
    /** @type {unknown} */
    let template = null
    if (node.type === 'TemplateLiteral') {
      template = node
    } else if (node.type === 'TaggedTemplateExpression') {
      template = node.quasi
    }

    if (!template || typeof template !== 'object' || template.type !== 'TemplateLiteral') return
    if (!isSqlListContextTemplate(template)) return
    collectInListGuardViolationsFromTemplate(template, ancestors, content, out)
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
 * Чи імпортує файл npm-пакет `pg` (`import ... from 'pg'` або `require('pg')`).
 * Текстова перевірка — без AST, дешевий pre-filter; для строгої локалізації
 * (рядок/snippet) використай `findPgLibImportInText`. Не матчить `pg-format`,
 * `pg-pool`, `@types/pg` — лише сам клієнт.
 * @param {string} content вміст файлу
 * @returns {boolean} true, якщо у файлі є імпорт `'pg'`
 */
export function textHasPgLibImport(content) {
  return PG_LIB_IMPORT_RE.test(content)
}

/**
 * Знаходить ImportDeclaration / CallExpression `require('pg')` для пакета `pg`
 * (саме точна назва, не `pg-format` тощо). Повертає рядок і snippet — щоб у
 * повідомленнях `fail` показати конкретне місце.
 * @param {string} content вихідний код
 * @param {string} [virtualPath] шлях для вибору `lang`
 * @returns {{ line: number, snippet: string }[]} список місць, де імпортується `pg`
 */
export function findPgLibImportInText(content, virtualPath = 'scan.ts') {
  const program = parseProgramOrNull(content, virtualPath)
  if (!program) return []

  /** @type {{ line: number, snippet: string }[]} */
  const out = []
  walkAstWithAncestors(program, [], node => {
    if (node.type === 'ImportDeclaration' && getStringLiteralValue(node.source) === 'pg') {
      out.push({
        line: offsetToLine(content, node.start),
        snippet: normalizeSnippet(content.slice(node.start, node.end))
      })
      return
    }
    if (node.type === 'CallExpression' && isRequireOfModule(node, 'pg')) {
      out.push({
        line: offsetToLine(content, node.start),
        snippet: normalizeSnippet(content.slice(node.start, node.end))
      })
    }
  })
  return out
}

/**
 * Знаходить використання PostgreSQL LISTEN/NOTIFY у коді — сигнал, що проект
 * потребує `pg` як виняток (Bun SQL поки не реалізує LISTEN/NOTIFY). Прапорує:
 * - `<obj>.query(...)` / `<obj>.queryArray(...)` / `<obj>.queryStream(...)`, де
 *   перший аргумент — string literal або template literal, що починається з
 *   `LISTEN ` / `UNLISTEN ` / `NOTIFY ` (case-insensitive);
 * - `<obj>.on('notification', ...)` — pg-listener notification-подій (другий
 *   аргумент — функція; перший — точно рядок `'notification'`);
 * - TaggedTemplateExpression виду sql tagged template з LISTEN/UNLISTEN/NOTIFY
 *   на початку першого quasi — на випадок, якщо хтось використовує Bun
 *   SQL-tagged-template, а LISTEN/NOTIFY все одно лишається у тексті запиту
 *   (це не запрацює у Bun SQL, але як сигнал — приймаємо).
 *
 * Регістр SQL-слів не важливий, провідні пробіли допускаються.
 * @param {string} content вихідний код
 * @param {string} [virtualPath] шлях для вибору `lang`
 * @returns {{ line: number, snippet: string, kind: 'listen_sql' | 'notify_sql' | 'unlisten_sql' | 'notification_listener' }[]} список знахідок
 */
export function findPgListenNotifyUsageInText(content, virtualPath = 'scan.ts') {
  const program = parseProgramOrNull(content, virtualPath)
  if (!program) return []

  /** @type {{ line: number, snippet: string, kind: 'listen_sql' | 'notify_sql' | 'unlisten_sql' | 'notification_listener' }[]} */
  const out = []
  walkAstWithAncestors(program, [], node => {
    const fromCall = listenNotifyFromCallExpression(node)
    if (fromCall) {
      out.push({
        line: offsetToLine(content, node.start),
        snippet: normalizeSnippet(content.slice(node.start, node.end)),
        kind: fromCall
      })
      return
    }
    const fromTagged = listenNotifyFromTaggedTemplate(node)
    if (fromTagged) {
      out.push({
        line: offsetToLine(content, node.start),
        snippet: normalizeSnippet(content.slice(node.start, node.end)),
        kind: fromTagged
      })
    }
  })
  return out
}

/**
 * @param {Record<string, unknown>} node ImportDeclaration.source або CallExpression.arguments[0]
 * @returns {string | null} значення string literal або null
 */
function getStringLiteralValue(node) {
  if (!node || typeof node !== 'object') return null
  if ((node.type === 'Literal' || node.type === 'StringLiteral') && typeof node.value === 'string') {
    return node.value
  }
  return null
}

/**
 * Чи це `require('<moduleName>')` — CallExpression з callee Identifier `require`
 * і єдиним string-літералом-аргументом.
 * @param {Record<string, unknown>} node CallExpression
 * @param {string} moduleName очікувана назва модуля (точне співпадіння)
 * @returns {boolean} true, якщо це саме require цього модуля
 */
function isRequireOfModule(node, moduleName) {
  const callee = node.callee
  if (!callee || callee.type !== 'Identifier' || callee.name !== 'require') return false
  const args = node.arguments
  if (!Array.isArray(args) || args.length !== 1) return false
  return getStringLiteralValue(args[0]) === moduleName
}

/**
 * Аналізує CallExpression на предмет pg-style LISTEN/NOTIFY-запиту або listener'а
 * подій `'notification'`. Повертає тип сигналу або `null`.
 * @param {Record<string, unknown>} node AST node
 * @returns {'listen_sql' | 'notify_sql' | 'unlisten_sql' | 'notification_listener' | null} kind знахідки
 */
function listenNotifyFromCallExpression(node) {
  if (!node || node.type !== 'CallExpression') return null
  const callee = node.callee
  if (!callee || callee.type !== 'MemberExpression' || callee.computed) return null
  const prop = callee.property
  if (!prop || prop.type !== 'Identifier' || typeof prop.name !== 'string') return null
  const args = node.arguments
  if (!Array.isArray(args) || args.length === 0) return null

  if (prop.name === 'on') {
    return getStringLiteralValue(args[0]) === 'notification' ? 'notification_listener' : null
  }
  if (prop.name === 'query' || prop.name === 'queryArray' || prop.name === 'queryStream') {
    return sqlStringStartsWithListenNotify(args[0])
  }
  return null
}

/**
 * Аналізує TaggedTemplateExpression: якщо перший quasi починається з
 * LISTEN/UNLISTEN/NOTIFY — повертає відповідний kind.
 * @param {Record<string, unknown>} node AST node
 * @returns {'listen_sql' | 'notify_sql' | 'unlisten_sql' | null} kind знахідки
 */
function listenNotifyFromTaggedTemplate(node) {
  if (!node || node.type !== 'TaggedTemplateExpression') return null
  const quasi = node.quasi
  if (!quasi || quasi.type !== 'TemplateLiteral') return null
  const text = templateQuasisText(quasi)
  return kindFromListenNotifyMatch(text)
}

/**
 * Перший аргумент виклику `.query(...)` — це string literal або template literal,
 * текст якого починається з LISTEN / UNLISTEN / NOTIFY (case-insensitive)?
 * @param {unknown} arg AST node першого аргумента
 * @returns {'listen_sql' | 'notify_sql' | 'unlisten_sql' | null} kind знахідки або null
 */
function sqlStringStartsWithListenNotify(arg) {
  if (!arg || typeof arg !== 'object') return null
  if ((arg.type === 'Literal' || arg.type === 'StringLiteral') && typeof arg.value === 'string') {
    return kindFromListenNotifyMatch(arg.value)
  }
  if (arg.type === 'TemplateLiteral') {
    return kindFromListenNotifyMatch(templateQuasisText(arg))
  }
  return null
}

/**
 * Перетворює текст SQL-рядка у kind знахідки (`listen_sql` / `notify_sql` /
 * `unlisten_sql`) або `null`, якщо рядок не починається з ключового слова.
 * @param {string} text SQL-текст
 * @returns {'listen_sql' | 'notify_sql' | 'unlisten_sql' | null} kind знахідки
 */
function kindFromListenNotifyMatch(text) {
  const m = PG_LISTEN_NOTIFY_SQL_RE.exec(text)
  if (!m) return null
  const keyword = m[1].toUpperCase()
  if (keyword === 'LISTEN') return 'listen_sql'
  if (keyword === 'NOTIFY') return 'notify_sql'
  return 'unlisten_sql'
}

/**
 * Чи сканувати цей файл за розширенням (JS/TS-сімʼя, без `.d.ts`).
 * @param {string} relativePathPosix відносний шлях (posix)
 * @returns {boolean} true, якщо розширення підходить для AST-скану
 */
export function isBunSqlScanSourceFile(relativePathPosix) {
  return SOURCE_FILE_RE.test(relativePathPosix) && !relativePathPosix.endsWith('.d.ts')
}

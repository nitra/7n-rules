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
  walkAstWithAncestors
} from './ast-scan-utils.mjs'

const SOURCE_FILE_RE = /\.([cm]?[jt]sx?)$/u
const BUN_SQL_IMPORT_RE = /\bimport\s*\{[\s\S]*?\b(sql|SQL)\b[\s\S]*?\}\s*from\s*["']bun["']/u
const IN_PLACEHOLDER_END_RE = /\bin\s*(\(\s*)?$/iu
// `// allow-unsafe: <reason>` — `allow-unsafe`, двокрапка, **непорожня** причина.
// Без причини маркер не приймається: ціль — лишити слід для ревʼюера, а не «німий» прапорець.
const ALLOW_UNSAFE_MARKER_RE = /\ballow-unsafe\s*:\s*\S+/u

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
 * Чи є біля виклику `<obj>.unsafe(...)` маркер-коментар `// allow-unsafe: <reason>`
 * (або `/* allow-unsafe: <reason> *\/`) на тому ж рядку, що й початок виклику,
 * або на рядку, що передує початку виклику. Це навмисно строга суміжність:
 * відірваний коментар через порожній рядок не зараховується — щоб маркер
 * стояв саме біля виклику, а не «загубився десь вище».
 * @param {{ start: number }} callNode виклик `<obj>.unsafe(...)`
 * @param {{ type: 'Line' | 'Block', value: string, start: number, end: number }[]} comments коментарі з парсера
 * @param {string} content вихідний код
 * @returns {boolean} true, якщо маркер знайдено
 */
function hasAllowUnsafeMarkerNear(callNode, comments, content) {
  const callStartLine = offsetToLine(content, callNode.start)
  for (const c of comments) {
    if (!c || (c.type !== 'Line' && c.type !== 'Block')) continue
    if (typeof c.value !== 'string' || !ALLOW_UNSAFE_MARKER_RE.test(c.value)) continue
    const startLine = offsetToLine(content, c.start)
    const endLine = offsetToLine(content, c.end)
    // trailing-коментар на тому ж рядку (`sql.unsafe(...) // allow-unsafe: ...`)
    if (startLine === callStartLine) return true
    // коментар на рядку, що безпосередньо передує виклику — для блокових
    // коментарів важливим є саме `endLine`, бо block може займати кілька рядків.
    if (endLine === callStartLine - 1) return true
  }
  return false
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
 * випадках — переробити на tagged template `sql\`...\${value}...\``.
 *
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
    if (hasAllowUnsafeMarkerNear(node, comments, content)) return
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
 * Чи сканувати цей файл за розширенням (JS/TS-сімʼя, без `.d.ts`).
 * @param {string} relativePathPosix відносний шлях (posix)
 * @returns {boolean} true, якщо розширення підходить для AST-скану
 */
export function isBunSqlScanSourceFile(relativePathPosix) {
  return SOURCE_FILE_RE.test(relativePathPosix) && !relativePathPosix.endsWith('.d.ts')
}

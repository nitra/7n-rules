/**
 * Знаходить паттерн `new Promise(resolve => setTimeout(resolve, ms))` (з `await` чи без)
 * у джерелах — таку обгортку треба замінити на `setTimeout` з `node:timers/promises`
 * згідно з js-run.mdc, секція «Паузи через setTimeout».
 *
 * Семантика — структурна (без regex по тілу): `NewExpression` з ідентифікатор-callee `Promise`
 * і єдиним аргументом-функцією, тіло якої — виклик `setTimeout(<resolve>, ms)`. Перший
 * аргумент `setTimeout` має передавати `resolve` напряму або тривіально загорнутим у
 * безпараметричну функцію `() => resolve()` / `function () { resolve() }` без жодних
 * аргументів — інакше це не «чиста пауза», і паттерн не вмикається.
 *
 * Сканер не вимагає, щоб файл компілювався: при синтаксичних помилках повертається
 * порожній результат (як інші сканери — спочатку треба полагодити синтаксис).
 */
import { normalizeSnippet, offsetToLine, parseProgramOrNull } from '@7n/rules/scripts/utils/ast-scan-utils.mjs'

const SOURCE_FILE_RE = /\.([cm]?[jt]sx?)$/

/**
 * Чи аргумент, який передають у `setTimeout`, — це «голий» виклик `resolve`
 * (тобто сам ідентифікатор або `() => resolve()` без аргументів).
 * @param {Record<string, unknown> | null | undefined} arg AST-вузол першого аргументу `setTimeout`
 * @param {string} paramName ім'я параметра-resolve у тіла-функції Promise
 * @returns {boolean} `true`, якщо це чиста передача resolve без значення
 */
function isBareResolveCallback(arg, paramName) {
  if (!arg || typeof arg !== 'object') return false
  if (arg.type === 'Identifier' && arg.name === paramName) return true
  if (arg.type !== 'ArrowFunctionExpression' && arg.type !== 'FunctionExpression') return false
  if ((arg.params?.length ?? 0) !== 0) return false
  const callExpr = extractSingleCallExpression(arg.body)
  if (!callExpr) return false
  if (callExpr.callee?.type !== 'Identifier' || callExpr.callee.name !== paramName) return false
  return !Array.isArray(callExpr.arguments) || callExpr.arguments.length === 0
}

/**
 * Якщо тіло функції — рівно один `CallExpression` (концизне `() => foo()` або
 * `{ foo() }` без інших стейтментів), повертає його. Інакше — `null`.
 * @param {unknown} body тіло функції з AST
 * @returns {Record<string, unknown> | null} AST-вузол `CallExpression` або `null`
 */
function extractSingleCallExpression(body) {
  if (!body || typeof body !== 'object') return null
  if (body.type === 'CallExpression') return body
  if (body.type !== 'BlockStatement') return null
  if (!Array.isArray(body.body) || body.body.length !== 1) return null
  const stmt = body.body[0]
  if (!stmt || stmt.type !== 'ExpressionStatement') return null
  const expr = stmt.expression
  return expr?.type === 'CallExpression' ? expr : null
}

/**
 * Чи це `NewExpression` виду `new Promise(<resolve> => setTimeout(<resolve>, ms))`.
 * Параметр-resolve має бути простим Identifier; setTimeout — глобальним викликом
 * за іменем (з будь-якого джерела — node:timers, global, тощо: значення для нас має
 * лише структурний паттерн).
 * @param {Record<string, unknown> | null | undefined} node AST-вузол
 * @returns {boolean} `true`, якщо це проблемний паттерн «обгортки таймера у Promise»
 */
function isPromiseSetTimeoutDelay(node) {
  if (!node || node.type !== 'NewExpression') return false
  if (node.callee?.type !== 'Identifier' || node.callee.name !== 'Promise') return false
  if (!Array.isArray(node.arguments) || node.arguments.length !== 1) return false
  const fn = node.arguments[0]
  if (!fn || (fn.type !== 'ArrowFunctionExpression' && fn.type !== 'FunctionExpression')) return false
  if (!Array.isArray(fn.params) || fn.params.length === 0) return false
  const firstParam = fn.params[0]
  if (!firstParam || firstParam.type !== 'Identifier') return false
  const setTimeoutCall = extractSingleCallExpression(fn.body)
  if (!setTimeoutCall) return false
  if (setTimeoutCall.callee?.type !== 'Identifier' || setTimeoutCall.callee.name !== 'setTimeout') return false
  if (!Array.isArray(setTimeoutCall.arguments) || setTimeoutCall.arguments.length < 1) return false
  return isBareResolveCallback(setTimeoutCall.arguments[0], firstParam.name)
}

/**
 * Простий рекурсивний обхід AST: заходимо в усі об'єкти/масиви, щоб знайти `NewExpression`.
 * @param {unknown} node корінь або під-вузол AST
 * @param {(n: Record<string, unknown>) => void} visit виклик для кожного об'єкта-вузла з `type`
 * @returns {void}
 */
function walkAst(node, visit) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const item of node) walkAst(item, visit)
    return
  }
  if (typeof node.type === 'string') {
    visit(node)
  }
  for (const [key, v] of Object.entries(node)) {
    if (key === 'parent') continue
    if (v && typeof v === 'object') walkAst(v, visit)
  }
}

/**
 * Знаходить усі `new Promise(resolve => setTimeout(resolve, ms))` у тексті.
 * @param {string} content вихідний код
 * @param {string} [virtualPath] шлях для вибору `lang` (наприклад `pkg/src/foo.ts`)
 * @returns {{ line: number, snippet: string }[]} список порушень
 */
export function findPromiseSetTimeoutInText(content, virtualPath = 'scan.ts') {
  const program = parseProgramOrNull(content, virtualPath)
  if (!program) return []
  /** @type {{ line: number, snippet: string }[]} */
  const out = []
  walkAst(program, node => {
    if (!isPromiseSetTimeoutDelay(node)) return
    out.push({
      line: offsetToLine(content, node.start),
      snippet: normalizeSnippet(content.slice(node.start, node.end))
    })
  })
  return out
}

/**
 * Чи сканувати цей файл за розширенням (JS/TS-сім'я, виключно з `.d.ts`).
 * @param {string} relativePath відносний шлях до файлу
 * @returns {boolean} `true`, якщо розширення підходить для сканування
 */
export function isPromiseSetTimeoutScanSourceFile(relativePath) {
  if (!SOURCE_FILE_RE.test(relativePath)) return false
  return !relativePath.endsWith('.d.ts')
}

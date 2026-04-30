/**
 * AST-сканер для правила CheckEnv (js-run.mdc).
 *
 * Кожне використання `process.env.X` у JS/TS-коді має бути «закрите» одним з двох способів:
 *  - перед використанням у тому ж файлі викликано `checkEnv(['X', ...])` з пакету `@nitra/check-env`;
 *  - на рядку безпосередньо перед `process.env.X` стоїть коментар-маркер
 *    `// @nitra/cursor ignore-next-line checkEnv` (роздільники пробілів довільні; саме слово
 *    `checkEnv` чутливе до регістру, як в усіх прикладах документа).
 *
 * Семантика береться з **oxc-parser** через `parseProgramOrNull`: regex по тілу файлу не
 * використовується, лише сирий текст рядка з коментарем перевіряється на маркер. Якщо
 * файл не парситься — повертаємо порожній результат, спочатку треба полагодити синтаксис.
 *
 * Покриті форми доступу до `process.env`:
 *  - `process.env.X` (звичайний MemberExpression);
 *  - `process.env['X']` (computed з рядковим літералом);
 *  - `const { X, Y } = process.env` (ObjectPattern; ім'я з ключа);
 *  - `const { X: alias } = process.env` (ім'я з ключа, не з alias).
 *
 * Якщо ключ обчислюваний (наприклад, `process.env[varName]`) — пропускаємо без помилки,
 * бо за статичним AST неможливо встановити, яка саме змінна оточення використовується.
 */
import { offsetToLine, parseProgramOrNull, walkAstWithAncestors } from './ast-scan-utils.mjs'

const SOURCE_FILE_RE = /\.([cm]?[jt]sx?)$/u
const IGNORE_DIRECTIVE_RE = /\/\/\s*@nitra\/cursor\s+ignore-next-line\s+checkEnv\b/u

/**
 * Чи є цей вузол виразом `process.env`.
 * @param {unknown} node AST вузол
 * @returns {boolean} true, якщо це `MemberExpression` `process.env` (Identifier . Identifier)
 */
function isProcessEnvAccess(node) {
  if (!node || typeof node !== 'object') return false
  if (node.type !== 'MemberExpression' || node.computed) return false
  const obj = node.object
  const prop = node.property
  return (
    !!obj &&
    obj.type === 'Identifier' &&
    obj.name === 'process' &&
    !!prop &&
    prop.type === 'Identifier' &&
    prop.name === 'env'
  )
}

/**
 * Витягує ім'я ENV з MemberExpression-вузла `process.env.X` або `process.env['X']`.
 * @param {Record<string, unknown>} node MemberExpression, чий object — `process.env`
 * @returns {string | null} ім'я змінної оточення або null, якщо ключ не статичний
 */
function envNameFromMember(node) {
  const prop = node.property
  if (!prop || typeof prop !== 'object') return null
  if (!node.computed && prop.type === 'Identifier' && typeof prop.name === 'string') return prop.name
  if (node.computed && prop.type === 'Literal' && typeof prop.value === 'string') return prop.value
  return null
}

/**
 * Збирає всі літеральні імена з виклику `checkEnv([...])` у файлі.
 * Якщо callee — Identifier `checkEnv` і перший аргумент — ArrayExpression, додає
 * всі string-літерали до set. Не-літеральні елементи (Identifier, SpreadElement) ігноруються —
 * це робить перевірку «ліберальною»: ми лише ловимо явно неперевірені змінні.
 * @param {unknown} programNode корінь AST
 * @returns {Set<string>} перелік закритих імен ENV
 */
function collectCheckedEnvNames(programNode) {
  /** @type {Set<string>} */
  const out = new Set()
  walkAstWithAncestors(programNode, [], node => {
    if (node.type !== 'CallExpression') return
    const callee = node.callee
    if (!callee || callee.type !== 'Identifier' || callee.name !== 'checkEnv') return
    const args = node.arguments
    if (!Array.isArray(args) || args.length === 0) return
    const first = args[0]
    if (!first || typeof first !== 'object' || first.type !== 'ArrayExpression') return
    const elements = first.elements
    if (!Array.isArray(elements)) return
    for (const el of elements) {
      if (!el || typeof el !== 'object') continue
      if (el.type === 'Literal' && typeof el.value === 'string') out.add(el.value)
    }
  })
  return out
}

/**
 * Чи закритий рядок ignore-коментарем `// @nitra/cursor ignore-next-line checkEnv`.
 * @param {string[]} lines рядки файлу (split за \n, без CR)
 * @param {number} oneBasedLine 1-based номер рядка з `process.env.X`
 * @returns {boolean} true, якщо попередній рядок містить маркер
 */
function hasIgnoreDirective(lines, oneBasedLine) {
  if (oneBasedLine <= 1) return false
  const prev = lines[oneBasedLine - 2] ?? ''
  return IGNORE_DIRECTIVE_RE.test(prev)
}

/**
 * Знаходить всі доступи до `process.env.<NAME>`, які не покриті ні літеральним
 * `checkEnv([...])` у тому ж файлі, ні коментарем-маркером безпосередньо перед.
 *
 * @param {string} content вихідний код
 * @param {string} [virtualPath] шлях для вибору `lang` парсера
 * @returns {{ line: number, name: string }[]} список порушень
 */
export function findUncheckedProcessEnvInText(content, virtualPath = 'scan.ts') {
  const program = parseProgramOrNull(content, virtualPath)
  if (!program) return []

  const checked = collectCheckedEnvNames(program)
  const lines = content.split('\n').map(s => (s.endsWith('\r') ? s.slice(0, -1) : s))

  /** @type {{ line: number, name: string }[]} */
  const out = []
  /** @type {Set<string>} */
  const reported = new Set()

  /**
   * Реєструє порушення з дедуплікацією за «name@line».
   * @param {string} name ім'я ENV
   * @param {number} line 1-based рядок
   */
  function report(name, line) {
    if (checked.has(name)) return
    if (hasIgnoreDirective(lines, line)) return
    const key = `${name}@${line}`
    if (reported.has(key)) return
    reported.add(key)
    out.push({ name, line })
  }

  walkAstWithAncestors(program, [], (node, ancestors) => {
    if (isProcessEnvAccess(node)) {
      const parent = ancestors[ancestors.length - 1]
      // process.env.X / process.env['X']
      if (parent && typeof parent === 'object' && parent.type === 'MemberExpression' && parent.object === node) {
        const envName = envNameFromMember(parent)
        if (envName) report(envName, offsetToLine(content, parent.start))
      }
      // const { X, Y } = process.env  → беремо імена з ObjectPattern
      if (
        parent &&
        typeof parent === 'object' &&
        parent.type === 'VariableDeclarator' &&
        parent.init === node &&
        parent.id &&
        parent.id.type === 'ObjectPattern' &&
        Array.isArray(parent.id.properties)
      ) {
        for (const p of parent.id.properties) {
          if (!p || typeof p !== 'object' || p.type !== 'Property') continue
          if (p.computed) continue
          const key = p.key
          if (!key || typeof key !== 'object') continue
          /** @type {string | null} */
          let name = null
          if (key.type === 'Identifier' && typeof key.name === 'string') name = key.name
          else if (key.type === 'Literal' && typeof key.value === 'string') name = key.value
          if (name) report(name, offsetToLine(content, p.start ?? parent.start))
        }
      }
    }
  })

  return out
}

/**
 * Чи сканувати цей файл за розширенням (JS/TS-сім'я, без `.d.ts`).
 * @param {string} relativePathPosix відносний шлях (posix)
 * @returns {boolean} true, якщо розширення підходить для AST-скану
 */
export function isCheckEnvScanSourceFile(relativePathPosix) {
  return SOURCE_FILE_RE.test(relativePathPosix) && !relativePathPosix.endsWith('.d.ts')
}

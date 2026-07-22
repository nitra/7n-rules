/**
 * AST-сканер правила «process.env / CheckEnv» (js-run.mdc).
 *
 * Правило в .mdc формулює два контракти:
 *  1. Прямий доступ до `process.env.X` має бути замінено на `env` — з пакета
 *     `@nitra/check-env` (для обов'язкових змінних, із викликом `checkEnv([...])`)
 *     або з `node:process` (для опційних). Тому будь-яке `process.env.X` сканер
 *     завжди реєструє як порушення з порадою про конкретну заміну.
 *  2. Якщо у файл імпортовано `env` саме з `@nitra/check-env`, то кожне `env.X`
 *     має бути закрите літеральним викликом `checkEnv(['X', ...])` у тому ж файлі
 *     (порядок не важливий, кілька викликів зливаються в один список).
 *
 * Обидва контракти можна точково «приглушити» коментарем-маркером
 * `// n-rules:ignore-next-line checkEnv` на рядку безпосередньо перед
 * порушенням.
 *
 * Семантика береться з **oxc-parser** через `parseProgramOrNull`: regex по тілу
 * файлу не використовується, лише сирий текст рядка з коментарем перевіряється
 * на маркер. Якщо файл не парситься — повертаємо порожній результат, спочатку
 * треба полагодити синтаксис.
 *
 * Покриті форми доступу:
 *  - `process.env.X` / `process.env['X']` (як MemberExpression);
 *  - `const { X, Y } = process.env` (ObjectPattern; ім'я з ключа, не з alias);
 *  - аналогічно для `env.X` / `env['X']` / `const { X } = env`,
 *    де `env` має бути імпортований з `@nitra/check-env` (інакше ігноруємо —
 *    це може бути локальна змінна чи `env` з `node:process`).
 *
 * Якщо ключ обчислюваний (`process.env[varName]`) — пропускаємо без помилки,
 * бо за статичним AST неможливо встановити, яка саме змінна оточення використовується.
 */
import { offsetToLine, parseProgramOrNull, walkAstWithAncestors } from '@7n/rules/scripts/utils/ast-scan-utils.mjs'

const SOURCE_FILE_RE = /\.([cm]?[jt]sx?)$/u
const IGNORE_DIRECTIVE_RE = /\/\/\s*n-rules:ignore-next-line\s+checkEnv\b/u

const CHECK_ENV_PACKAGE = '@nitra/check-env'

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
 * Витягує ім'я ENV з MemberExpression `obj.X` або `obj['X']`.
 * @param {Record<string, unknown>} node MemberExpression, чий object — `process.env` або `env`
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
 * Чи імпортовано локальний ідентифікатор `env` саме з `@nitra/check-env`.
 * Перевіряє ImportDeclaration на specifier {imported.name === 'env', local.name === 'env'}.
 * Aliased-варіанти (`{ env as x }`) свідомо не підтримуються — у наших правилах
 * приклади завжди використовують канонічне ім'я `env`.
 * @param {unknown} programNode корінь AST
 * @returns {boolean} true, якщо у файлі є `import { env } from '@nitra/check-env'`
 */
function hasCheckEnvImport(programNode) {
  let found = false
  walkAstWithAncestors(programNode, [], node => {
    if (found) return
    if (node.type !== 'ImportDeclaration') return
    const source = node.source
    if (!source || typeof source !== 'object' || source.value !== CHECK_ENV_PACKAGE) return
    const specifiers = node.specifiers
    if (!Array.isArray(specifiers)) return
    for (const s of specifiers) {
      if (!s || typeof s !== 'object' || s.type !== 'ImportSpecifier') continue
      const imported = s.imported
      if (!imported || imported.name !== 'env') continue
      const local = s.local
      if (!local || local.name !== 'env') continue
      found = true
      return
    }
  })
  return found
}

/**
 * Чи закритий рядок ignore-коментарем `// n-rules:ignore-next-line checkEnv`.
 * @param {string[]} lines рядки файлу (split за \n, без CR)
 * @param {number} oneBasedLine 1-based номер рядка з порушенням
 * @returns {boolean} true, якщо попередній рядок містить маркер
 */
function hasIgnoreDirective(lines, oneBasedLine) {
  if (oneBasedLine <= 1) return false
  const prev = lines[oneBasedLine - 2] ?? ''
  return IGNORE_DIRECTIVE_RE.test(prev)
}

/**
 * Чи є вузол MemberExpression виду `env.X` / `env['X']`, де `env` — Identifier
 * (в AST oxc-parser globals і локальні імпорти не розрізняються — фільтр джерела
 * робиться на рівні `hasCheckEnvImport`).
 * @param {unknown} node AST вузол
 * @returns {boolean} true, якщо це `env.<...>`
 */
function isEnvIdentifierMember(node) {
  if (!node || typeof node !== 'object' || node.type !== 'MemberExpression') return false
  const obj = node.object
  return !!obj && obj.type === 'Identifier' && obj.name === 'env'
}

/**
 * @typedef {{
 *   line: number,
 *   name: string,
 *   kind: 'process-env' | 'check-env-missing-checkEnv'
 * }} EnvViolation
 */

/**
 * Чи parent — це MemberExpression, у якому `node` (process.env) є об'єктом доступу.
 * @param {unknown} parent ancestor вузла
 * @param {unknown} node перевіряємий вузол `process.env`
 * @returns {boolean} true для `process.env.X` / `process.env['X']`
 */
function isParentEnvMember(parent, node) {
  return !!parent && typeof parent === 'object' && parent.type === 'MemberExpression' && parent.object === node
}

/**
 * Чи parent — це VariableDeclarator виду `const { ... } = <node>`.
 * @param {unknown} parent ancestor вузла
 * @param {unknown} node перевіряємий вузол (process.env або Identifier `env`)
 * @returns {boolean} true для `const { ... } = node`
 */
function isParentObjectPatternDeclarator(parent, node) {
  return (
    !!parent &&
    typeof parent === 'object' &&
    parent.type === 'VariableDeclarator' &&
    parent.init === node &&
    !!parent.id &&
    parent.id.type === 'ObjectPattern' &&
    Array.isArray(parent.id.properties)
  )
}

/**
 * Чи node — це VariableDeclarator виду `const { ... } = env`, де `env` — Identifier.
 * @param {Record<string, unknown>} node AST-вузол
 * @returns {boolean} true для `const { ... } = env`
 */
function isEnvObjectPatternDeclarator(node) {
  return (
    node.type === 'VariableDeclarator' &&
    !!node.init &&
    node.init.type === 'Identifier' &&
    node.init.name === 'env' &&
    !!node.id &&
    node.id.type === 'ObjectPattern' &&
    Array.isArray(node.id.properties)
  )
}

/**
 * Перебирає AST і для кожного знайденого доступу до `process.env` чи `env`
 * (де `env` — імпорт з `@nitra/check-env`) реєструє порушення відповідного типу.
 * @param {unknown} program корінь AST
 * @param {string} content вихідний код (для offset → line)
 * @param {string[]} lines split-рядки content (для ignore-маркера)
 * @param {Set<string>} checkedNames імена, закриті літеральним `checkEnv([...])`
 * @param {boolean} envFromCheckEnv чи імпортовано `env` саме з `@nitra/check-env`
 * @returns {EnvViolation[]} список порушень (відсортований за порядком зустрічі в AST)
 */
function collectViolations(program, content, lines, checkedNames, envFromCheckEnv) {
  /** @type {EnvViolation[]} */
  const out = []
  /** @type {Set<string>} */
  const reported = new Set()

  /**
   * Реєструє порушення з дедуплікацією за «kind|name|line» і урахуванням ignore-маркера.
   * @param {'process-env' | 'check-env-missing-checkEnv'} kind тип порушення
   * @param {string} name ім'я ENV
   * @param {number} line 1-based рядок
   */
  function report(kind, name, line) {
    if (hasIgnoreDirective(lines, line)) return
    const key = `${kind}|${name}|${line}`
    if (reported.has(key)) return
    reported.add(key)
    out.push({ kind, name, line })
  }

  /**
   * Реєструє порушення для всіх статичних ключів ObjectPattern (`const { A, B } = …`).
   * @param {Record<string, unknown>} declarator VariableDeclarator з ObjectPattern у `id`
   * @param {'process-env' | 'check-env-missing-checkEnv'} kind тип порушення
   * @param {(name: string) => boolean} skipName предикат «пропустити це ім'я» (наприклад, вже у checkEnv)
   */
  function reportObjectPatternKeys(declarator, kind, skipName) {
    const fallbackOffset = declarator.start
    for (const p of declarator.id.properties) {
      const name = staticPropertyName(p)
      if (!name || skipName(name)) continue
      report(kind, name, offsetToLine(content, p.start ?? fallbackOffset))
    }
  }

  /**
   * Обробка `process.env`-доступу: і `parent.X`, і деструктуризація.
   * @param {unknown} node AST-вузол `process.env`
   * @param {unknown[]} ancestors стек предків з walkAstWithAncestors
   */
  function handleProcessEnv(node, ancestors) {
    const parent = ancestors.at(-1)
    if (isParentEnvMember(parent, node)) {
      const envName = envNameFromMember(parent)
      if (envName) report('process-env', envName, offsetToLine(content, parent.start))
    }
    if (isParentObjectPatternDeclarator(parent, node)) {
      reportObjectPatternKeys(parent, 'process-env', () => false)
    }
  }

  /**
   * Обробка вузлів, що стосуються `env` з `@nitra/check-env`.
   * @param {Record<string, unknown>} node AST-вузол
   */
  function handleCheckEnvAccess(node) {
    if (isEnvIdentifierMember(node)) {
      const envName = envNameFromMember(node)
      if (envName && !checkedNames.has(envName)) {
        report('check-env-missing-checkEnv', envName, offsetToLine(content, node.start))
      }
      return
    }
    if (isEnvObjectPatternDeclarator(node)) {
      reportObjectPatternKeys(node, 'check-env-missing-checkEnv', name => checkedNames.has(name))
    }
  }

  walkAstWithAncestors(program, [], (node, ancestors) => {
    if (isProcessEnvAccess(node)) {
      handleProcessEnv(node, ancestors)
      return
    }
    if (envFromCheckEnv) handleCheckEnvAccess(node)
  })

  return out
}

/**
 * Витягує статичне ім'я з вузла Property у ObjectPattern.
 * @param {unknown} property AST-вузол ObjectPattern.properties[i]
 * @returns {string | null} ім'я ключа або null
 */
function staticPropertyName(property) {
  if (!property || typeof property !== 'object' || property.type !== 'Property') return null
  if (property.computed) return null
  const key = property.key
  if (!key || typeof key !== 'object') return null
  if (key.type === 'Identifier' && typeof key.name === 'string') return key.name
  if (key.type === 'Literal' && typeof key.value === 'string') return key.value
  return null
}

/**
 * Знаходить порушення правила «process.env / CheckEnv» у файлі.
 * @param {string} content вихідний код
 * @param {string} [virtualPath] шлях для вибору `lang` парсера
 * @returns {EnvViolation[]} список порушень із типом, іменем змінної та рядком
 */
export function findUncheckedProcessEnvInText(content, virtualPath = 'scan.ts') {
  const program = parseProgramOrNull(content, virtualPath)
  if (!program) return []

  const checked = collectCheckedEnvNames(program)
  const envFromCheckEnv = hasCheckEnvImport(program)
  const lines = content.split('\n').map(s => (s.endsWith('\r') ? s.slice(0, -1) : s))

  return collectViolations(program, content, lines, checked, envFromCheckEnv)
}

/**
 * Чи сканувати цей файл за розширенням (JS/TS-сім'я, без `.d.ts`).
 * @param {string} relativePathPosix відносний шлях (posix)
 * @returns {boolean} true, якщо розширення підходить для AST-скану
 */
export function isCheckEnvScanSourceFile(relativePathPosix) {
  return SOURCE_FILE_RE.test(relativePathPosix) && !relativePathPosix.endsWith('.d.ts')
}

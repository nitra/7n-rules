/**
 * Знаходить імпорти з `@nitra/bunyan` (і застарілого `bunyan`) у джерелах — їх треба замінити
 * на `@nitra/pino` згідно з js-pino.mdc.
 *
 * Семантика береться з **oxc-parser** (`module.staticImports`) — без regex по тілу файлу.
 * Додатково по AST програми ловимо `require('@nitra/bunyan')` і динамічний `import('@nitra/bunyan')`,
 * щоб правило працювало й у CommonJS/інлайн-завантаженні.
 *
 * Сканер не вимагає, щоб файл компілювався: при синтаксичних помилках повертається порожній
 * результат — спочатку треба полагодити синтаксис, потім перезапустити перевірку.
 */
import { parseSync } from 'oxc-parser'

const SOURCE_FILE_RE = /\.([cm]?[jt]sx?)$/
const FORBIDDEN_MODULES = new Set(['@nitra/bunyan', 'bunyan'])

/**
 * Мова для Oxc за шляхом файлу (розширення).
 * @param {string} filePath віртуальний або реальний шлях до файлу
 * @returns {'js' | 'jsx' | 'ts' | 'tsx'} значення опції `lang` для `parseSync`
 */
function langFromPath(filePath) {
  const lower = filePath.toLowerCase()
  if (lower.endsWith('.tsx')) {
    return 'tsx'
  }
  if (lower.endsWith('.ts') || lower.endsWith('.mts') || lower.endsWith('.cts')) {
    return 'ts'
  }
  if (lower.endsWith('.jsx')) {
    return 'jsx'
  }
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
    if (content.codePointAt(i) === 10) {
      line++
    }
  }
  return line
}

/**
 * Стискає пробіли для повідомлення про порушення.
 * @param {string} s фрагмент коду
 * @returns {string} скорочений однорядковий рядок
 */
function normalizeSnippet(s) {
  return s.replaceAll(/\s+/g, ' ').trim().slice(0, 160)
}

/**
 * Перевіряє, чи це виклик `require('<module>')` з рядковим аргументом.
 * @param {Record<string, unknown> | null | undefined} node вузол AST
 * @returns {string | null} ім'я модуля з аргументу, інакше `null`
 */
function requireCallModule(node) {
  if (!node || node.type !== 'CallExpression') return null
  const callee = node.callee
  if (!callee || callee.type !== 'Identifier' || callee.name !== 'require') return null
  const arg = node.arguments?.[0]
  if (!arg || arg.type !== 'Literal' || typeof arg.value !== 'string') return null
  return arg.value
}

/**
 * Перевіряє, чи це динамічний `import('<module>')` з рядковим аргументом.
 * @param {Record<string, unknown> | null | undefined} node вузол AST
 * @returns {string | null} ім'я модуля, інакше `null`
 */
function dynamicImportModule(node) {
  if (!node || node.type !== 'ImportExpression') return null
  const src = node.source
  if (!src || src.type !== 'Literal' || typeof src.value !== 'string') return null
  return src.value
}

/**
 * Простий рекурсивний обхід AST: заходимо в усі об'єкти/масиви, щоб знайти require/import-вузли.
 * @param {unknown} node корінь або під-вузол AST
 * @param {(n: unknown) => void} visit виклик для кожного об'єкта-вузла
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
  for (const key of Object.keys(node)) {
    if (key !== 'parent') {
      const v = node[key]
      if (v && typeof v === 'object') walkAst(v, visit)
    }
  }
}

/**
 * Знаходить заборонені імпорти/require з `@nitra/bunyan` у тексті.
 * @param {string} content вихідний код
 * @param {string} [virtualPath] шлях для вибору `lang` (наприклад `pkg/src/foo.ts`)
 * @returns {{ line: number, snippet: string, module: string }[]} список порушень
 */
export function findBunyanImportsInText(content, virtualPath = 'scan.ts') {
  const pathForLang = virtualPath || 'scan.ts'
  const lang = langFromPath(pathForLang)
  let result
  try {
    result = parseSync(pathForLang, content, { lang, sourceType: 'module' })
  } catch {
    return []
  }
  if (result.errors?.length) {
    return []
  }

  /** @type {{ line: number, snippet: string, module: string }[]} */
  const out = []

  for (const imp of result.module?.staticImports ?? []) {
    const mod = imp.moduleRequest?.value
    if (mod && FORBIDDEN_MODULES.has(mod)) {
      out.push({
        line: offsetToLine(content, imp.start),
        snippet: normalizeSnippet(content.slice(imp.start, imp.end)),
        module: mod
      })
    }
  }

  walkAst(result.program, node => {
    const reqMod = requireCallModule(node)
    if (reqMod && FORBIDDEN_MODULES.has(reqMod)) {
      out.push({
        line: offsetToLine(content, node.start),
        snippet: normalizeSnippet(content.slice(node.start, node.end)),
        module: reqMod
      })
      return
    }
    const dynMod = dynamicImportModule(node)
    if (dynMod && FORBIDDEN_MODULES.has(dynMod)) {
      out.push({
        line: offsetToLine(content, node.start),
        snippet: normalizeSnippet(content.slice(node.start, node.end)),
        module: dynMod
      })
    }
  })

  return out
}

/**
 * Чи сканувати цей файл за розширенням (JS/TS-сім'я).
 * @param {string} relativePath відносний шлях до файлу
 * @returns {boolean} `true`, якщо розширення підходить для пошуку імпорту
 */
export function isBunyanScanSourceFile(relativePath) {
  return SOURCE_FILE_RE.test(relativePath)
}

/**
 * Чи слід пропустити файл під час обходу пакета (декларації типів).
 * @param {string} relativePosix шлях з posix-слешами
 * @returns {boolean} `true`, якщо файл не сканувати
 */
export function shouldSkipFileForBunyanScan(relativePosix) {
  return relativePosix.endsWith('.d.ts')
}

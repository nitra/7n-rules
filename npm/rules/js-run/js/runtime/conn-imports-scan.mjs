/**
 * AST-сканер для правила «Внутрішні аліаси» (js-run.mdc).
 *
 * Імпорти, які створюють підключення до БД / зовнішнього GraphQL, мають жити в окремому
 * файлі (за замовчуванням — `src/conn/`), а решта коду повинна споживати їх через
 * pkg-import `#conn/...`. Ловимо такі імпорти в файлах поза каталогом «conn»:
 *  - `import { SQL } from 'bun'` (named специфікатор `SQL`);
 *  - `import sql from 'mssql'` або будь-який `import ... from 'mssql'`;
 *  - `import { GraphQLClient } from '@nitra/graphql-request'` (named `GraphQLClient`).
 *
 * Каталог «conn» визначається з поля `package.json#imports['#conn/*']` (якщо є —
 * відрізаємо `*` і нормалізуємо), інакше дефолт — `src/conn`. Ключ `imports` у
 * package.json — нативний для Node.js, той самий, що й у документі правила.
 *
 * Семантика береться з **oxc-parser** (`module.staticImports`); regex по тілу файлу не
 * використовується. Якщо файл не парситься — повертаємо порожній результат, спочатку
 * треба полагодити синтаксис.
 */
import { langFromPath, normalizeSnippet, offsetToLine } from '../../../../scripts/utils/ast-scan-utils.mjs'
import { parseSync } from 'oxc-parser'

const SOURCE_FILE_RE = /\.([cm]?[jt]sx?)$/u

/**
 * Прибирає хвостові `/` зі шляху без використання regex (щоб не тригерити slow-regex попередження).
 * @param {string} s рядок зі шляхом
 * @returns {string} `s` без хвостових `/`
 */
function stripTrailingSlashes(s) {
  let end = s.length
  while (end > 0 && s.codePointAt(end - 1) === 47) end--
  return end === s.length ? s : s.slice(0, end)
}

/**
 * Нормалізує шлях до posix без хвостових слешів.
 * @param {string} p вхідний шлях (можливо з `./` або зворотними слешами)
 * @returns {string} нормалізований posix-шлях без хвостового `/`
 */
function toPosixDir(p) {
  let s = String(p).replaceAll('\\', '/').trim()
  if (s.startsWith('./')) s = s.slice(2)
  return stripTrailingSlashes(s)
}

/**
 * Визначає каталог «conn» за `package.json#imports['#conn/*']`. Дефолт — `src/conn`.
 * @param {unknown} pkgJson розпарсений package.json (або null)
 * @returns {string} відносний posix-шлях до каталогу conn (без хвостового `/`)
 */
export function resolveConnDirFromPackageJson(pkgJson) {
  const fallback = 'src/conn'
  if (!pkgJson || typeof pkgJson !== 'object') return fallback
  const imports = /** @type {Record<string, unknown>} */ (pkgJson).imports
  if (!imports || typeof imports !== 'object') return fallback
  const target = /** @type {Record<string, unknown>} */ (imports)['#conn/*']
  /** @type {string | null} */
  let raw = null
  if (typeof target === 'string') raw = target
  else if (target && typeof target === 'object') {
    // умовний експорт: { default: '...', import: '...' }
    const obj = /** @type {Record<string, unknown>} */ (target)
    if (typeof obj.default === 'string') raw = obj.default
    else if (typeof obj.import === 'string') raw = obj.import
  }
  if (!raw) return fallback
  // Прибираємо хвіст `*`, потім слеші
  let s = toPosixDir(raw)
  if (s.endsWith('/*')) s = s.slice(0, -2)
  return stripTrailingSlashes(s) || fallback
}

/**
 * Чи перебуває файл у каталозі conn (точно або вкладено).
 * @param {string} relPosix відносний posix-шлях до файлу
 * @param {string} connDir posix-шлях каталогу conn (без хвостового `/`)
 * @returns {boolean} true, якщо файл у каталозі conn
 */
export function isInsideConnDir(relPosix, connDir) {
  if (!connDir) return false
  return relPosix === connDir || relPosix.startsWith(`${connDir}/`)
}

/**
 * Чи це порушення правила «Внутрішні аліаси» — імпорт зі стороннього модуля, що створює
 * підключення (`bun` зі специфікатором `SQL`, будь-який імпорт з `mssql`, або
 * `@nitra/graphql-request` зі специфікатором `GraphQLClient`).
 * @param {Record<string, unknown>} staticImport елемент `module.staticImports` з oxc-parser
 * @returns {{ module: string, specifier: string } | null} опис порушення або null
 */
function classifyConnImport(staticImport) {
  const mod = staticImport.moduleRequest?.value
  if (typeof mod !== 'string') return null
  const entries = Array.isArray(staticImport.entries) ? staticImport.entries : []

  if (mod === 'bun') {
    for (const e of entries) {
      const name = e?.importName?.name
      if (name === 'SQL') return { module: mod, specifier: 'SQL' }
    }
    return null
  }
  if (mod === 'mssql') {
    return { module: mod, specifier: '*' }
  }
  if (mod === '@nitra/graphql-request') {
    for (const e of entries) {
      const name = e?.importName?.name
      if (name === 'GraphQLClient') return { module: mod, specifier: 'GraphQLClient' }
    }
    return null
  }
  return null
}

/**
 * Знаходить імпорти-«фабрики підключень» у тексті файлу.
 * @param {string} content вихідний код
 * @param {string} [virtualPath] шлях для вибору `lang` (наприклад `pkg/src/index.ts`)
 * @returns {{ line: number, snippet: string, module: string, specifier: string }[]} список порушень
 */
export function findConnFactoryImportsInText(content, virtualPath = 'scan.ts') {
  const lang = langFromPath(virtualPath || 'scan.ts')
  let result
  try {
    result = parseSync(virtualPath || 'scan.ts', content, { lang, sourceType: 'module' })
  } catch {
    return []
  }
  if (result.errors?.length) return []

  /** @type {{ line: number, snippet: string, module: string, specifier: string }[]} */
  const out = []
  for (const imp of result.module?.staticImports ?? []) {
    const hit = classifyConnImport(imp)
    if (!hit) continue
    out.push({
      line: offsetToLine(content, imp.start),
      snippet: normalizeSnippet(content.slice(imp.start, imp.end)),
      module: hit.module,
      specifier: hit.specifier
    })
  }
  return out
}

/**
 * Чи сканувати цей файл за розширенням (JS/TS-сім'я, без `.d.ts`).
 * @param {string} relativePathPosix відносний шлях (posix)
 * @returns {boolean} true, якщо розширення підходить для AST-скану
 */
export function isConnImportsScanSourceFile(relativePathPosix) {
  return SOURCE_FILE_RE.test(relativePathPosix) && !relativePathPosix.endsWith('.d.ts')
}

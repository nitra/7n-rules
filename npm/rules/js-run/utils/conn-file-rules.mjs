/**
 * Перевірки для файлів-підключень у каталозі `#conn` (js-run.mdc → «Нейминг файлів у `src/conn/`»
 * та «Експорти у файлах `src/conn/`»).
 *
 * Канонічна назва файла:
 *  - GraphQL: `ql-<id>.{js|mjs|cjs|ts|mts|cts}` (id — kebab-case ідентифікатор endpoint);
 *  - PostgreSQL: `pg-{read|write}.{ext}` або `pg-{read|write}-<id>.{ext}` (id — для multi-БД);
 *  - MySQL: `mysql-{read|write}.{ext}` або `mysql-{read|write}-<id>.{ext}`;
 *  - MSSQL: `mssql-{read|write}.{ext}` або `mssql-{read|write}-<id>.{ext}`.
 *
 * Канонічний експорт — іменований, без `export default`. Імʼя константи має дорівнювати
 * camelCase від basename файла (`pg-write-contract` → `pgWriteContract`).
 *
 * Парсимо через oxc-parser; коли файл не парситься — повертаємо порожні результати, щоб
 * не змішувати помилки синтаксису з порушеннями цього правила.
 */
import { parseProgramOrNull } from '../../../scripts/utils/ast-scan-utils.mjs'

const SOURCE_FILE_RE = /\.([cm]?[jt]sx?)$/u

/**
 * Канонічний шаблон імені GraphQL-файла: `ql-<id>.<ext>`.
 * `<id>` — kebab без leading/trailing-`-`, починається/закінчується на `[a-z0-9]`.
 */
const CONN_FILENAME_QL_RE = /^ql-[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.[cm]?[jt]sx?$/u
/**
 * Канонічний шаблон імені файла БД-підключення: `(pg|mysql|mssql)-(read|write)(-<id>)?.<ext>`.
 * `<id>` — за тими ж правилами, що й для `ql-`. Розділили з GraphQL-формою, щоб
 * не множити комплексність regex (sonarjs/regex-complexity).
 */
const CONN_FILENAME_DB_RE = /^(?:pg|mysql|mssql)-(?:read|write)(?:-[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)?\.[cm]?[jt]sx?$/u

/**
 * Чи це файл, який сканується правилом «conn-file» (JS/TS-сімʼя, без `.d.ts`).
 * @param {string} relativePathPosix відносний posix-шлях
 * @returns {boolean} true, якщо потрібно перевіряти
 */
export function isConnFileRulesSourceFile(relativePathPosix) {
  return SOURCE_FILE_RE.test(relativePathPosix) && !relativePathPosix.endsWith('.d.ts')
}

/**
 * Витягує basename файла без розширення.
 * @param {string} relativePathPosix відносний шлях у posix-форматі
 * @returns {string} basename без розширення (наприклад, `pg-write-contract`)
 */
function basenameNoExt(relativePathPosix) {
  const last = relativePathPosix.lastIndexOf('/')
  const base = last === -1 ? relativePathPosix : relativePathPosix.slice(last + 1)
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(0, dot) : base
}

/**
 * Перетворює kebab-case ідентифікатор у camelCase.
 * @param {string} kebab kebab-case рядок (`pg-write-contract`)
 * @returns {string} camelCase (`pgWriteContract`)
 */
export function kebabToCamel(kebab) {
  return kebab.replaceAll(/-([a-z0-9])/gu, (_m, c) => c.toUpperCase())
}

/**
 * Чи відповідає назва файла канонічному шаблону для каталогу conn.
 * @param {string} relativePathPosix відносний posix-шлях файла
 * @returns {boolean} true, якщо basename + ext збігається зі схемою
 */
export function isConnFileNameValid(relativePathPosix) {
  const last = relativePathPosix.lastIndexOf('/')
  const base = last === -1 ? relativePathPosix : relativePathPosix.slice(last + 1)
  return CONN_FILENAME_QL_RE.test(base) || CONN_FILENAME_DB_RE.test(base)
}

/**
 * Витягує імена з `export const/let/var X = …` (включно з кількома declarators у одному `export const a, b`).
 * @param {Record<string, unknown>} decl AST `VariableDeclaration`
 * @returns {string[]} імена змінних
 */
function namesFromVariableDeclaration(decl) {
  if (!Array.isArray(decl.declarations)) return []
  /** @type {string[]} */
  const out = []
  for (const d of decl.declarations) {
    const id = /** @type {Record<string, unknown> | null} */ (d?.id ?? null)
    if (id && id.type === 'Identifier' && typeof id.name === 'string') out.push(id.name)
  }
  return out
}

/**
 * Витягує імʼя з `export function X` / `export class X`.
 * @param {Record<string, unknown>} decl AST `FunctionDeclaration` або `ClassDeclaration`
 * @returns {string | null} імʼя або `null`, якщо id-вузол анонімний
 */
function nameFromFnOrClassDeclaration(decl) {
  if (decl.type !== 'FunctionDeclaration' && decl.type !== 'ClassDeclaration') return null
  const id = /** @type {Record<string, unknown> | null} */ (decl.id ?? null)
  if (!id || typeof id !== 'object') return null
  return typeof id.name === 'string' ? id.name : null
}

/**
 * Витягує експортоване імʼя з одного `ExportSpecifier` (`export { X }` / `export { X as Y }`).
 * @param {Record<string, unknown> | null | undefined} specifier AST `ExportSpecifier`
 * @returns {string | null} імʼя або `null`
 */
function nameFromExportSpecifier(specifier) {
  const exported = /** @type {Record<string, unknown> | null} */ (specifier?.exported ?? null)
  if (!exported) return null
  if (exported.type === 'Identifier' && typeof exported.name === 'string') return exported.name
  if (typeof exported.value === 'string') return exported.value
  return null
}

/**
 * Імена з одного `ExportNamedDeclaration` — або з вкладеного `declaration`, або зі списку `specifiers`.
 * @param {Record<string, unknown>} rec AST `ExportNamedDeclaration`
 * @returns {string[]} імена цього експортного вузла
 */
function namesFromNamedExport(rec) {
  const decl = /** @type {Record<string, unknown> | null} */ (rec.declaration ?? null)
  if (decl) {
    if (decl.type === 'VariableDeclaration') return namesFromVariableDeclaration(decl)
    const fnOrClass = nameFromFnOrClassDeclaration(decl)
    return fnOrClass ? [fnOrClass] : []
  }
  if (!Array.isArray(rec.specifiers)) return []
  /** @type {string[]} */
  const out = []
  for (const s of rec.specifiers) {
    const name = nameFromExportSpecifier(/** @type {Record<string, unknown> | null} */ (s ?? null))
    if (name) out.push(name)
  }
  return out
}

/**
 * Збирає всі імена named-експортів у програмі.
 *
 * Покриває: `export const/let/var X`, `export function X`, `export class X`,
 * `export { X }`, `export { X as Y }` (повертає `Y`). `export *` ігнорується
 * (немає конкретного імені для звірки), `export default` обробляється окремо.
 * @param {unknown} program AST root
 * @returns {string[]} список експортованих імен
 */
function collectNamedExportNames(program) {
  /** @type {string[]} */
  const out = []
  if (!program || typeof program !== 'object') return out
  const body = /** @type {Record<string, unknown>} */ (program).body
  if (!Array.isArray(body)) return out
  for (const node of body) {
    if (!node || typeof node !== 'object') continue
    const rec = /** @type {Record<string, unknown>} */ (node)
    if (rec.type !== 'ExportNamedDeclaration') continue
    out.push(...namesFromNamedExport(rec))
  }
  return out
}

/**
 * Чи є в програмі `export default ...`.
 * @param {unknown} program AST root
 * @returns {boolean} true, якщо знайдено будь-який ExportDefaultDeclaration
 */
function hasDefaultExport(program) {
  if (!program || typeof program !== 'object') return false
  const body = /** @type {Record<string, unknown>} */ (program).body
  if (!Array.isArray(body)) return false
  for (const node of body) {
    if (
      node &&
      typeof node === 'object' &&
      /** @type {Record<string, unknown>} */ (node).type === 'ExportDefaultDeclaration'
    ) {
      return true
    }
  }
  return false
}

/**
 * Знаходить порушення правил для одного файла з каталогу conn.
 *
 * Якщо AST не парситься — повертає порожній масив (синтаксис падає в інших перевірках,
 * не дублюємо).
 * @param {string} content вихідний код файла
 * @param {string} relativePathPosix відносний posix-шлях файла (від кореня пакета)
 * @returns {{ kind: 'name' | 'default-export' | 'export-name', expectedName?: string, foundNames?: string[] }[]} список порушень
 */
export function findConnFileRuleViolations(content, relativePathPosix) {
  /** @type {{ kind: 'name' | 'default-export' | 'export-name', expectedName?: string, foundNames?: string[] }[]} */
  const out = []
  if (!isConnFileNameValid(relativePathPosix)) {
    out.push({ kind: 'name' })
    // якщо назва нестандартна — далі звірку імені експорту не робимо (camelCase двозначний)
  }

  const program = parseProgramOrNull(content, relativePathPosix)
  if (!program) return out

  if (hasDefaultExport(program)) {
    out.push({ kind: 'default-export' })
  }

  if (out.some(v => v.kind === 'name')) return out

  const expected = kebabToCamel(basenameNoExt(relativePathPosix.slice(relativePathPosix.lastIndexOf('/') + 1)))
  const names = collectNamedExportNames(program)
  if (!names.includes(expected)) {
    out.push({ kind: 'export-name', expectedName: expected, foundNames: names })
  }
  return out
}

/**
 * Перевірки для файлів-підключень у каталозі `#conn` (js-run.mdc → «Нейминг файлів у `src/conn/`»
 * та «Експорти у файлах `src/conn/`»).
 *
 * Канонічна назва файла:
 *  - GraphQL: `ql-<id>.{js|mjs|cjs|ts|mts|cts}` (id — kebab-case ідентифікатор endpoint);
 *  - PostgreSQL: `pg-{read|write}.{ext}` або `pg-{read|write}-<id>.{ext}` (id — для multi-БД);
 *  - MySQL/MSSQL: `mysql-{read|write}.{ext}` або `mysql-{read|write}-<id>.{ext}`.
 *
 * Канонічний експорт — іменований, без `export default`. Імʼя константи має дорівнювати
 * camelCase від basename файла (`pg-write-contract` → `pgWriteContract`).
 *
 * Парсимо через oxc-parser; коли файл не парситься — повертаємо порожні результати, щоб
 * не змішувати помилки синтаксису з порушеннями цього правила.
 */
import { parseProgramOrNull } from './ast-scan-utils.mjs'

const SOURCE_FILE_RE = /\.([cm]?[jt]sx?)$/u

/**
 * Канонічний шаблон імені файла в каталозі conn.
 *  - `ql-<id>` для GraphQL;
 *  - `(pg|mysql)-(read|write)(-<id>)?` для БД.
 * `<id>` — починається з [a-z0-9], далі [a-z0-9-]*.
 */
const CONN_FILENAME_RE =
  /^(?:ql-[a-z0-9](?:[a-z0-9-]*[a-z0-9])?|(?:pg|mysql)-(?:read|write)(?:-[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)?)\.([cm]?[jt]sx?)$/u

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
  const base = last >= 0 ? relativePathPosix.slice(last + 1) : relativePathPosix
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
  const base = last >= 0 ? relativePathPosix.slice(last + 1) : relativePathPosix
  return CONN_FILENAME_RE.test(base)
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
    const decl = /** @type {Record<string, unknown> | null} */ (rec.declaration ?? null)
    if (decl) {
      // export const X = ... / export let / export var
      if (decl.type === 'VariableDeclaration' && Array.isArray(decl.declarations)) {
        for (const d of decl.declarations) {
          const id = /** @type {Record<string, unknown> | null} */ (d?.id ?? null)
          if (id && id.type === 'Identifier' && typeof id.name === 'string') out.push(id.name)
        }
      }
      // export function X / export class X
      if (
        (decl.type === 'FunctionDeclaration' || decl.type === 'ClassDeclaration') &&
        decl.id &&
        typeof decl.id === 'object' &&
        typeof /** @type {Record<string, unknown>} */ (decl.id).name === 'string'
      ) {
        out.push(/** @type {string} */ (/** @type {Record<string, unknown>} */ (decl.id).name))
      }
    } else if (Array.isArray(rec.specifiers)) {
      // export { X } / export { X as Y }
      for (const s of rec.specifiers) {
        const exported = /** @type {Record<string, unknown> | null} */ (s?.exported ?? null)
        if (!exported) continue
        // ESTree: Identifier (name) або Literal (value), залежно від спеки
        if (exported.type === 'Identifier' && typeof exported.name === 'string') out.push(exported.name)
        else if (typeof exported.value === 'string') out.push(exported.value)
      }
    }
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
    if (node && typeof node === 'object' && /** @type {Record<string, unknown>} */ (node).type === 'ExportDefaultDeclaration') {
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

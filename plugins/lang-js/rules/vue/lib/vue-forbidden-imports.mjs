/**
 * Визначає явні імпорти з модуля `vue`, які суперечать vue.mdc (має працювати unplugin-auto-import),
 * а також заборонені імпорти Node-нативних модулів у `.vue` SFC (`node:*` префікс або bare ім’я
 * вбудованого модуля Node — `fs`, `path`, `timers/promises` тощо). Vue SFC виконується у браузері,
 * де Node API недоступне, тож такі імпорти ламають збірку/рантайм.
 *
 * Аналіз import виконується через **oxc-parser** (`parseSync`, поле `module.staticImports`) — ESTree-сумісний
 * розбір без евристик по рядках. Дозволені лише side-effect `import 'vue'`, повністю type-only імпорти
 * та `import { type A, type B } from 'vue'` (перевірка `entries[].isType`).
 *
 * Для `.vue` з шаблону витягуються лише теги `<script>` / `<script setup>` (регулярний вираз); далі той самий Oxc-парсинг
 * вмісту скрипта з віртуальним ім’ям `*.ts` для режиму TypeScript.
 */
import { builtinModules } from 'node:module'

import { parseSync } from 'oxc-parser'

import { contentForVueImportScan, extractVueScriptBlocks } from '@7n/rules/scripts/lib/js-source-signals.mjs'

// Витяг script-блоків SFC живе в ядрі (потрібен auto-rules для fact-збору); ре-експорт зберігає API lib-а
export { contentForVueImportScan, extractVueScriptBlocks } from '@7n/rules/scripts/lib/js-source-signals.mjs'

const NODE_BUILTIN_MODULES = new Set(builtinModules)

const VUE_EXT_RE = /\.vue$/u
const SOURCE_FILE_RE = /\.(vue|[cm]?[jt]sx?)$/

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
 * @param {number} offset байтове зміщення початку import
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
 * Чи цей static import з `vue` дозволено правилом (усі записи type-only або порожній side-effect).
 * @param {{ moduleRequest: { value: string }, entries: { isType: boolean }[] }} imp запис з `module.staticImports`
 * @returns {boolean} `true`, якщо імпорт дозволено (type-only або `import 'vue'`)
 */
function isAllowedVueStaticImport(imp) {
  if (imp.entries.length === 0) {
    return true
  }
  return imp.entries.every(e => e.isType)
}

/**
 * Віртуальний шлях для парсера: вміст з `<script>` у `.vue` розбираємо як TypeScript.
 * @param {string} relativePath шлях до файлу в пакеті
 * @returns {string} той самий шлях або з `.vue` заміненим на `.ts`
 */
function virtualPathForParse(relativePath) {
  if (relativePath.endsWith('.vue')) {
    return relativePath.replace(VUE_EXT_RE, '.ts')
  }
  return relativePath
}

/**
 * Знаходить заборонені static import з `vue` у вже підготовленому тексті (без `<template>`).
 * Використовує **oxc-parser**; при синтаксичних помилках повертає порожній масив (спочатку виправ синтаксис).
 * @param {string} content вихідний код
 * @param {string} [virtualPath] шлях для вибору `lang` (наприклад `app/src/foo.ts` або віртуальний після `.vue` → `.ts`)
 * @returns {{ line: number, snippet: string }[]} список порушень з номером рядка початку import
 */
export function findForbiddenVueImportsInText(content, virtualPath = 'scan.ts') {
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
  /** @type {{ line: number, snippet: string }[]} */
  const out = []
  for (const imp of result.module.staticImports) {
    if (imp.moduleRequest.value === 'vue' && !isAllowedVueStaticImport(imp)) {
      out.push({
        line: offsetToLine(content, imp.start),
        snippet: normalizeSnippet(content.slice(imp.start, imp.end))
      })
    }
  }
  return out
}

/**
 * Чи слід пропустити файл під час обходу пакета (генерація, типи).
 * @param {string} relativePosix шлях з posix-слешами
 * @returns {boolean} `true`, якщо файл не сканувати (`.d.ts`, згенеровані імена)
 */
export function shouldSkipFileForVueImportScan(relativePosix) {
  const base = relativePosix.split('/').pop() || ''
  if (base === 'auto-imports.d.ts' || base === 'components.d.ts') {
    return true
  }
  return Boolean(relativePosix.endsWith('.d.ts'))
}

/**
 * Чи сканувати цей файл за розширенням.
 * @param {string} relativePath відносний шлях до файлу
 * @returns {boolean} `true`, якщо розширення підходить для пошуку import
 */
export function isVueImportScanSourceFile(relativePath) {
  return SOURCE_FILE_RE.test(relativePath)
}

/**
 * Знаходить порушення в одному файлі (з урахуванням .vue script extraction).
 * @param {string} content сирий вміст файлу
 * @param {string} relativePath шлях відносно кореня пакета або репо
 * @returns {{ line: number, snippet: string }[]} список порушень для цього файлу
 */
export function findForbiddenVueImportsInSourceFile(content, relativePath) {
  const scan = contentForVueImportScan(content, relativePath)
  const virtualPath = virtualPathForParse(relativePath)
  return findForbiddenVueImportsInText(scan, virtualPath)
}

/**
 * Чи є рядок-специфікатор імпортом вбудованого Node-модуля.
 * Покриває обидві форми: `node:fs`, `node:timers/promises` (явний префікс) і bare-ім’я
 * вбудованого модуля (`fs`, `path`, `crypto` тощо), включно з підшляхами (`fs/promises`).
 * @param {string} spec значення `moduleRequest.value` (специфікатор імпорту)
 * @returns {boolean} `true`, якщо це Node-нативний модуль
 */
export function isNodeBuiltinSpecifier(spec) {
  if (typeof spec !== 'string' || spec.length === 0) {
    return false
  }
  if (spec.startsWith('node:')) {
    return true
  }
  if (NODE_BUILTIN_MODULES.has(spec)) {
    return true
  }
  const slashIdx = spec.indexOf('/')
  if (slashIdx > 0) {
    const head = spec.slice(0, slashIdx)
    if (NODE_BUILTIN_MODULES.has(head)) {
      return true
    }
  }
  return false
}

/**
 * Знаходить заборонені імпорти Node-нативних модулів у вмісті (без `<template>`).
 * Vue SFC виконується у браузері, тож будь-який Node API там недоступний — навіть type-only
 * імпорти збивають з пантелику (краще тримати такий код у server-side утілітах).
 * @param {string} content вихідний код (для `.vue` — вже витягнуті `<script>` блоки)
 * @param {string} [virtualPath] шлях для вибору `lang` (наприклад віртуальний `*.ts` після `.vue`)
 * @returns {{ line: number, snippet: string, specifier: string }[]} список порушень з номером рядка
 */
export function findForbiddenNodeImportsInText(content, virtualPath = 'scan.ts') {
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
  /** @type {{ line: number, snippet: string, specifier: string }[]} */
  const out = []
  for (const imp of result.module.staticImports) {
    const spec = imp.moduleRequest.value
    if (isNodeBuiltinSpecifier(spec)) {
      out.push({
        line: offsetToLine(content, imp.start),
        snippet: normalizeSnippet(content.slice(imp.start, imp.end)),
        specifier: spec
      })
    }
  }
  return out
}

/**
 * Знаходить заборонені імпорти Node-нативних модулів у `.vue` SFC.
 * Сканує лише `<script>` блоки (template ігноруємо). Для не-`.vue` файлів повертає `[]` —
 * композаблі/утіліти на Node-side можуть бути в `.ts`/`.js`, а правило стосується SFC.
 * @param {string} content сирий вміст файлу
 * @param {string} relativePath шлях відносно кореня пакета або репо
 * @returns {{ line: number, snippet: string, specifier: string }[]} список порушень
 */
export function findForbiddenNodeImportsInVueFile(content, relativePath) {
  if (!relativePath.endsWith('.vue')) {
    return []
  }
  const scan = extractVueScriptBlocks(content)
  const virtualPath = virtualPathForParse(relativePath)
  return findForbiddenNodeImportsInText(scan, virtualPath)
}

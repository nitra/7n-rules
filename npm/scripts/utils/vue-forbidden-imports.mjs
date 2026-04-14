/**
 * Визначає явні імпорти з модуля `vue`, які суперечать vue.mdc (має працювати unplugin-auto-import).
 *
 * Аналіз import виконується через **oxc-parser** (`parseSync`, поле `module.staticImports`) — ESTree-сумісний
 * розбір без евристик по рядках. Дозволені лише side-effect `import 'vue'`, повністю type-only імпорти
 * та `import { type A, type B } from 'vue'` (перевірка `entries[].isType`).
 *
 * Для `.vue` з шаблону витягуються лише теги `<script>` / `<script setup>` (регулярний вираз); далі той самий Oxc-парсинг
 * вмісту скрипта з віртуальним ім’ям `*.ts` для режиму TypeScript.
 */
import { parseSync } from 'oxc-parser'

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
 * Витягує з SFC лише код усередині `<script>`, щоб не чіпати шаблон.
 * @param {string} sfc вміст .vue файлу
 * @returns {string} текст усередині тегів `<script>` (усі блоки поспіль)
 */
export function extractVueScriptBlocks(sfc) {
  const chunks = []
  const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi
  let m = re.exec(sfc)
  while (m) {
    chunks.push(m[1])
    m = re.exec(sfc)
  }
  return chunks.join('\n\n')
}

/**
 * Підбирає текст для сканування: для .vue — лише script-блоки, інакше — увесь вміст.
 * @param {string} content сирий вміст файлу
 * @param {string} filePath відносний шлях (для вибору режиму)
 * @returns {string} текст для `parseSync`
 */
export function contentForVueImportScan(content, filePath) {
  if (filePath.endsWith('.vue')) {
    return extractVueScriptBlocks(content)
  }
  return content
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
  if (relativePosix.endsWith('.d.ts')) {
    return true
  }
  return false
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

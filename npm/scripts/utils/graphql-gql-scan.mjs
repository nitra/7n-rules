/**
 * Пошук tagged template **`gql\`…\``** у джерелах для правила graphql.mdc.
 *
 * Для **`.vue`** береться лише вміст `<script>` / `<script setup>` (спільна логіка з **vue-forbidden-imports**).
 * Семантику визначає **oxc-parser** (`program`): рекурсивний обхід AST, збіг лише для **Identifier** з іменем **`gql`** як тега шаблону.
 */
import { parseSync } from 'oxc-parser'

import {
  contentForVueImportScan,
  isVueImportScanSourceFile,
  shouldSkipFileForVueImportScan
} from './vue-forbidden-imports.mjs'

const VUE_EXTENSION_RE = /\.vue$/u

/**
 * Мова для Oxc за шляхом файлу (розширення).
 * @param {string} filePath віртуальний або реальний шлях
 * @returns {'js' | 'jsx' | 'ts' | 'tsx'} мова для Oxc парсера
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
 * Віртуальний шлях для парсера: SFC розбираємо як TypeScript.
 * @param {string} relativePath відносний шлях до файлу
 * @returns {string} шлях із заміненим розширенням для SFC
 */
function virtualPathForParse(relativePath) {
  if (relativePath.endsWith('.vue')) {
    return relativePath.replace(VUE_EXTENSION_RE, '.ts')
  }
  return relativePath
}

/**
 * Чи містить AST хоча б один `gql` tagged template.
 * @param {unknown} node корінь або вузол AST
 * @returns {boolean} true якщо знайдено тег gql
 */
function astContainsGqlTag(node) {
  if (node === null || node === undefined) {
    return false
  }
  if (typeof node !== 'object') {
    return false
  }
  if (Array.isArray(node)) {
    return node.some(n => astContainsGqlTag(n))
  }
  if (node.type === 'TaggedTemplateExpression') {
    const tag = node.tag
    if (tag?.type === 'Identifier' && tag.name === 'gql') {
      return true
    }
  }
  for (const key of Object.keys(node)) {
    if (key !== 'loc' && key !== 'range' && astContainsGqlTag(node[key])) {
      return true
    }
  }
  return false
}

/**
 * Перевіряє один файл: є у скрипті (або у всьому не-vue) tagged template з тегом **`gql`**.
 * @param {string} content сирий вміст файлу
 * @param {string} relativePath відносний шлях (posix)
 * @returns {boolean} true, якщо знайдено `gql`…``
 */
export function sourceFileHasGqlTaggedTemplate(content, relativePath) {
  const scan = contentForVueImportScan(content, relativePath)
  const pathForLang = virtualPathForParse(relativePath)
  const lang = langFromPath(pathForLang)
  try {
    const result = parseSync(pathForLang, scan, { lang, sourceType: 'module' })
    if (result.errors?.length) {
      return false
    }
    return astContainsGqlTag(result.program)
  } catch {
    return false
  }
}

/**
 * Чи підлягає файл скануванню за розширенням (узгоджено з vue-import scan).
 * @param {string} relativePath відносний шлях
 * @returns {boolean} true якщо файл підлягає скануванню
 */
export function isGqlScanSourceFile(relativePath) {
  return isVueImportScanSourceFile(relativePath)
}

/**
 * Чи пропустити файл (декларації, auto-imports) — ті самі критерії, що для vue-import scan.
 * @param {string} relativePosix шлях з posix-слешами
 * @returns {boolean} true якщо файл потрібно пропустити
 */
export function shouldSkipFileForGqlScan(relativePosix) {
  return shouldSkipFileForVueImportScan(relativePosix)
}

/** @see ./docs/ast-extract.md */

/**
 * Generic AST-facts extractor для `ast_facts`-tool fix-engine (§3б спеки pi-migration).
 *
 * Дає агенту структурований зріз файлу (`imports` / `exports` / `topLevelFunctions`)
 * замість сирого вмісту — скорочує redundant read-turns на слабкій локальній моделі.
 * Використовується як **generic fallback**, коли правило не має власного
 * `rules/<id>/js/_ast-context.mjs`.
 *
 * Парсинг — через спільний `parseProgramOrNull` (oxc). Будь-яка помилка (read/parse)
 * деградує до `{ error, imports:[], exports:[], topLevelFunctions:[] }`, щоб агент
 * продовжив із тим, що має (контракт §3б: fallback до голого вмісту).
 */

import { readFileSync } from 'node:fs'
import { parseProgramOrNull } from './ast-scan-utils.mjs'

/**
 * Порожній результат із причиною (read/parse fail).
 * @param {string} error причина деградації
 * @returns {{ error: string, imports: [], exports: [], topLevelFunctions: [] }} порожній зріз із причиною
 */
function empty(error) {
  return { error, imports: [], exports: [], topLevelFunctions: [] }
}

/**
 * Чи init-вираз — функція (для `export const f = () => …`).
 * @param {unknown} node init-вузол оголошення змінної
 * @returns {boolean} true якщо вузол — arrow/function expression
 */
function isFunctionInit(node) {
  return !!node && (node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression')
}

/**
 * Обробляє `ImportDeclaration`: додає `{ source, names }` до акумулятора `imports`.
 * @param {unknown} node вузол import-декларації
 * @param {Array<{source: string, names: string[]}>} imports акумулятор import-ів
 * @returns {void}
 */
function handleImport(node, imports) {
  imports.push({
    source: node.source?.value ?? '',
    names: (node.specifiers ?? []).map(s => s.local?.name).filter(Boolean)
  })
}

/**
 * Обробляє `declaration` частину `ExportNamedDeclaration` (function/class/interface/const).
 * @param {unknown} d вузол declaration (може бути null для re-export без declaration)
 * @param {string[]} exports акумулятор імен exports
 * @param {string[]} topLevelFunctions акумулятор імен top-level функцій
 * @returns {void}
 */
function handleExportedDeclaration(d, exports, topLevelFunctions) {
  if (d?.type === 'FunctionDeclaration' && d.id?.name) {
    exports.push(d.id.name)
    topLevelFunctions.push(d.id.name)
  } else if ((d?.type === 'ClassDeclaration' || d?.type === 'TSInterfaceDeclaration') && d.id?.name) {
    exports.push(d.id.name)
  } else if (d?.type === 'VariableDeclaration') {
    for (const decl of d.declarations ?? []) {
      if (!decl.id?.name) continue
      exports.push(decl.id.name)
      if (isFunctionInit(decl.init)) topLevelFunctions.push(decl.id.name)
    }
  }
}

/**
 * Обробляє `ExportNamedDeclaration`: declaration-частину + re-export specifiers.
 * @param {unknown} node вузол named-export
 * @param {string[]} exports акумулятор імен exports
 * @param {string[]} topLevelFunctions акумулятор імен top-level функцій
 * @returns {void}
 */
function handleExportNamed(node, exports, topLevelFunctions) {
  handleExportedDeclaration(node.declaration, exports, topLevelFunctions)
  for (const spec of node.specifiers ?? []) {
    if (spec.exported?.name) exports.push(spec.exported.name)
  }
}

/**
 * Витягає AST-факти з вихідного коду (без файлового IO — для тестів і reuse).
 * @param {string} content вихідний код
 * @param {string} virtualPath шлях (визначає мову js/ts/jsx/tsx)
 * @returns {{ imports: Array<{source: string, names: string[]}>, exports: string[], topLevelFunctions: string[], error?: string }} факти
 */
export function extractContextFromSource(content, virtualPath) {
  const program = parseProgramOrNull(content, virtualPath)
  if (!program) return empty('parse failed')

  const imports = []
  const exports = []
  const topLevelFunctions = []

  for (const node of program.body ?? []) {
    switch (node?.type) {
      case 'ImportDeclaration': {
        handleImport(node, imports)
        break
      }

      case 'FunctionDeclaration': {
        if (node.id?.name) topLevelFunctions.push(node.id.name)
        break
      }

      case 'ExportNamedDeclaration': {
        handleExportNamed(node, exports, topLevelFunctions)
        break
      }

      case 'ExportDefaultDeclaration': {
        exports.push('default')
        break
      }

      case 'ExportAllDeclaration': {
        exports.push(node.exported?.name ?? '*')
        break
      }

      default: {
        break
      }
    }
  }

  return { imports, exports, topLevelFunctions }
}

/**
 * Читає файл і витягає AST-факти. Read-помилка → `{ error, … }` (не кидає).
 * @param {string} filePath абсолютний/відносний шлях до файлу
 * @returns {{ imports: Array<{source: string, names: string[]}>, exports: string[], topLevelFunctions: string[], error?: string }} факти
 */
export function extractContext(filePath) {
  let content
  try {
    content = readFileSync(filePath, 'utf8')
  } catch (error) {
    return empty(`read failed: ${error.message}`)
  }
  return extractContextFromSource(content, filePath)
}

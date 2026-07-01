/** @see ./docs/units-js.md */

import { parseProgramOrNull, walkAstWithAncestors } from '../../../scripts/utils/ast-scan-utils.mjs'

// JSDoc-блок, що стоїть впритул перед позицією (лише пробіли між ними).
const JSDOC_BEFORE_RE = /\/\*\*(?:(?!\*\/)[\s\S])*\*\/\s*$/
const JSDOC_OPEN_RE = /^\s*\/\*\*?/
const JSDOC_CLOSE_RE = /\*\/\s*$/
const STAR_PREFIX_RE = /^\s*\*?\s?/

/**
 * Очищає JSDoc від обрамлення `/** *​/` і `*`-префіксів.
 * @param {string} raw сирий блок або порожній рядок
 * @returns {string} текст опису без тегів-обрамлення
 */
function cleanDoc(raw) {
  if (!raw) return ''
  return raw
    .replace(JSDOC_OPEN_RE, '')
    .replace(JSDOC_CLOSE_RE, '')
    .split('\n')
    .map(l => l.replace(STAR_PREFIX_RE, '').trimEnd())
    .join('\n')
    .trim()
}

/**
 * JSDoc, що передує позиції `start` у джерелі (або порожній рядок).
 * @param {string} src вміст файлу
 * @param {number} start зміщення початку декларації
 * @returns {string} очищений опис
 */
function precedingDoc(src, start) {
  const m = src.slice(0, start).match(JSDOC_BEFORE_RE)
  return cleanDoc(m ? m[0] : '')
}

/**
 * Імʼя функції, що викликається (проста Identifier або `obj.method`).
 * @param {Record<string, unknown>} node CallExpression
 * @returns {string|null} імʼя callee або null
 */
function calleeName(node) {
  const c = node.callee
  if (!c || typeof c !== 'object') return null
  if (c.type === 'Identifier') return c.name
  if (c.type === 'MemberExpression' && !c.computed && c.property?.type === 'Identifier') return c.property.name
  return null
}

/**
 * Множина імен, що викликаються у тілі вузла (сирі callee — фільтрація на ребра
 * call-graph робиться у `extractUnitsJs` після збору всіх імен юнітів).
 * @param {unknown} node AST-вузол юніта
 * @returns {Set<string>} імена викликів
 */
function collectCalls(node) {
  const names = new Set()
  walkAstWithAncestors(node, [], n => {
    if (n.type !== 'CallExpression') {
      return
    }

    const name = calleeName(n)
    if (name) names.add(name)
  })
  return names
}

/**
 * Будує юніт із декларації, додає у `units`. Розпізнає function/class та
 * const-функції (`const x = () => {}` / `function expression`).
 * @param {Record<string, unknown>} decl декларація (function/class/variable)
 * @param {boolean} exported чи експортується
 * @param {number} docStart зміщення для пошуку JSDoc (зовнішній export-вузол)
 * @param {string} src вміст файлу
 * @param {Array<object>} units акумулятор
 * @returns {void}
 */
function pushUnits(decl, exported, docStart, src, units) {
  if (!decl || typeof decl !== 'object') return
  const doc = precedingDoc(src, docStart)
  if (decl.type === 'FunctionDeclaration' || decl.type === 'ClassDeclaration') {
    const name = decl.id?.name
    if (!name) return
    units.push({
      name,
      kind: decl.type === 'ClassDeclaration' ? 'class' : 'function',
      exported,
      span: { start: decl.start, end: decl.end },
      body: src.slice(decl.start, decl.end),
      calls: collectCalls(decl),
      doc
    })
    return
  }
  if (decl.type === 'VariableDeclaration') {
    for (const d of decl.declarations ?? []) {
      const init = d.init
      const isFn = init && (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression')
      if (!isFn || d.id?.type !== 'Identifier') continue
      units.push({
        name: d.id.name,
        kind: 'const',
        exported,
        span: { start: init.start, end: init.end },
        body: src.slice(init.start, init.end),
        calls: collectCalls(init),
        doc
      })
    }
  }
}

/**
 * Юніт-шар для js/mjs/ts: top-level функції/класи/const-функції з тілом, JSDoc,
 * прапором експорту і ребрами call-graph (виклики ІНШИХ юнітів у тілі).
 * @param {string} src вміст файлу
 * @param {string} [relPath] шлях (для вибору мови oxc)
 * @returns {Array<{name:string, kind:string, exported:boolean, span:{start:number,end:number}, body:string, calls:string[], doc:string}>|null} юніти або null, якщо файл не парситься
 */
export function extractUnitsJs(src, relPath = 'scan.ts') {
  const program = parseProgramOrNull(src, relPath)
  if (!program || !Array.isArray(program.body)) return null

  const units = []
  for (const node of program.body) {
    const isExport =
      (node.type === 'ExportNamedDeclaration' || node.type === 'ExportDefaultDeclaration') && node.declaration
    if (isExport) {
      pushUnits(node.declaration, true, node.start, src, units)
    } else {
      pushUnits(node, false, node.start, src, units)
    }
  }

  // Ребра call-graph: лишаємо тільки виклики інших внутрішніх юнітів
  const names = new Set(units.map(u => u.name))
  for (const u of units) u.calls = [...u.calls].filter(n => names.has(n) && n !== u.name)
  return units
}

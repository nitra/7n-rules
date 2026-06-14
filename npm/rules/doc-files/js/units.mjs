/** @see ./docs/units.md */

import { extractUnitsJs } from './units-js.mjs'
import { extractUnitsRs } from './units-rs.mjs'

const JS_EXT = new Set(['js', 'mjs', 'ts', 'jsx', 'tsx', 'cts', 'mts'])

/**
 * Мовно-агностичний фасад юніт-шару. Диспатчить за розширенням:
 * js/mjs/ts → oxc AST; rs → regex+brace-counting; vue/py → null (whole-file шлях).
 * @param {string} src вміст файлу
 * @param {string} relPath шлях файлу
 * @returns {Array<object>|null} юніти або null, якщо мова ще не підтримана / файл не парситься
 */
export function extractUnits(src, relPath) {
  const ext = (relPath.split('.').pop() || '').toLowerCase()
  if (JS_EXT.has(ext)) return extractUnitsJs(src, relPath)
  if (ext === 'rs') return extractUnitsRs(src, relPath)
  return null
}

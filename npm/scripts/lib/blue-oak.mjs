/**
 * Читає вбудований Blue Oak Council snapshot (`npm/data/blue-oak.json`).
 * Повертає множину SPDX-ідентифікаторів рівнів Model+Gold+Silver+Bronze.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DATA_PATH = join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), 'data', 'blue-oak.json')

/**
 * Множина SPDX-ідентифікаторів Blue Oak Bronze і вище (Model+Gold+Silver+Bronze).
 * Ліцензії з цього списку вважаються permissive-safe для комерційного проєкту.
 * @returns {Set<string>}
 */
export function getBronzeAndAbove() {
  const { bronzeAndAbove } = JSON.parse(readFileSync(DATA_PATH, 'utf8'))
  return new Set(bronzeAndAbove)
}

/**
 * Генерує TOML-рядок `[licenses]` для `deny.toml` (cargo-deny) на основі Blue Oak Bronze+.
 * @returns {string}
 */
export function generateDenyTomlLicenses() {
  const ids = [...getBronzeAndAbove()].toSorted()
  const lines = ids.map(id => `    "${id}",`).join('\n')
  return `[licenses]\nallow = [\n${lines}\n]\n`
}

/**
 * Перевіряє SPDX-вираз проти Blue Oak Bronze+ allowlist.
 * Підтримує: одиночний ID, `A OR B` (будь-який дозволений = OK), `A AND B` (усі мають бути дозволені).
 * `NOASSERTION` і `NONE` завжди → false.
 * @param {string} expression SPDX-вираз з pip-licenses або іншого інструмента
 * @param {Set<string>} allowed множина дозволених SPDX-ідентифікаторів
 * @returns {boolean}
 */
export function isSpdxAllowed(expression, allowed) {
  if (!expression || expression === 'NOASSERTION' || expression === 'NONE') return false
  const clean = s => s.trim().replace(/^\(|\)$/g, '')
  if (expression.includes(' AND ')) return expression.split(' AND ').every(p => allowed.has(clean(p)))
  if (expression.includes(' OR ')) return expression.split(' OR ').some(p => allowed.has(clean(p)))
  return allowed.has(clean(expression))
}

/**
 * Перебір `rules/<id>/` директорій з фільтром на наявність `fix.mjs`.
 * Після атомарної міграції `fix.mjs` обов'язковий у кожному правилі — каталог без нього
 * пропускається (це not-a-rule або заглушка).
 */
import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * @param {string} bundledRulesDir абсолютний шлях до `npm/rules/`
 * @param {string} [filter] id одного правила (через `--rule abie`)
 * @returns {Promise<string[]>} відсортовані алфавітно id
 */
export async function listRuleIds(bundledRulesDir, filter) {
  const entries = await readdir(bundledRulesDir, { withFileTypes: true })
  const ids = entries
    .filter(e => e.isDirectory() && !e.name.startsWith('.'))
    .map(e => e.name)
    .filter(id => existsSync(join(bundledRulesDir, id, 'fix.mjs')))
    .filter(id => filter === undefined || id === filter)
  return ids.toSorted((a, b) => a.localeCompare(b))
}

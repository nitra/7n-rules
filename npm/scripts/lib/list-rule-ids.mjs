/**
 * Перебір `rules/<id>/` директорій з фільтром на наявність entrypoint-а.
 * Канон (ADR 2026-06-21): єдиний entrypoint `rules/<id>/main.mjs`. Каталог без нього —
 * пропускається (це not-a-rule або заглушка).
 */
import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Чи має каталог правила entrypoint `main.mjs`.
 * @param {string} ruleDir абсолютний шлях `rules/<id>/`
 * @returns {boolean} true, якщо `main.mjs` існує
 */
function hasEntrypoint(ruleDir) {
  return existsSync(join(ruleDir, 'main.mjs'))
}

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
    .filter(id => hasEntrypoint(join(bundledRulesDir, id)))
    .filter(id => filter === undefined || id === filter)
  return ids.toSorted((a, b) => a.localeCompare(b))
}

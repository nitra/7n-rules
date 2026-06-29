/**
 * Discovery правил для CLI `fix`/`check`. Сканує `rules/<id>/` для підкаталогів із `concern.json`.
 * Правила без жодного concern-а (тільки `.mdc`) фільтруються.
 */
import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

import { listConcerns } from './concern-meta.mjs'

/**
 * @typedef {import('./concern-meta.mjs').ConcernMeta} ConcernMeta
 */

/**
 * @typedef {object} CheckableRule
 * @property {string} id ідентифікатор правила (ім'я каталогу `rules/<id>/`)
 * @property {ConcernMeta[]} concerns усі concerns правила (алфавітно)
 */

/**
 * Будує `CheckableRule` для одного каталогу правила.
 * @param {string} ruleDir абсолютний шлях `rules/<id>/`
 * @param {string} ruleId id правила
 * @returns {Promise<CheckableRule>}
 */
export async function discoverOneRule(ruleDir, ruleId) {
  const concerns = await listConcerns(ruleDir)
  return { id: ruleId, concerns }
}

/**
 * Сканує `rules/` і повертає правила з хоча б одним concern-ом, відсортовані за id.
 * @param {string} bundledRulesDir абсолютний шлях до `npm/rules/`
 * @returns {Promise<CheckableRule[]>}
 */
export async function discoverCheckableRules(bundledRulesDir) {
  if (!existsSync(bundledRulesDir)) return []
  const entries = await readdir(bundledRulesDir, { withFileTypes: true })
  /** @type {CheckableRule[]} */
  const out = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const ruleDir = join(bundledRulesDir, entry.name)
    const rule = await discoverOneRule(ruleDir, entry.name)
    if (rule.concerns.length > 0) out.push(rule)
  }
  return out.toSorted((a, b) => a.id.localeCompare(b.id))
}

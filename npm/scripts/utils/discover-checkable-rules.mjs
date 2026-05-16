/**
 * Discovery rules для CLI `check`. Шукає правила, для яких є щось «прогонне»:
 *   - JS concerns:   `rules/<id>/fix/<concern>/<check.mjs | check-*.mjs>` — кожен concern окремий вузол.
 *   - Policy concerns: `rules/<id>/policy/<concern>/target.json` — пара з `<concern>.rego`.
 *
 * Каталог `fix/utils/` свідомо пропускається — це хелпери, не концерни.
 * Файли `*.test.mjs` фільтруються regex (`^check(?:-.+)?\.mjs$`).
 *
 * Намеренно НЕ парсимо `target.json` тут (це робить runner). Discovery — швидкий скан структури:
 * шляхи + назви, без I/O вмісту.
 *
 * Історичний контекст: до 1.11.12 існувала dual-mode підтримка `js/` (legacy) і `fix/` (новий),
 * де концерн мав поле `rootDir`. Після переїзду всіх 26 правил у `fix/` (CHANGELOG 1.11.10)
 * legacy-канал прибрано (CHANGELOG 1.11.12) — одне джерело правди.
 */
import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

const CHECK_FILENAME_RE = /^check(?:-.+)?\.mjs$/u
const TEST_SUFFIX = '.test.mjs'

/**
 * @typedef {object} JsConcern
 * @property {string} name імʼя концерну (`<name>` у `fix/<name>/`)
 * @property {string[]} files імена `check*.mjs` у концерні (відсортовані алфавітно)
 */

/**
 * @typedef {object} PolicyConcern
 * @property {string} name імʼя концерну (`<name>` у `policy/<name>/`)
 */

/**
 * @typedef {object} CheckableRule
 * @property {string} id ідентифікатор правила (імʼя каталогу `rules/<id>/`)
 * @property {JsConcern[]} jsConcerns JS-концерни правила (алфавітно)
 * @property {PolicyConcern[]} policyConcerns policy-концерни правила (алфавітно)
 */

/**
 * Перелічує JS-концерни одного правила: підкаталоги `fix/<name>/` з принаймні одним `check*.mjs`.
 *
 * `fix/utils/` свідомо пропускається — це хелпери, а не концерни.
 * @param {string} fixDir абсолютний шлях `rules/<id>/fix/`
 * @returns {Promise<JsConcern[]>} концерни в алфавітному порядку
 */
async function listJsConcerns(fixDir) {
  if (!existsSync(fixDir)) return []
  const topLevel = await readdir(fixDir, { withFileTypes: true })

  /** @type {JsConcern[]} */
  const concerns = []
  for (const entry of topLevel) {
    if (!entry.isDirectory() || entry.name === 'utils' || entry.name.startsWith('.')) continue
    const concernDir = join(fixDir, entry.name)
    const dirContents = await readdir(concernDir)
    const files = dirContents
      .filter(n => CHECK_FILENAME_RE.test(n) && !n.endsWith(TEST_SUFFIX))
      .toSorted((a, b) => a.localeCompare(b))
    if (files.length > 0) {
      concerns.push({ name: entry.name, files })
    }
  }

  return concerns.toSorted((a, b) => a.name.localeCompare(b.name))
}

/**
 * Перелічує policy-концерни: підкаталоги `policy/<name>/` з наявним `target.json`.
 * @param {string} policyDir абсолютний шлях `rules/<id>/policy/`
 * @returns {Promise<PolicyConcern[]>} концерни в алфавітному порядку
 */
async function listPolicyConcerns(policyDir) {
  if (!existsSync(policyDir)) return []
  const entries = await readdir(policyDir, { withFileTypes: true })
  /** @type {PolicyConcern[]} */
  const out = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    if (existsSync(join(policyDir, entry.name, 'target.json'))) {
      out.push({ name: entry.name })
    }
  }
  return out.toSorted((a, b) => a.name.localeCompare(b.name))
}

/**
 * Сканує `rules/` і повертає правила, для яких є JS-концерни (у `fix/`) або policy-концерни
 * (у `policy/`). Правила без жодної прогонної частини (тільки `.mdc` + `auto.md`) фільтруються.
 * @param {string} bundledRulesDir абсолютний шлях до `npm/rules/`
 * @returns {Promise<CheckableRule[]>} відсортовані за id
 */
export async function discoverCheckableRules(bundledRulesDir) {
  if (!existsSync(bundledRulesDir)) return []
  const entries = await readdir(bundledRulesDir, { withFileTypes: true })
  /** @type {CheckableRule[]} */
  const out = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const ruleDir = join(bundledRulesDir, entry.name)
    const jsConcerns = await listJsConcerns(join(ruleDir, 'fix'))
    const policyConcerns = await listPolicyConcerns(join(ruleDir, 'policy'))
    if (jsConcerns.length > 0 || policyConcerns.length > 0) {
      out.push({ id: entry.name, jsConcerns, policyConcerns })
    }
  }
  return out.toSorted((a, b) => a.id.localeCompare(b.id))
}

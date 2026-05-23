/**
 * Discovery rules для CLI `check`. Шукає правила, для яких є щось «прогонне»:
 *   - JS concerns:   `rules/<id>/js/<concern>/<check.mjs | check-*.mjs>` — кожен concern окремий вузол.
 *   - Policy concerns: `rules/<id>/policy/<concern>/target.json` — пара з `<concern>.rego`.
 *
 * Каталог `js/utils/` свідомо пропускається — це хелпери, не концерни.
 * Файли `*.test.mjs` фільтруються regex (`^check(?:-.+)?\.mjs$`).
 *
 * Намеренно НЕ парсимо `target.json` тут (це робить runner). Discovery — швидкий скан структури:
 * шляхи + назви, без I/O вмісту.
 *
 * Історичний контекст: convention пройшла еволюцію `js/` (до 1.11.12) → `fix/` (1.11.10–1.13.79)
 * → знову `js/` (1.13.80+, після появи кореневого `fix.mjs` як entry-point правила, щоб не плутати
 * з папкою `fix/`). Convention тепер за технологією: `js/` ↔ `policy/`.
 */
import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

const CHECK_FILENAME_RE = /^check(?:-.+)?\.mjs$/u
const TEST_SUFFIX = '.test.mjs'

/**
 * @typedef {object} JsConcern
 * @property {string} name імʼя концерну (`<name>` у `js/<name>/`)
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
 * Перелічує JS-концерни одного правила: підкаталоги `js/<name>/` з принаймні одним `check*.mjs`.
 *
 * `js/utils/` свідомо пропускається — це хелпери, а не концерни.
 * @param {string} jsDir абсолютний шлях `rules/<id>/js/`
 * @returns {Promise<JsConcern[]>} концерни в алфавітному порядку
 */
async function listJsConcerns(jsDir) {
  if (!existsSync(jsDir)) return []
  const topLevel = await readdir(jsDir, { withFileTypes: true })

  /** @type {JsConcern[]} */
  const concerns = []
  for (const entry of topLevel) {
    if (!entry.isDirectory() || entry.name === 'utils' || entry.name.startsWith('.')) continue
    const concernDir = join(jsDir, entry.name)
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
 * Будує `CheckableRule` для одного каталогу правила (без enumeration по `rules/`).
 * Використовується `runStandardRule` для per-rule entry-point flow.
 * @param {string} ruleDir абсолютний шлях `rules/<id>/`
 * @param {string} ruleId id правила (= basename(ruleDir))
 * @returns {Promise<CheckableRule>} опис правила (jsConcerns + policyConcerns)
 */
export async function discoverOneRule(ruleDir, ruleId) {
  const jsConcerns = await listJsConcerns(join(ruleDir, 'js'))
  const policyConcerns = await listPolicyConcerns(join(ruleDir, 'policy'))
  return { id: ruleId, jsConcerns, policyConcerns }
}

/**
 * Сканує `rules/` і повертає правила, для яких є JS-концерни (у `js/`) або policy-концерни
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
    const rule = await discoverOneRule(ruleDir, entry.name)
    if (rule.jsConcerns.length > 0 || rule.policyConcerns.length > 0) {
      out.push(rule)
    }
  }
  return out.toSorted((a, b) => a.id.localeCompare(b.id))
}

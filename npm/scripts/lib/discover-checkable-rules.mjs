/**
 * Discovery rules для CLI `fix`. Шукає правила, для яких є щось «прогонне»:
 *   - JS concerns:   `rules/<id>/js/<concern>.mjs` — один файл = один concern.
 *   - Policy concerns: `rules/<id>/policy/<concern>/target.json` — пара з `<concern>.rego`.
 *
 * Файли з префіксом `_` (зокрема каталог `_lib/`) і `*.test.mjs` пропускаються — це хелпери й тести.
 *
 * Намеренно НЕ парсимо `target.json` тут (це робить runner). Discovery — швидкий скан структури:
 * шляхи + назви, без I/O вмісту.
 *
 * Історичний контекст: convention пройшла еволюцію
 *   `js/<concern>/check.mjs` (1.13.80–1.13.89)
 *   → `js/<concern>.mjs` (1.13.90+, flat: концерн = файл, не каталог)
 * Helpers, tests, templates і data винесені в окремі топ-level папки правила (`js/_lib/`,
 * `tests/`, `templates/`, `data/`).
 */
import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { globby } from 'globby'

/**
 * @typedef {object} JsConcern
 * @property {string} name імʼя концерну (= basename файла `js/<name>.mjs` без розширення)
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
 * Перелічує JS-концерни одного правила: файли `js/<name>.mjs` (один файл — один concern).
 *
 * Файли з префіксом `_` (наприклад каталог `_lib/`) і `*.test.mjs` пропускаються.
 * @param {string} jsDir абсолютний шлях `rules/<id>/js/`
 * @returns {Promise<JsConcern[]>} концерни в алфавітному порядку
 */
async function listJsConcerns(jsDir) {
  if (!existsSync(jsDir)) return []
  const files = await globby(['*.mjs', '!*.test.mjs', '!fix-*.mjs', '!_*'], {
    cwd: jsDir,
    onlyFiles: true,
    gitignore: false
  })
  return files.map(f => ({ name: f.slice(0, -4) })).toSorted((a, b) => a.name.localeCompare(b.name))
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

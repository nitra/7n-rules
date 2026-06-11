/** @see ./docs/rule_meta.md */
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { createCheckReporter } from '../../../scripts/lib/check-reporter.mjs'
import { parseRuleAutoSpec, parseRuleLintPhase, readRuleMetaRaw } from '../../../scripts/lib/rule-meta.mjs'
import { RULE_PREDICATES } from '../../../scripts/lib/rule-predicates.mjs'

/**
 * Перевіряє поле `auto` у meta.json одного правила.
 * @param {string} id ідентифікатор правила
 * @param {Record<string, unknown>} raw сирий meta.json
 * @param {ReturnType<typeof createCheckReporter>} reporter репортер
 * @returns {boolean} true, якщо поле валідне (або відсутнє)
 */
function checkAutoField(id, raw, reporter) {
  if (raw.auto === undefined) return true
  const spec = parseRuleAutoSpec(raw.auto)
  if (spec === null) {
    reporter.fail(`rules/${id}: meta.json.auto нерозпізнане (очікується "завжди" / масив / {glob} / {predicate})`)
    return false
  }
  if ('predicate' in spec && !Object.hasOwn(RULE_PREDICATES, spec.predicate)) {
    reporter.fail(`rules/${id}: невідомий predicate "${spec.predicate}" (немає в RULE_PREDICATES)`)
    return false
  }
  return true
}

/**
 * Перевіряє поле `lint` у meta.json одного правила.
 * @param {string} id ідентифікатор правила
 * @param {string} ruleDir каталог правила
 * @param {Record<string, unknown>} raw сирий meta.json
 * @param {ReturnType<typeof createCheckReporter>} reporter репортер
 * @returns {boolean} true, якщо поле валідне (або відсутнє)
 */
function checkLintField(id, ruleDir, raw, reporter) {
  if (raw.lint === undefined) return true
  if (parseRuleLintPhase(raw.lint) === null) {
    reporter.fail(`rules/${id}: meta.json.lint нерозпізнане (очікується "quick"|"ci")`)
    return false
  }
  if (!existsSync(join(ruleDir, 'js', 'lint.mjs'))) {
    reporter.fail(`rules/${id}: lint:"${raw.lint}" але немає js/lint.mjs`)
    return false
  }
  return true
}

/**
 * Валідує meta.json одного правила.
 * @param {string} id ідентифікатор правила
 * @param {string} ruleDir каталог правила
 * @param {ReturnType<typeof createCheckReporter>} reporter репортер
 * @returns {void}
 */
function checkRule(id, ruleDir, reporter) {
  let ruleOk = true

  if (existsSync(join(ruleDir, 'auto.md'))) {
    reporter.fail(`rules/${id}: залишковий auto.md — видали (метадані тепер у meta.json)`)
    ruleOk = false
  }

  const raw = readRuleMetaRaw(ruleDir)
  if (!raw) {
    reporter.fail(`rules/${id}: відсутній або невалідний meta.json`)
    return
  }

  if (!checkAutoField(id, raw, reporter)) ruleOk = false
  if (!checkLintField(id, ruleDir, raw, reporter)) ruleOk = false

  if (ruleOk) {
    reporter.pass(`rules/${id}: meta.json валідний`)
  }
}

/**
 * Валідує всі `npm/rules/<id>/meta.json`.
 * @param {string} [cwd] корінь репозиторію
 * @returns {Promise<number>} 0 — OK, 1 — порушення
 */
export function check(cwd = process.cwd()) {
  const reporter = createCheckReporter()
  const rulesDir = join(cwd, 'npm', 'rules')
  if (!existsSync(rulesDir)) {
    reporter.pass('npm/rules/ відсутній — немає правил для валідації')
    return Promise.resolve(reporter.getExitCode())
  }

  for (const entry of readdirSync(rulesDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    checkRule(entry.name, join(rulesDir, entry.name), reporter)
  }

  return Promise.resolve(reporter.getExitCode())
}

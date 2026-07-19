/** @see ./docs/main.md */
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { createViolationReporter } from '@7n/rules/scripts/lib/lint-surface/violation-reporter.mjs'
import { parseRuleAutoSpec, readRuleMetaRaw } from '@7n/rules/scripts/lib/rule-meta.mjs'
import { RULE_PREDICATES } from '@7n/rules/scripts/lib/rule-predicates.mjs'

/**
 * Перевіряє поле `auto` у meta.json одного правила.
 * @param {string} id ідентифікатор правила
 * @param {Record<string, unknown>} raw сирий meta.json
 * @param {ReturnType<typeof createViolationReporter>} reporter репортер
 * @returns {boolean} true, якщо поле валідне (або відсутнє)
 */
function checkAutoField(id, raw, reporter) {
  if (raw.auto === undefined) return true
  const spec = parseRuleAutoSpec(raw.auto)
  if (spec === null) {
    const autoHint = 'нерозпізнане (очікується "завжди" / масив / {glob} / {predicate})'
    reporter.fail(`rules/${id}: main.json.auto ${autoHint}`)
    return false
  }
  if ('predicate' in spec && !Object.hasOwn(RULE_PREDICATES, spec.predicate)) {
    reporter.fail(`rules/${id}: main.json — невідомий predicate "${spec.predicate}" (немає в RULE_PREDICATES)`)
    return false
  }
  return true
}

/**
 * Забороняє залишкове поле `lint` у meta.json правила.
 * Канон (spec 2026-06-28-concern-lint-scope-design): lint-scope живе у
 * `<rule>/<concern>/concern.json#lint`, rule-level `main.json.lint` скасовано.
 * @param {string} id ідентифікатор правила
 * @param {Record<string, unknown>} raw сирий meta.json
 * @param {ReturnType<typeof createViolationReporter>} reporter репортер
 * @returns {boolean} true, якщо поле відсутнє
 */
function checkLintField(id, raw, reporter) {
  if (raw.lint === undefined) return true
  reporter.fail(`rules/${id}: main.json.lint скасовано — lint-scope декларується у <concern>/concern.json#lint`)
  return false
}

/**
 * Забороняє залишкове поле `llmFix` у meta.json правила.
 * Канон (scripts.mdc, spec 2026-06-28-concern-lint-scope-design): opt-in-прапорця
 * llmFix немає — fix-можливість концерну визначається наявністю `fix-*.mjs`/`fix-worker.mjs`.
 * @param {string} id ідентифікатор правила
 * @param {Record<string, unknown>} raw сирий meta.json
 * @param {ReturnType<typeof createViolationReporter>} reporter репортер
 * @returns {boolean} true, якщо поле відсутнє
 */
function checkLlmFixField(id, raw, reporter) {
  if (raw.llmFix === undefined) return true
  reporter.fail(
    `rules/${id}: main.json.llmFix скасовано — fix-можливість = наявність fix-*.mjs/fix-worker.mjs у концерні`
  )
  return false
}

/**
 * Валідує meta.json одного правила.
 * @param {string} id ідентифікатор правила
 * @param {string} ruleDir каталог правила
 * @param {ReturnType<typeof createViolationReporter>} reporter репортер
 * @returns {void}
 */
function checkRule(id, ruleDir, reporter) {
  let ruleOk = true

  if (existsSync(join(ruleDir, 'auto.md'))) {
    reporter.fail(`rules/${id}: залишковий auto.md — видали (метадані тепер у main.json)`)
    ruleOk = false
  }

  // Канон (scripts.mdc): main.mdc — ОБОВ'ЯЗКОВИЙ у кожному npm/rules/<id>/.
  if (!existsSync(join(ruleDir, 'main.mdc'))) {
    reporter.fail(`rules/${id}: відсутній main.mdc — обов'язковий (scripts.mdc)`)
    ruleOk = false
  }

  const raw = readRuleMetaRaw(ruleDir)
  if (!raw) {
    reporter.fail(`rules/${id}: відсутній або невалідний main.json`)
    return
  }

  if (!checkAutoField(id, raw, reporter)) ruleOk = false
  if (!checkLintField(id, raw, reporter)) ruleOk = false
  if (!checkLlmFixField(id, raw, reporter)) ruleOk = false

  if (ruleOk) {
    reporter.pass(`rules/${id}: main.json валідний`)
  }
}

/**
 * Валідує всі `npm/rules/<id>/meta.json`.
 * @param {import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintContext} ctx Контекст лінту (`cwd` тощо).
 * @returns {Promise<import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintResult>} Результат лінту зі списком violations.
 */
export function lint(ctx) {
  const cwd = ctx.cwd
  const reporter = createViolationReporter(ctx)
  const rulesDir = join(cwd, 'npm', 'rules')
  if (!existsSync(rulesDir)) {
    reporter.pass('npm/rules/ відсутній — немає правил для валідації')
    return Promise.resolve(reporter.result())
  }

  for (const entry of readdirSync(rulesDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    checkRule(entry.name, join(rulesDir, entry.name), reporter)
  }

  return Promise.resolve(reporter.result())
}

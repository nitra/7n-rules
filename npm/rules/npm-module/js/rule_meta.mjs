/** @see ./docs/rule_meta.md */
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { createCheckReporter } from '../../../scripts/lib/check-reporter.mjs'
import { parseRuleAutoSpec, parseRuleLintPhase, readRuleMetaRaw } from '../../../scripts/lib/rule-meta.mjs'
import { RULE_PREDICATES } from '../../../scripts/lib/rule-predicates.mjs'

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
    const id = entry.name
    const ruleDir = join(rulesDir, id)
    let ruleOk = true

    if (existsSync(join(ruleDir, 'auto.md'))) {
      reporter.fail(`rules/${id}: залишковий auto.md — видали (метадані тепер у meta.json)`)
      ruleOk = false
    }

    const raw = readRuleMetaRaw(ruleDir)
    if (!raw) {
      reporter.fail(`rules/${id}: відсутній або невалідний meta.json`)
      continue
    }
    if (raw.auto !== undefined) {
      const spec = parseRuleAutoSpec(raw.auto)
      if (spec === null) {
        reporter.fail(`rules/${id}: meta.json.auto нерозпізнане (очікується "завжди" / масив / {glob} / {predicate})`)
        ruleOk = false
      } else if ('predicate' in spec && !Object.hasOwn(RULE_PREDICATES, spec.predicate)) {
        reporter.fail(`rules/${id}: невідомий predicate "${spec.predicate}" (немає в RULE_PREDICATES)`)
        ruleOk = false
      }
    }
    if (raw.lint !== undefined) {
      if (parseRuleLintPhase(raw.lint) === null) {
        reporter.fail(`rules/${id}: meta.json.lint нерозпізнане (очікується "quick"|"ci")`)
        ruleOk = false
      } else if (!existsSync(join(ruleDir, 'js', 'lint.mjs'))) {
        reporter.fail(`rules/${id}: lint:"${raw.lint}" але немає js/lint.mjs`)
        ruleOk = false
      }
    }
    if (ruleOk) {
      reporter.pass(`rules/${id}: meta.json валідний`)
    }
  }

  return Promise.resolve(reporter.getExitCode())
}

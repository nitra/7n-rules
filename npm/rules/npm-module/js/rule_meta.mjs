/**
 * Перевірка метаданих правил пакета `@nitra/cursor` (концерн правила npm-module).
 *
 * Кожен `npm/rules/<id>/` має містити валідний `meta.json`:
 *  - `auto` (якщо присутнє) — розпізнане `parseRuleAutoSpec` (завжди / масив / glob / predicate);
 *  - для `predicate` — імʼя є в реєстрі `RULE_PREDICATES`;
 *  - залишковий `auto.md` заборонено (міграція на meta.json завершена).
 *
 * Застосовний лише в репо пакета (де є `npm/rules/`); у споживача каталогу нема — пропуск.
 */
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { createCheckReporter } from '../../../scripts/lib/check-reporter.mjs'
import { parseRuleAutoSpec, readRuleMetaRaw } from '../../../scripts/lib/rule-meta.mjs'
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
    if (ruleOk) {
      reporter.pass(`rules/${id}: meta.json валідний`)
    }
  }

  return Promise.resolve(reporter.getExitCode())
}

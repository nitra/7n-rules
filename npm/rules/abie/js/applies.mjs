/** @see ./docs/applies.md */
import { createCheckReporter } from '../../../scripts/lib/check-reporter.mjs'

import { isAbieRuleEnabled } from '../lib/enabled.mjs'

/**
 * @param {string} [cwd] корінь репозиторію
 * @returns {Promise<boolean>} `true` — правило застосовне; `false` — пропустити
 */
export function applies(cwd = process.cwd()) {
  return isAbieRuleEnabled(cwd)
}

/**
 * @returns {number} exit-код (0 — OK, 1 — порушення)
 */
export function main() {
  const reporter = createCheckReporter()
  reporter.pass('Правило abie увімкнено — виконуємо перевірки')
  return reporter.getExitCode()
}

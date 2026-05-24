/**
 * Applies-гейт правила abie: rule-level через `isAbieRuleEnabled` (поле `rules` у `.n-cursor.json`).
 * Якщо повертає `false` — CLI пропускає всі концерни (JS і policy) цього правила.
 * `check()` друкує тільки context-pass; решта концернів роблять справжню роботу.
 */
import { createCheckReporter } from '../../../../scripts/utils/check-reporter.mjs'

import { isAbieRuleEnabled } from '../../utils/enabled.mjs'

/**
 * @returns {Promise<boolean>} `true` — правило застосовне; `false` — пропустити
 */
export function applies() {
  return isAbieRuleEnabled(process.cwd())
}

/**
 * @returns {number} exit-код (0 — OK, 1 — порушення)
 */
export function check() {
  const reporter = createCheckReporter()
  reporter.pass('Правило abie увімкнено — виконуємо перевірки')
  return reporter.getExitCode()
}

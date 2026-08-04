/**
 * @see ./docs/applies.md
 *
 * Гейт застосовності правила ТУТ БІЛЬШЕ НЕ ЖИВЕ: він декларативний і лежить
 * у `python/main.json:applies` (`{ "pathExists": "pyproject.toml" }`). Цей
 * модуль лишився суто context-pass концерном — друкує, чому правило активне.
 */
import { createViolationReporter } from '@7n/rules/scripts/lib/lint-surface/violation-reporter.mjs'

/**
 * Друкує короткий context-pass — самі перевірки виконують інші concerns.
 * @param {import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінту.
 * @returns {Promise<import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintResult>} результат context-pass
 */
export function lint(ctx) {
  const reporter = createViolationReporter(ctx)
  reporter.pass('pyproject.toml знайдено в корені — застосовую python.mdc')
  return Promise.resolve(reporter.result())
}

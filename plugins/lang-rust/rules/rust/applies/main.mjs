/**
 * @see ./docs/applies.md
 *
 * Гейт застосовності правила ТУТ БІЛЬШЕ НЕ ЖИВЕ: він декларативний і лежить
 * у `rust/main.json:applies` (`globMatches` по `**​/Cargo.toml` з явним
 * `ignoreDirs`). Цей модуль лишився суто context-pass концерном.
 */
import { createViolationReporter } from '@7n/rules/scripts/lib/lint-surface/violation-reporter.mjs'

/**
 * @param {import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінту.
 * @returns {Promise<import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintResult>} результат context-pass
 */
export function lint(ctx) {
  const reporter = createViolationReporter(ctx)
  reporter.pass('Знайдено Cargo.toml — застосовуємо правила rust.mdc')
  return Promise.resolve(reporter.result())
}

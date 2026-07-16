/** @see ./docs/tooling.md */
import { existsSync } from 'node:fs'

import { createViolationReporter } from '../../../scripts/lib/lint-surface/violation-reporter.mjs'

/**
 * Перевіряє відповідність проєкту правилам php.mdc.
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінту.
 * @returns {Promise<import('../../../scripts/lib/lint-surface/types.mjs').LintResult>} результат із порушеннями
 */
export function lint(ctx) {
  const reporter = createViolationReporter(ctx)
  const { pass, fail } = reporter

  if (existsSync('composer.json')) {
    pass('composer.json існує')
  } else {
    fail('composer.json не знайдено в корені — додай (php.mdc)')
  }

  if (existsSync('package.json')) {
    pass('package.json є')
  } else {
    fail('package.json не знайдено в корені — додай (php.mdc)')
  }

  // Existence/структуру lint-php.yml вимагає провайдер-плагін @7n/rules-ci-github
  // (mixin php/lint_php_yml) — ядро провайдер-агностичне.
  return Promise.resolve(reporter.result())
}

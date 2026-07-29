/**
 * @see ./docs/tooling.md
 *
 * Nested Composer workspaces (ADR `2026-07-27-nested-composer-workspace-detection`): перевіряє
 * лише кореневий `composer.json`/`package.json` (свідоме обмеження — деталі в `tooling.mdc`).
 */
import { existsSync } from 'node:fs'

import { createViolationReporter } from '@7n/rules/scripts/lib/lint-surface/violation-reporter.mjs'

/**
 * Перевіряє відповідність проєкту правилам php.mdc.
 * @param {import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінту.
 * @returns {Promise<import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintResult>} результат із порушеннями
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

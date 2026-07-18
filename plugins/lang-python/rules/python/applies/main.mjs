/** @see ./docs/applies.md */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { createViolationReporter } from '@7n/rules/scripts/lib/lint-surface/violation-reporter.mjs'

/**
 * @param {string} [cwd] корінь репозиторію (`process.cwd()` у звичайному прогоні)
 * @returns {Promise<boolean>} `true` — правило застосовне; `false` — пропустити
 */
export function applies(cwd = process.cwd()) {
  return Promise.resolve(existsSync(join(cwd, 'pyproject.toml')))
}

/**
 * Друкує короткий context-pass — самі перевірки виконують інші concerns.
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінту.
 * @returns {Promise<import('../../../scripts/lib/lint-surface/types.mjs').LintResult>} результат context-pass
 */
export function lint(ctx) {
  const reporter = createViolationReporter(ctx)
  reporter.pass('pyproject.toml знайдено в корені — застосовую python.mdc')
  return Promise.resolve(reporter.result())
}

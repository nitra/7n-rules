/** @see ./docs/tooling.md */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { createViolationReporter } from '../../../scripts/lib/lint-surface/violation-reporter.mjs'

/**
 * Перевіряє наявність `.regal/config.yaml` у корені проєкту.
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст lint-прогону (cwd тощо)
 * @returns {import('../../../scripts/lib/lint-surface/types.mjs').LintResult} результат зі зібраними violations
 */
export function lint(ctx) {
  const cwd = ctx.cwd
  const reporter = createViolationReporter(ctx)
  const { pass, fail } = reporter

  const regalConfig = join(cwd, '.regal', 'config.yaml')
  if (existsSync(regalConfig)) {
    pass('.regal/config.yaml існує (rego.mdc)')
  } else {
    fail('.regal/config.yaml не існує — створи у корені проєкту (rego.mdc)')
  }

  return reporter.result()
}

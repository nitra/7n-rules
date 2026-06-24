/** @see ./docs/tooling.md */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { createCheckReporter } from '../../../scripts/lib/check-reporter.mjs'

/**
 * Перевіряє наявність `.regal/config.yaml` у корені проєкту.
 * @param {string} [cwd] корінь репозиторію
 * @returns {Promise<number>} 0 — все OK, 1 — є проблеми
 */
export async function check(cwd = process.cwd()) {
  const reporter = createCheckReporter()
  const { pass, fail } = reporter

  const regalConfig = join(cwd, '.regal', 'config.yaml')
  if (existsSync(regalConfig)) {
    pass('.regal/config.yaml існує (rego.mdc)')
  } else {
    fail('.regal/config.yaml не існує — створи у корені проєкту (rego.mdc)')
  }

  return reporter.getExitCode()
}

/** @see ./docs/marksman_config.md */
import { existsSync } from 'node:fs'
import { copyFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createViolationReporter } from '../../../scripts/lib/lint-surface/violation-reporter.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const MARKSMAN_BASELINE_PATH = join(HERE, 'data', 'marksman_config', 'marksman.baseline.toml')
const MARKSMAN_TARGET_FILENAME = '.marksman.toml'

/**
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx
 * @returns {Promise<import('../../../scripts/lib/lint-surface/types.mjs').LintResult>}
 */
export async function lint(ctx) {
  const cwd = ctx.cwd
  const reporter = createViolationReporter(ctx)

  if (!existsSync(MARKSMAN_BASELINE_PATH)) {
    reporter.fail(`canonical baseline не знайдено (${MARKSMAN_BASELINE_PATH}) — перевстанови @nitra/cursor`)
    return reporter.result()
  }

  const target = join(cwd, MARKSMAN_TARGET_FILENAME)
  if (existsSync(target)) {
    reporter.pass(`${MARKSMAN_TARGET_FILENAME} існує (${relative(cwd, target)})`)
    return reporter.result()
  }

  await copyFile(MARKSMAN_BASELINE_PATH, target)
  reporter.pass(`${MARKSMAN_TARGET_FILENAME} створено з canonical baseline (${relative(cwd, target)}) (ci4.mdc)`)
  return reporter.result()
}

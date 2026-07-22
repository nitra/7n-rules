/** @see ./docs/marksman_config.md */
import { existsSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createViolationReporter } from '../../../scripts/lib/lint-surface/violation-reporter.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
/** Абсолютний шлях до канонічного baseline-конфігу marksman, що постачається разом із пакетом правил. */
export const MARKSMAN_BASELINE_PATH = join(HERE, 'data', 'marksman_config', 'marksman.baseline.toml')
/** Імʼя конфіг-файлу marksman, який має лежати в корені репозиторію. */
export const MARKSMAN_TARGET_FILENAME = '.marksman.toml'

/**
 * Перевіряє наявність `.marksman.toml` у корені; сигналить копіювання canonical baseline.
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінту (cwd, репортер).
 * @returns {import('../../../scripts/lib/lint-surface/types.mjs').LintResult} результат перевірки з pass/fail.
 */
export function lint(ctx) {
  const cwd = ctx.cwd
  const reporter = createViolationReporter(ctx)

  if (!existsSync(MARKSMAN_BASELINE_PATH)) {
    reporter.fail(`canonical baseline не знайдено (${MARKSMAN_BASELINE_PATH}) — перевстанови @7n/rules`)
    return reporter.result()
  }

  const target = join(cwd, MARKSMAN_TARGET_FILENAME)
  if (existsSync(target)) {
    reporter.pass(`${MARKSMAN_TARGET_FILENAME} існує (${relative(cwd, target)})`)
    return reporter.result()
  }

  reporter.fail(`${MARKSMAN_TARGET_FILENAME} відсутній — T0 скопіює canonical baseline (ci4.mdc)`, {
    reason: 'marksman-config-missing',
    file: MARKSMAN_TARGET_FILENAME,
    data: { kind: 'marksman-config-missing' }
  })
  return reporter.result()
}

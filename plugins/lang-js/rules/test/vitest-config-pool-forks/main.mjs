/** @see ./docs/vitest-config-pool-forks.md */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { createViolationReporter } from '@7n/rules/scripts/lib/lint-surface/violation-reporter.mjs'

/** Subтring-pattern: `pool: 'forks'` або `pool: "forks"` (з опційним whitespace). */
const POOL_FORKS_RE = /pool\s*:\s*['"]forks['"]/u

// Канонічна назва — `.mjs` (нові файли, js.mdc), але legacy `.js` лишається
// валідним. Перший знайдений виграє: `.mjs` пріоритетніший.
const VITEST_CONFIG_NAMES = ['vitest.config.mjs', 'vitest.config.js']

/**
 * Перевіряє, що `vitest.config.{mjs,js}` (якщо існує) містить `pool: 'forks'`.
 * @param {import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінт-прогону.
 * @returns {Promise<import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintResult>} результат перевірки наявності `pool: 'forks'`.
 */
export async function lint(ctx) {
  const reporter = createViolationReporter(ctx)
  const { pass, fail } = reporter

  const cwdParam = ctx.cwd
  const configName = VITEST_CONFIG_NAMES.find(name => existsSync(join(cwdParam, name)))
  if (!configName) {
    pass('vitest.config.mjs/.js відсутній — pool-перевірку пропущено')
    return reporter.result()
  }

  const body = await readFile(join(cwdParam, configName), 'utf8')
  if (POOL_FORKS_RE.test(body)) {
    pass(`${configName} містить pool: 'forks' (test.mdc)`)
  } else {
    fail(
      `${configName} має містити pool: 'forks' — defense-in-depth для race у process.cwd() між паралельними test files (test.mdc)`
    )
  }

  return reporter.result()
}

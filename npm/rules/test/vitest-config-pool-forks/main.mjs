/** @see ./docs/vitest-config-pool-forks.md */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { createCheckReporter } from '../../../scripts/lib/check-reporter.mjs'

/** Subтring-pattern: `pool: 'forks'` або `pool: "forks"` (з опційним whitespace). */
const POOL_FORKS_RE = /pool\s*:\s*['"]forks['"]/u

// Канонічна назва — `.mjs` (нові файли, js.mdc), але legacy `.js` лишається
// валідним. Перший знайдений виграє: `.mjs` пріоритетніший.
const VITEST_CONFIG_NAMES = ['vitest.config.mjs', 'vitest.config.js']

/**
 * Перевіряє, що `vitest.config.{mjs,js}` (якщо існує) містить `pool: 'forks'`.
 * @param {string} [cwdParam] корінь репозиторію
 * @returns {Promise<number>} 0 — OK або skip, 1 — config без `pool: 'forks'`
 */
export async function main(cwdParam = process.cwd()) {
  const reporter = createCheckReporter()
  const { pass, fail } = reporter

  const configName = VITEST_CONFIG_NAMES.find(name => existsSync(join(cwdParam, name)))
  if (!configName) {
    pass('vitest.config.mjs/.js відсутній — pool-перевірку пропущено')
    return reporter.getExitCode()
  }

  const body = await readFile(join(cwdParam, configName), 'utf8')
  if (POOL_FORKS_RE.test(body)) {
    pass(`${configName} містить pool: 'forks' (test.mdc)`)
  } else {
    fail(
      `${configName} має містити pool: 'forks' — defense-in-depth для race у process.cwd() між паралельними test files (test.mdc)`
    )
  }

  return reporter.getExitCode()
}

/** @see ./docs/vitest-config-pool-forks.md */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { createCheckReporter } from '../../../scripts/lib/check-reporter.mjs'

/** Subтring-pattern: `pool: 'forks'` або `pool: "forks"` (з опційним whitespace). */
const POOL_FORKS_RE = /pool\s*:\s*['"]forks['"]/u

/**
 * Перевіряє, що `vitest.config.js` (якщо існує) містить `pool: 'forks'`.
 * @param {string} [cwdParam] корінь репозиторію
 * @returns {Promise<number>} 0 — OK або skip, 1 — config без `pool: 'forks'`
 */
export async function check(cwdParam = process.cwd()) {
  const reporter = createCheckReporter()
  const { pass, fail } = reporter

  const configPath = join(cwdParam, 'vitest.config.js')
  if (!existsSync(configPath)) {
    pass('vitest.config.js відсутній — pool-перевірку пропущено')
    return reporter.getExitCode()
  }

  const body = await readFile(configPath, 'utf8')
  if (POOL_FORKS_RE.test(body)) {
    pass("vitest.config.js містить pool: 'forks' (test.mdc)")
  } else {
    fail(
      "vitest.config.js має містити pool: 'forks' — defense-in-depth для race у process.cwd() між паралельними test files (test.mdc)"
    )
  }

  return reporter.getExitCode()
}

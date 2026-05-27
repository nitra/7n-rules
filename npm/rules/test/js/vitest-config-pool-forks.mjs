/**
 * `vitest.config.js` має ставити `pool: 'forks'` — defense-in-depth для
 * race-bug у `process.cwd()` (test.mdc, секція "Заборона `process.chdir` у тестах").
 *
 * Чому не достатньо самої заборони `process.chdir(`: third-party код у залежностях
 * може робити chdir всередині vitest worker'а. У `pool: 'threads'` (default) усі
 * workers ділять один процес → race на `process.cwd()` між паралельними test
 * files. `pool: 'forks'` ізолює кожен test file у власному child-процесі.
 *
 * Перевірка — substring у source-тексті `vitest.config.js`. Не парсимо JS AST,
 * бо це може бути будь-який export-формат (ESM default, named, CommonJS).
 * Достатньо знайти `pool:` із значенням `'forks'`/`"forks"` (whitespace дозволений).
 *
 * Скіпи: правило не застосовне, якщо `vitest.config.js` не існує (нема vitest
 * у проєкті) — це не помилка, лише skip. Якщо файл є — `pool: 'forks'`
 * обов'язковий.
 */
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

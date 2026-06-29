/** @see ./docs/forbidden-prettier.md */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { createCheckReporter } from '../../../scripts/lib/check-reporter.mjs'

/** Файли, які Prettier шукає у корені; всі заборонені (text.mdc). */
const FORBIDDEN_PRETTIER_FILES = [
  '.prettierignore',
  '.prettierrc',
  '.prettierrc.json',
  '.prettierrc.jsonc',
  '.prettierrc.json5',
  '.prettierrc.yaml',
  '.prettierrc.yml',
  '.prettierrc.toml',
  '.prettierrc.js',
  '.prettierrc.cjs',
  '.prettierrc.mjs',
  '.prettierrc.ts',
  '.prettierrc.cts',
  '.prettierrc.mts',
  'prettier.config.js',
  'prettier.config.cjs',
  'prettier.config.mjs',
  'prettier.config.ts',
  'prettier.config.cts',
  'prettier.config.mts'
]

/**
 * Перевіряє, що жоден Prettier-конфіг чи ignore-файл не лежить у корені проєкту.
 * @param {string} [cwd] корінь репозиторію
 * @returns {number} 0 — все OK, 1 — знайдено заборонений файл
 */
export function main(cwd = process.cwd()) {
  const reporter = createCheckReporter()
  const { pass, fail } = reporter

  let anyFound = false
  for (const file of FORBIDDEN_PRETTIER_FILES) {
    if (existsSync(join(cwd, file))) {
      fail(`${file} заборонено — Prettier не використовуємо, перейди на oxfmt (text.mdc)`)
      anyFound = true
    }
  }
  if (!anyFound) {
    pass('Prettier-конфігів і .prettierignore немає в корені')
  }

  return reporter.getExitCode()
}

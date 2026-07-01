/** @see ./docs/forbidden-prettier.md */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { createViolationReporter } from '../../../scripts/lib/lint-surface/violation-reporter.mjs'

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
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінту (cwd, репортер).
 * @returns {import('../../../scripts/lib/lint-surface/types.mjs').LintResult} результат перевірки з pass/fail.
 */
export function lint(ctx) {
  const reporter = createViolationReporter(ctx)
  const { pass, fail } = reporter

  const cwd = ctx.cwd

  let anyFound = false
  for (const file of FORBIDDEN_PRETTIER_FILES) {
    if (!existsSync(join(cwd, file))) {
      continue
    }

    fail(`${file} заборонено — Prettier не використовуємо, перейди на oxfmt (text.mdc)`)
    anyFound = true
  }
  if (!anyFound) {
    pass('Prettier-конфігів і .prettierignore немає в корені')
  }

  return reporter.result()
}

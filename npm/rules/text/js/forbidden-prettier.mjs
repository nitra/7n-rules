/**
 * Suspect FS-перевірка: жоден Prettier-артефакт у корені проєкту не дозволений.
 *
 * `text.mdc` забороняє `prettier`, `@nitra/prettier-config` і всі прояви Prettier-конфігів.
 * Rego-полісі `text.package_json` ловить scripts/dependencies/devDependencies; цей concern
 * ловить FS-сторону — конфіги й ignore-файли, які runner Prettier зчитує автоматично.
 *
 * Список синхронізовано з конфіг-форматами Prettier 3.x
 * (https://prettier.io/docs/configuration). Якщо Prettier додасть новий формат — додай рядок.
 */
import { existsSync } from 'node:fs'

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
 * @returns {number} 0 — все OK, 1 — знайдено заборонений файл
 */
export function check() {
  const reporter = createCheckReporter()
  const { pass, fail } = reporter

  let anyFound = false
  for (const file of FORBIDDEN_PRETTIER_FILES) {
    if (existsSync(file)) {
      fail(`${file} заборонено — Prettier не використовуємо, перейди на oxfmt (text.mdc)`)
      anyFound = true
    }
  }
  if (!anyFound) {
    pass('Prettier-конфігів і .prettierignore немає в корені')
  }

  return reporter.getExitCode()
}

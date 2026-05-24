/**
 * Перевіряє вимоги правила php.mdc для PHP-проєктів.
 *
 * **Що тут лишилося** (FS-existence — не покривається conftest):
 *  - наявність `composer.json` у корені;
 *  - наявність `.github/workflows/lint-php.yml`.
 *
 * **Що покрила Rego** (`npx \@nitra/cursor check`):
 *  - `npm/policy/php/package_json/` — наявність скрипта `lint-php` у `package.json`;
 *  - `npm/policy/php/lint_php_yml/` — крок `run: bun run lint-php` у workflow.
 */
import { existsSync } from 'node:fs'

import { createCheckReporter } from '../../../scripts/lib/check-reporter.mjs'

/**
 * Перевіряє відповідність проєкту правилам php.mdc.
 * @returns {number} 0 — все OK, 1 — є проблеми
 */
export function check() {
  const reporter = createCheckReporter()
  const { pass, fail } = reporter

  if (existsSync('composer.json')) {
    pass('composer.json існує')
  } else {
    fail('composer.json не знайдено в корені — додай (php.mdc)')
  }

  if (existsSync('package.json')) {
    pass('package.json є (наявність lint-php перевіряє npx @nitra/cursor fix → php.package_json)')
  } else {
    fail('package.json не знайдено в корені — додай (php.mdc)')
  }

  const wfPath = '.github/workflows/lint-php.yml'
  if (existsSync(wfPath)) {
    pass(`${wfPath} є (структуру перевіряє npx @nitra/cursor fix → php.lint_php_yml)`)
  } else {
    fail(`${wfPath} не існує — створи згідно php.mdc`)
  }

  return reporter.getExitCode()
}

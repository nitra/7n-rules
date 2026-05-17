/**
 * FS-частина правила `security`.
 *
 * Перевіряє:
 *  - наявність `package.json` (структуру валідує Rego);
 *  - контекстне pass-повідомлення для JS-концерну.
 *
 * Наявність і вміст `.gitleaks.toml` (`[extend].useDefault = true`) тепер
 * перевіряє policy `security.gitleaks`.
 */
import { existsSync } from 'node:fs'

import { createCheckReporter } from '../../../../scripts/utils/check-reporter.mjs'

export async function check() {
  const reporter = createCheckReporter()
  const { pass, fail } = reporter
  if (!existsSync('package.json')) {
    fail('package.json не знайдено в корені — додай (security.mdc)')
    return reporter.getExitCode()
  }
  pass('package.json є (структуру перевіряє Rego)')
  pass('.gitleaks.toml перевіряє npx @nitra/cursor check → security.gitleaks')
  return reporter.getExitCode()
}

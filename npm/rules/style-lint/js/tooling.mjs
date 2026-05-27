/**
 * Перевіряє CSS/SCSS лінт за правилом style-lint.mdc.
 *
 * **Що тут лишилося** (FS / cross-file — не покривається conftest):
 *  - наявність зовнішнього файлу конфігу stylelint (`.stylelintrc.*`,
 *    `stylelint.config.js`) як альтернатива полю `stylelint` у `package.json`
 *    (cross-file: треба знати, чи є поле, чи немає);
 *  - `.stylelintignore` у корені.
 *
 * **Що покрила Rego** (`npx \@nitra/cursor check`):
 *  - `npm/policy/style_lint/package_json/` — скрипт `lint-style` через `npx stylelint`,
 *    `@nitra/stylelint-config` у `devDependencies`, поле `stylelint.extends`;
 *  - `npm/policy/style_lint/lint_style_yml/` — `npx stylelint` у `run` workflow;
 *  - `npm/policy/style_lint/vscode_extensions/` — `stylelint.vscode-stylelint`
 *    у `recommendations` `.vscode/extensions.json`;
 *  - `npm/policy/style_lint/vscode_settings/` — `css.validate`/`scss.validate`/
 *    `less.validate: false` у `.vscode/settings.json`.
 * @param {string} cwd корінь репозиторію
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { createCheckReporter } from '../../../scripts/lib/check-reporter.mjs'

/**
 * Альтернатива полю `stylelint` у `package.json` — зовнішній файл конфігу. Якщо
 * поля немає і файлу немає, фейлимося; якщо є хоч щось — пропускаємо. Поле
 * `stylelint.extends == "@nitra/stylelint-config"` сам формат — у Rego.
 * @param {import('../../../scripts/lib/check-reporter.mjs').CheckReporter} reporter репортер
 * @param {string} cwd корінь репозиторію
 */
async function checkStylelintConfigPresence(reporter, cwd) {
  const { pass, fail } = reporter
  const pkgPath = join(cwd, 'package.json')
  if (!existsSync(pkgPath)) return
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8'))
  const hasField = pkg.stylelint && typeof pkg.stylelint === 'object'
  const hasExternalCfg =
    existsSync(join(cwd, '.stylelintrc.json')) ||
    existsSync(join(cwd, '.stylelintrc.js')) ||
    existsSync(join(cwd, 'stylelint.config.js'))
  if (hasField || hasExternalCfg) {
    pass('Конфіг stylelint є — у package.json або окремим файлом')
  } else {
    fail('Немає конфігу stylelint — додай "stylelint": { "extends": "@nitra/stylelint-config" } до package.json')
  }
}

// `.vscode/extensions.json` (`stylelint.vscode-stylelint`) і `.vscode/settings.json`
// (`css.validate`/`scss.validate`/`less.validate: false`) — у rego-пакетах
// `style_lint.vscode_extensions` і `style_lint.vscode_settings`, прогоняє
// `npx @nitra/cursor fix`. JS-копії видалено, щоб не було двох джерел істини.

/**
 * Перевіряє відповідність проєкту правилам style-lint.mdc
 * @param {string} [cwd] корінь репозиторію
 * @returns {Promise<number>} 0 — все OK, 1 — є проблеми
 */
export async function check(cwd = process.cwd()) {
  const reporter = createCheckReporter()
  const { pass, fail } = reporter

  await checkStylelintConfigPresence(reporter, cwd)

  if (existsSync(join(cwd, '.stylelintignore'))) {
    pass('.stylelintignore існує')
  } else {
    fail('.stylelintignore не існує — створи з вмістом: dist/')
  }

  const wfPath = '.github/workflows/lint-style.yml'
  if (existsSync(join(cwd, wfPath))) {
    pass(`${wfPath} є (структуру перевіряє npx @nitra/cursor fix → style_lint.lint_style_yml)`)
  } else {
    fail(`${wfPath} не існує — створи його`)
  }

  return reporter.getExitCode()
}

/**
 * Перевіряє CSS/SCSS лінт за правилом style-lint.mdc.
 *
 * **Що тут лишилося** (FS / VSCode-конфіги — не покривається conftest):
 *  - наявність зовнішнього файлу конфігу stylelint (`.stylelintrc.*`,
 *    `stylelint.config.js`) як альтернатива полю `stylelint` у `package.json`
 *    (cross-file: треба знати, чи є поле, чи немає);
 *  - `.stylelintignore` у корені;
 *  - `.vscode/extensions.json` recommendation `stylelint.vscode-stylelint`;
 *  - `.vscode/settings.json` `css.validate` / `scss.validate` / `less.validate: false`.
 *
 * **Що покрила Rego** (`bun run lint-conftest`):
 *  - `npm/policy/style_lint/package_json/` — скрипт `lint-style` через `npx stylelint`,
 *    `@nitra/stylelint-config` у `devDependencies`, поле `stylelint.extends`;
 *  - `npm/policy/style_lint/lint_style_yml/` — `npx stylelint` у `run` workflow.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

import { createCheckReporter } from './utils/check-reporter.mjs'

/**
 * Альтернатива полю `stylelint` у `package.json` — зовнішній файл конфігу. Якщо
 * поля немає і файлу немає, фейлимося; якщо є хоч щось — пропускаємо. Поле
 * `stylelint.extends == "@nitra/stylelint-config"` сам формат — у Rego.
 * @param {import('./utils/check-reporter.mjs').CheckReporter} reporter репортер
 */
async function checkStylelintConfigPresence(reporter) {
  const { pass, fail } = reporter
  if (!existsSync('package.json')) return
  const pkg = JSON.parse(await readFile('package.json', 'utf8'))
  const hasField = pkg.stylelint && typeof pkg.stylelint === 'object'
  const hasExternalCfg =
    existsSync('.stylelintrc.json') || existsSync('.stylelintrc.js') || existsSync('stylelint.config.js')
  if (hasField || hasExternalCfg) {
    pass('Конфіг stylelint є — у package.json або окремим файлом')
  } else {
    fail('Немає конфігу stylelint — додай "stylelint": { "extends": "@nitra/stylelint-config" } до package.json')
  }
}

/**
 * @param {import('./utils/check-reporter.mjs').CheckReporter} reporter репортер для збору результатів
 */
async function checkVscodeStylelint(reporter) {
  const { pass, fail } = reporter
  if (existsSync('.vscode/extensions.json')) {
    const ext = JSON.parse(await readFile('.vscode/extensions.json', 'utf8'))
    if (ext.recommendations?.includes('stylelint.vscode-stylelint')) {
      pass('extensions.json містить stylelint.vscode-stylelint')
    } else {
      fail('extensions.json не містить stylelint.vscode-stylelint')
    }
  } else {
    fail('.vscode/extensions.json не існує')
  }

  if (!existsSync('.vscode/settings.json')) return
  const s = JSON.parse(await readFile('.vscode/settings.json', 'utf8'))
  for (const key of ['css.validate', 'scss.validate', 'less.validate']) {
    if (s[key] === false) {
      pass(`${key} вимкнено`)
    } else {
      fail(`settings.json: ${key} має бути false`)
    }
  }
}

/**
 * Перевіряє відповідність проєкту правилам style-lint.mdc
 * @returns {Promise<number>} 0 — все OK, 1 — є проблеми
 */
export async function check() {
  const reporter = createCheckReporter()
  const { pass, fail } = reporter

  await checkStylelintConfigPresence(reporter)

  if (existsSync('.stylelintignore')) {
    pass('.stylelintignore існує')
  } else {
    fail('.stylelintignore не існує — створи з вмістом: dist/')
  }

  const wfPath = '.github/workflows/lint-style.yml'
  if (existsSync(wfPath)) {
    pass(`${wfPath} є (структуру перевіряє bun run lint-conftest → style_lint.lint_style_yml)`)
  } else {
    fail(`${wfPath} не існує — створи його`)
  }

  await checkVscodeStylelint(reporter)

  return reporter.getExitCode()
}

/** @see ./docs/tooling.md */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { createViolationReporter } from '../../../scripts/lib/lint-surface/violation-reporter.mjs'

// Зовнішні файли конфігу stylelint, які підхоплює cosmiconfig. Канон нових
// JS-конфігів — `.mjs`/`.cjs` (js.mdc), legacy `.js` лишається валідним.
const STYLELINT_CONFIG_FILES = [
  '.stylelintrc.json',
  '.stylelintrc.js',
  '.stylelintrc.cjs',
  '.stylelintrc.mjs',
  'stylelint.config.js',
  'stylelint.config.cjs',
  'stylelint.config.mjs'
]

/**
 * Альтернатива полю `stylelint` у `package.json` — зовнішній файл конфігу. Якщо
 * поля немає і файлу немає, фейлимося; якщо є хоч щось — пропускаємо. Поле
 * `stylelint.extends == "@nitra/stylelint-config"` сам формат — у Rego.
 * @param {ReturnType<typeof createViolationReporter>} reporter репортер
 * @param {string} cwd корінь репозиторію
 */
async function checkStylelintConfigPresence(reporter, cwd) {
  const { pass, fail } = reporter
  const pkgPath = join(cwd, 'package.json')
  if (!existsSync(pkgPath)) return
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8'))
  const hasField = pkg.stylelint && typeof pkg.stylelint === 'object'
  const hasExternalCfg = STYLELINT_CONFIG_FILES.some(name => existsSync(join(cwd, name)))
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
 * Перевіряє відповідність проєкту правилам style.mdc
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст lint-прогону (cwd тощо)
 * @returns {Promise<import('../../../scripts/lib/lint-surface/types.mjs').LintResult>} результат зі зібраними violations
 */
export async function lint(ctx) {
  const cwd = ctx.cwd
  const reporter = createViolationReporter(ctx)
  const { pass, fail } = reporter

  await checkStylelintConfigPresence(reporter, cwd)

  const ignorePath = join(cwd, '.stylelintignore')
  if (existsSync(ignorePath)) {
    const ignoreContent = await readFile(ignorePath, 'utf8')
    if (ignoreContent.split('\n').some(line => line.trim() === 'dist/')) {
      pass('.stylelintignore існує і містить dist/')
    } else {
      fail('.stylelintignore не містить рядка dist/ — додай його (style.mdc)')
    }
  } else {
    fail('.stylelintignore не існує — створи з вмістом: dist/')
  }

  const wfPath = '.github/workflows/lint-style.yml'
  if (existsSync(join(cwd, wfPath))) {
    pass(`${wfPath} є (структуру перевіряє npx @nitra/cursor fix → style_lint.lint_style_yml)`)
  } else {
    fail(`${wfPath} не існує — створи його`)
  }

  return reporter.result()
}

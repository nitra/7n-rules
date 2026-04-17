/**
 * Перевіряє CSS/SCSS лінт за правилом style-lint.mdc.
 *
 * Очікування: `@nitra/stylelint-config`, `lint-style` через `npx stylelint`, `.stylelintignore`,
 * workflow `lint-style.yml` (у `run` — лише `npx stylelint`, не `bun run lint-style`), VSCode stylelint,
 * `css.validate` / `scss.validate` / `less.validate`: false.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

import { createCheckReporter } from './utils/check-reporter.mjs'
import { anyRunStepIncludesStylelint, parseWorkflowYaml } from './utils/gha-workflow.mjs'

/**
 * @param {{ pass: (msg: string) => void, fail: (msg: string) => void }} reporter репортер для збору результатів
 */
async function checkPackageJson(reporter) {
  const { pass, fail } = reporter
  if (!existsSync('package.json')) return
  const pkg = JSON.parse(await readFile('package.json', 'utf8'))

  const lintStyle = pkg.scripts?.['lint-style']
  if (lintStyle) {
    pass('package.json містить скрипт lint-style')
    if (String(lintStyle).includes('npx stylelint')) {
      pass('lint-style викликає stylelint через npx')
    } else {
      fail("lint-style має викликати stylelint через npx — наприклад: npx stylelint '**/*.{css,scss,vue}' --fix")
    }
  } else {
    fail('package.json не містить скрипт "lint-style"')
  }

  if (pkg.devDependencies?.['@nitra/stylelint-config']) {
    pass('@nitra/stylelint-config є в devDependencies')
  } else {
    fail('@nitra/stylelint-config відсутній — bun add -d @nitra/stylelint-config')
  }

  const stylelintCfg = pkg.stylelint
  const hasExternalCfg =
    existsSync('.stylelintrc.json') || existsSync('.stylelintrc.js') || existsSync('stylelint.config.js')
  if (stylelintCfg?.extends === '@nitra/stylelint-config') {
    pass('package.json stylelint extends @nitra/stylelint-config')
  } else if (hasExternalCfg) {
    pass('Окремий файл конфігу stylelint існує')
  } else {
    fail('Немає конфігу stylelint — додай "stylelint": { "extends": "@nitra/stylelint-config" } до package.json')
  }
}

/**
 * @param {import('./utils/check-reporter.mjs').CheckReporter} reporter репортер для збору результатів
 */
async function checkStylelintWorkflow(reporter) {
  const { pass, fail } = reporter
  if (!existsSync('.github/workflows/lint-style.yml')) {
    fail('.github/workflows/lint-style.yml не існує — створи його')
    return
  }
  const content = await readFile('.github/workflows/lint-style.yml', 'utf8')
  pass('lint-style.yml існує')
  const root = parseWorkflowYaml(content)
  const ok = root ? anyRunStepIncludesStylelint(root) : content.includes('npx stylelint')
  if (ok) {
    pass('lint-style.yml містить npx stylelint у кроці run')
  } else {
    fail("lint-style.yml має викликати stylelint у CI через npx — наприклад: npx stylelint '**/*.{css,scss,vue}' --fix")
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

  await checkPackageJson(reporter)

  if (existsSync('.stylelintignore')) {
    pass('.stylelintignore існує')
  } else {
    fail('.stylelintignore не існує — створи з вмістом: dist/')
  }

  await checkStylelintWorkflow(reporter)
  await checkVscodeStylelint(reporter)

  return reporter.getExitCode()
}

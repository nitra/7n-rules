/**
 * Перевіряє CSS/SCSS лінт за правилом style-lint.mdc.
 *
 * `@nitra/stylelint-config`, скрипт `lint-style`, `.stylelintignore`, workflow `lint-style.yml`,
 * VSCode stylelint і вимкнена вбудована CSS-валідація.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

import { pass } from './utils/pass.mjs'

/**
 * Перевіряє відповідність проєкту правилам style-lint.mdc
 * @returns {Promise<number>} 0 — все OK, 1 — є проблеми
 */
export async function check() {
  let exitCode = 0
  const fail = msg => {
    console.log(`  ❌ ${msg}`)
    exitCode = 1
  }

  if (existsSync('package.json')) {
    const pkg = JSON.parse(await readFile('package.json', 'utf8'))

    if (pkg.scripts?.['lint-style']) {
      pass('package.json містить скрипт lint-style')
    } else {
      fail('package.json не містить скрипт "lint-style"')
    }

    if (pkg.devDependencies?.['@nitra/stylelint-config']) {
      pass('@nitra/stylelint-config є в devDependencies')
    } else {
      fail('@nitra/stylelint-config відсутній — bun add -d @nitra/stylelint-config')
    }

    const stylelintCfg = pkg.stylelint
    if (stylelintCfg?.extends === '@nitra/stylelint-config') {
      pass('package.json stylelint extends @nitra/stylelint-config')
    } else if (existsSync('.stylelintrc.json') || existsSync('.stylelintrc.js') || existsSync('stylelint.config.js')) {
      pass('Окремий файл конфігу stylelint існує')
    } else {
      fail('Немає конфігу stylelint — додай "stylelint": { "extends": "@nitra/stylelint-config" } до package.json')
    }
  }

  if (existsSync('.stylelintignore')) {
    pass('.stylelintignore існує')
  } else {
    fail('.stylelintignore не існує — створи з вмістом: dist/')
  }

  if (existsSync('.github/workflows/lint-style.yml')) {
    const content = await readFile('.github/workflows/lint-style.yml', 'utf8')
    pass('lint-style.yml існує')
    if (content.includes('stylelint')) {
      pass('lint-style.yml містить stylelint')
    } else {
      fail('lint-style.yml не містить виклик stylelint')
    }
  } else {
    fail('.github/workflows/lint-style.yml не існує — створи його')
  }

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

  if (existsSync('.vscode/settings.json')) {
    const s = JSON.parse(await readFile('.vscode/settings.json', 'utf8'))
    if (s['css.validate'] === false) {
      pass('css.validate вимкнено')
    } else {
      fail('settings.json: css.validate має бути false')
    }
    if (s['scss.validate'] === false) {
      pass('scss.validate вимкнено')
    } else {
      fail('settings.json: scss.validate має бути false')
    }
  }

  return exitCode
}

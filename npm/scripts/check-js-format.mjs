/**
 * Перевіряє форматування коду за правилом js-format.mdc.
 *
 * `.oxfmtrc.json` з потрібними ключами, VSCode і oxfmt, відсутність Prettier у конфігах і залежностях.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

import { pass } from './utils/pass.mjs'

/**
 * Перевіряє відповідність проєкту правилам js-format.mdc
 * @returns {Promise<number>} 0 — все OK, 1 — є проблеми
 */
export async function check() {
  let exitCode = 0
  const fail = msg => {
    console.log(`  ❌ ${msg}`)
    exitCode = 1
  }

  const expectedKeys = [
    'arrowParens',
    'printWidth',
    'bracketSpacing',
    'bracketSameLine',
    'semi',
    'singleQuote',
    'tabWidth',
    'trailingComma',
    'useTabs'
  ]

  if (existsSync('.oxfmtrc.json')) {
    const cfg = JSON.parse(await readFile('.oxfmtrc.json', 'utf8'))
    const missing = expectedKeys.filter(k => !(k in cfg))
    if (missing.length === 0) {
      pass('.oxfmtrc.json містить всі обовʼязкові ключі')
    } else {
      fail(`.oxfmtrc.json відсутні ключі: ${missing.join(', ')}`)
    }

    if (cfg.semi !== false) fail('.oxfmtrc.json: semi має бути false')
    if (cfg.singleQuote !== true) fail('.oxfmtrc.json: singleQuote має бути true')
    if (cfg.tabWidth !== 2) fail('.oxfmtrc.json: tabWidth має бути 2')
    if (cfg.useTabs !== false) fail('.oxfmtrc.json: useTabs має бути false')
    if (cfg.printWidth !== 120) fail('.oxfmtrc.json: printWidth має бути 120')
  } else {
    fail('.oxfmtrc.json не існує — створи його')
  }

  if (existsSync('.vscode/extensions.json')) {
    const ext = JSON.parse(await readFile('.vscode/extensions.json', 'utf8'))
    if (ext.recommendations?.includes('oxc.oxc-vscode')) {
      pass('extensions.json містить oxc.oxc-vscode')
    } else {
      fail('extensions.json не містить oxc.oxc-vscode')
    }
  } else {
    fail('.vscode/extensions.json не існує')
  }

  if (existsSync('.vscode/settings.json')) {
    const settings = JSON.parse(await readFile('.vscode/settings.json', 'utf8'))
    if (settings['editor.formatOnSave'] === true) {
      pass('settings.json: editor.formatOnSave увімкнено')
    } else {
      fail('settings.json: editor.formatOnSave має бути true')
    }

    const fmtTypes = ['javascript', 'typescript', 'json', 'vue', 'css', 'html']
    for (const t of fmtTypes) {
      const key = `[${t}]`
      if (settings[key]?.['editor.defaultFormatter'] === 'oxc.oxc-vscode') {
        pass(`settings.json: ${key} використовує oxc.oxc-vscode`)
      } else {
        fail(`settings.json: ${key} має використовувати oxc.oxc-vscode як defaultFormatter`)
      }
    }
  } else {
    fail('.vscode/settings.json не існує')
  }

  const prettierFiles = ['.prettierrc', '.prettierrc.json', '.prettierrc.js', 'prettier.config.js', '.prettierrc.yml']
  for (const f of prettierFiles) {
    if (existsSync(f)) fail(`Знайдено конфіг prettier: ${f} — видали його`)
  }

  if (existsSync('package.json')) {
    const pkg = JSON.parse(await readFile('package.json', 'utf8'))
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies }
    for (const dep of ['prettier', '@nitra/prettier-config']) {
      if (allDeps[dep]) fail(`package.json містить залежність ${dep} — видали її`)
    }
    if (pkg.prettier) fail('package.json містить поле "prettier" — видали його')
  }

  return exitCode
}

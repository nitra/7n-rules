/**
 * Перевіряє текстовий стек за правилом text.mdc.
 *
 * cspell, markdownlint-cli2, скрипт `lint-text` з v8r (`run-v8r.mjs` або чотири `bunx v8r`),
 * `.v8rignore` (vscode JSON),
 * workflow `lint-text.yml`, розширення VSCode для markdownlint.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

import { pass } from './utils/pass.mjs'

/**
 * Перевіряє відповідність проєкту правилам text.mdc (cspell, markdownlint-cli2, v8r)
 * @returns {Promise<number>} 0 — все OK, 1 — є проблеми
 */
export async function check() {
  let exitCode = 0
  const fail = msg => {
    console.log(`  ❌ ${msg}`)
    exitCode = 1
  }

  const v8rIgnoreRequired = ['.vscode/extensions.json', '.vscode/settings.json']
  if (existsSync('.v8rignore')) {
    const raw = await readFile('.v8rignore', 'utf8')
    const lines = new Set(
      raw
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0 && !l.startsWith('#'))
    )
    for (const path of v8rIgnoreRequired) {
      if (lines.has(path)) {
        pass(`.v8rignore містить ${path}`)
      } else {
        fail(`.v8rignore: додай рядок "${path}" (JSON без схеми в Schema Store — див. n-text.mdc)`)
      }
    }
  } else {
    fail('.v8rignore не існує — створи згідно n-text.mdc (мінімум .vscode/extensions.json і .vscode/settings.json)')
  }

  if (existsSync('.vscode/extensions.json')) {
    try {
      const ext = JSON.parse(await readFile('.vscode/extensions.json', 'utf8'))
      const rec = ext.recommendations
      if (Array.isArray(rec) && rec.includes('DavidAnson.vscode-markdownlint')) {
        pass('extensions.json містить DavidAnson.vscode-markdownlint')
      } else {
        fail('extensions.json: додай "DavidAnson.vscode-markdownlint" у recommendations (див. n-text.mdc)')
      }
    } catch {
      fail('.vscode/extensions.json — невалідний JSON')
    }
  } else {
    fail('.vscode/extensions.json не існує — створи з recommendations згідно n-text.mdc')
  }

  if (existsSync('.markdownlint-cli2.jsonc')) {
    try {
      const ml = JSON.parse(await readFile('.markdownlint-cli2.jsonc', 'utf8'))
      pass('.markdownlint-cli2.jsonc існує і є валідним JSON')
      if (ml.gitignore === true) {
        pass('.markdownlint-cli2.jsonc: gitignore увімкнено')
      } else {
        fail('.markdownlint-cli2.jsonc: додай на верхньому рівні "gitignore": true (див. n-text.mdc)')
      }
    } catch {
      fail('.markdownlint-cli2.jsonc — невалідний JSON; перевір синтаксис')
    }
  } else {
    fail('.markdownlint-cli2.jsonc не існує — створи згідно n-text.mdc')
  }

  if (existsSync('.cspell.json')) {
    const cfg = JSON.parse(await readFile('.cspell.json', 'utf8'))

    if (cfg.version === '0.2') {
      pass('.cspell.json version: 0.2')
    } else {
      fail('.cspell.json version має бути "0.2"')
    }

    if (cfg.language) {
      pass(`.cspell.json language: "${cfg.language}"`)
    } else {
      fail('.cspell.json не містить поле language')
    }

    const imports = cfg.import || []
    if (imports.some(i => i.includes('@nitra/cspell-dict'))) {
      pass('.cspell.json імпортує @nitra/cspell-dict')
    } else {
      fail('.cspell.json не імпортує @nitra/cspell-dict/cspell-ext.json')
    }

    if (Array.isArray(cfg.ignorePaths)) {
      pass('.cspell.json містить ignorePaths')
    } else {
      fail('.cspell.json не містить ignorePaths')
    }
  } else {
    fail('.cspell.json не існує — створи його')
  }

  if (existsSync('package.json')) {
    const pkg = JSON.parse(await readFile('package.json', 'utf8'))
    const devDeps = pkg.devDependencies || {}

    if (devDeps['@nitra/cspell-dict']) {
      pass('@nitra/cspell-dict є в devDependencies')
    } else {
      fail('@nitra/cspell-dict відсутній — bun add -d @nitra/cspell-dict')
    }

    if (devDeps['markdownlint-cli2']) {
      pass('markdownlint-cli2 є в devDependencies')
    } else {
      fail('markdownlint-cli2 відсутній — bun add -d markdownlint-cli2 (n-text.mdc)')
    }

    const lintText = pkg.scripts?.['lint-text']
    const v8rCalls = typeof lintText === 'string' ? (lintText.match(/bunx v8r/g) || []).length : 0
    const quietCalls = typeof lintText === 'string' ? (lintText.match(/run-v8r?\.mjs/g) || []).length : 0
    const eq98Hints = typeof lintText === 'string' ? (lintText.match(/eq 98/g) || []).length : 0
    const globsOk =
      typeof lintText === 'string' &&
      lintText.includes('**/*.json') &&
      lintText.includes('**/*.yml') &&
      lintText.includes('**/*.yaml') &&
      lintText.includes('**/*.toml')
    const legacyV8r = v8rCalls >= 4 && eq98Hints >= 4
    const quietBundled = quietCalls === 1
    const quietLegacy4x = quietCalls >= 4
    const v8rTextOk = legacyV8r || quietBundled || quietLegacy4x
    const globsRequired = legacyV8r || quietLegacy4x
    if (
      typeof lintText === 'string' &&
      lintText.includes('cspell') &&
      lintText.includes('bunx markdownlint-cli2') &&
      lintText.includes('**/*.mdc') &&
      v8rTextOk &&
      (!globsRequired || globsOk)
    ) {
      pass('package.json: lint-text — v8r: run-v8r.mjs (один виклик або чотири) або чотири bunx v8r з || [ $? -eq 98 ]')
    } else {
      fail(
        'package.json: lint-text — v8r: bun ./…/run-v8r.mjs або чотири (bunx v8r "<glob>" || [ $? -eq 98 ]) для json/yml/yaml/toml (див. n-text.mdc)'
      )
    }

    if (existsSync('.github/workflows/lint-text.yml')) {
      const wf = await readFile('.github/workflows/lint-text.yml', 'utf8')
      if (wf.includes('bun run lint-text')) {
        pass('lint-text.yml викликає bun run lint-text')
      } else {
        fail('lint-text.yml має містити крок bun run lint-text')
      }
    } else {
      fail('.github/workflows/lint-text.yml не існує — створи згідно n-text.mdc')
    }

    if (existsSync('.cspell.json')) {
      const cfg = JSON.parse(await readFile('.cspell.json', 'utf8'))
      const hasUkImport = (cfg.import || []).some(i => i.includes('@cspell/dict-uk-ua'))
      if (hasUkImport && !devDeps['@cspell/dict-uk-ua']) {
        fail('.cspell.json імпортує @cspell/dict-uk-ua, але пакет відсутній в devDependencies')
      }
    }
  }

  return exitCode
}

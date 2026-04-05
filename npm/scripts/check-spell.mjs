import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

import { pass } from './utils/pass.mjs'

/**
 * Перевіряє відповідність проєкту правилам spell.mdc
 * @returns {Promise<number>} 0 — все OK, 1 — є проблеми
 */
export async function check() {
  let exitCode = 0
  const fail = msg => {
    console.log(`  ❌ ${msg}`)
    exitCode = 1
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

    const lintSpell = pkg.scripts?.['lint-spell']
    if (typeof lintSpell === 'string' && lintSpell.includes('cspell')) {
      pass('package.json містить скрипт lint-spell з cspell')
    } else {
      fail('package.json не містить скрипт "lint-spell": "npx cspell ." (див. n-spell.mdc)')
    }

    if (existsSync('.github/workflows/lint-spell.yml')) {
      const wf = await readFile('.github/workflows/lint-spell.yml', 'utf8')
      if (wf.includes('lint-spell')) {
        pass('lint-spell.yml існує і викликає lint-spell')
      } else {
        fail('lint-spell.yml має містити виклик bun run lint-spell')
      }
    } else {
      fail('.github/workflows/lint-spell.yml не існує — створи згідно n-spell.mdc')
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

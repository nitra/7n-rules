/**
 * Перевіряє лінт JavaScript за правилом js-lint.mdc.
 *
 * Flat ESLint, скрипт `lint-js` (oxlint, eslint, jscpd), `engines.node`, без prettier,
 * наявність `.jscpd.json` і workflow `lint-js.yml`.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

import { pass } from './utils/pass.mjs'

/**
 * Перевіряє відповідність проєкту правилам js-lint.mdc
 * @returns {Promise<number>} 0 — все OK, 1 — є проблеми
 */
export async function check() {
  let exitCode = 0
  const fail = msg => {
    console.log(`  ❌ ${msg}`)
    exitCode = 1
  }

  if (existsSync('eslint.config.js')) {
    pass('eslint.config.js існує')
  } else if (existsSync('eslint.config.mjs')) {
    pass('eslint.config.mjs існує')
  } else {
    fail('Відсутній eslint.config.js — створи його з getConfig від @nitra/eslint-config')
  }

  if (existsSync('package.json')) {
    const pkg = JSON.parse(await readFile('package.json', 'utf8'))

    if (pkg.scripts?.['lint-js']) {
      pass('package.json містить скрипт lint-js')
      const lintJs = String(pkg.scripts['lint-js'])
      if (lintJs.includes('jscpd')) {
        pass('lint-js містить jscpd')
      } else {
        fail('lint-js має викликати jscpd — додай "&& bunx jscpd ." у кінець скрипта')
      }
      if (lintJs.includes('bunx eslint')) {
        pass('lint-js викликає bunx eslint')
      } else {
        fail('lint-js має містити bunx eslint (n-js-lint.mdc)')
      }
      if (lintJs.includes('bunx jscpd')) {
        pass('lint-js викликає bunx jscpd')
      } else {
        fail('lint-js має містити bunx jscpd (n-js-lint.mdc)')
      }
      if (lintJs.includes('oxlint')) {
        pass('lint-js містить oxlint')
      } else {
        fail('lint-js має містити oxlint (n-js-lint.mdc)')
      }
    } else {
      fail('package.json не містить скрипт "lint-js" — додай: "oxlint --fix && bunx eslint --fix . && bunx jscpd ."')
    }

    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies }
    if (allDeps.prettier) {
      fail('package.json: видали залежність prettier (oxfmt замість prettier, n-js-lint.mdc)')
    } else {
      pass('package.json не містить prettier')
    }
    if (allDeps['@nitra/prettier-config']) {
      fail('package.json: видали @nitra/prettier-config (n-js-lint.mdc)')
    } else {
      pass('package.json не містить @nitra/prettier-config')
    }

    if (pkg.devDependencies?.['@nitra/eslint-config']) {
      pass('@nitra/eslint-config є в devDependencies')
    } else {
      fail('@nitra/eslint-config відсутній в devDependencies — додай: bun add -d @nitra/eslint-config')
    }

    const nodeEngine = pkg.engines?.node
    if (nodeEngine) {
      const match = nodeEngine.match(/(\d+)/)
      if (match && Number(match[1]) >= 24) {
        pass(`engines.node: "${nodeEngine}"`)
      } else {
        fail(`engines.node: "${nodeEngine}" — має бути >=24`)
      }
    } else {
      fail('package.json не містить engines.node — додай: "engines": { "node": ">=24" }')
    }
  }

  if (existsSync('.github/workflows/lint-js.yml')) {
    const content = await readFile('.github/workflows/lint-js.yml', 'utf8')
    pass('lint-js.yml існує')
    if (content.includes('oxlint')) {
      pass('lint-js.yml містить oxlint')
    } else {
      fail('lint-js.yml не містить oxlint')
    }
    if (content.includes('eslint')) {
      pass('lint-js.yml містить eslint')
    } else {
      fail('lint-js.yml не містить eslint')
    }
    if (content.includes('jscpd')) {
      pass('lint-js.yml містить jscpd')
    } else {
      fail('lint-js.yml не містить jscpd — додай крок bunx jscpd .')
    }
  } else {
    fail('.github/workflows/lint-js.yml не існує — створи його')
  }

  if (existsSync('.jscpd.json')) {
    let jscpdCfg
    try {
      jscpdCfg = JSON.parse(await readFile('.jscpd.json', 'utf8'))
    } catch {
      fail('.jscpd.json не є валідним JSON')
      jscpdCfg = null
    }
    if (jscpdCfg) {
      pass('.jscpd.json існує')
      if (jscpdCfg.gitignore === true) {
        pass('.jscpd.json: gitignore увімкнено')
      } else {
        fail('.jscpd.json має містити "gitignore": true')
      }
      if (jscpdCfg.exitCode === 1) {
        pass('.jscpd.json: exitCode 1 при дублікатах')
      } else {
        fail('.jscpd.json має містити "exitCode": 1 (інакше CI не впаде на клонах)')
      }
    }
  } else {
    fail('.jscpd.json не існує — створи з gitignore, exitCode та reporters згідно js-lint.mdc')
  }

  for (const dup of ['.eslintrc', '.eslintrc.js', '.eslintrc.json', '.eslintrc.yml']) {
    if (existsSync(dup)) fail(`Знайдено застарілий конфіг ESLint: ${dup} — видали, використовуй eslint.config.js`)
  }

  return exitCode
}

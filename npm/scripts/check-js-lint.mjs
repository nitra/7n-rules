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
    } else {
      fail('package.json не містить скрипт "lint-js" — додай: "oxlint --fix && bunx eslint --fix ."')
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
  } else {
    fail('.github/workflows/lint-js.yml не існує — створи його')
  }

  for (const dup of ['.eslintrc', '.eslintrc.js', '.eslintrc.json', '.eslintrc.yml']) {
    if (existsSync(dup)) fail(`Знайдено застарілий конфіг ESLint: ${dup} — видали, використовуй eslint.config.js`)
  }

  return exitCode
}

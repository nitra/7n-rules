import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

/**
 * Перевіряє відповідність проєкту правилам spell.mdc
 * @returns {Promise<number>} 0 — все OK, 1 — є проблеми
 */
export async function check() {
  let exitCode = 0
  const pass = msg => console.log(`  ✅ ${msg}`)
  const fail = msg => {
    console.log(`  ❌ ${msg}`)
    exitCode = 1
  }

  if (existsSync('.cspell.json')) {
    const cfg = JSON.parse(await readFile('.cspell.json', 'utf8'))

    cfg.version === '0.2'
      ? pass('.cspell.json version: 0.2')
      : fail('.cspell.json version має бути "0.2"')

    cfg.language
      ? pass(`.cspell.json language: "${cfg.language}"`)
      : fail('.cspell.json не містить поле language')

    const imports = cfg.import || []
    imports.some(i => i.includes('@nitra/cspell-dict'))
      ? pass('.cspell.json імпортує @nitra/cspell-dict')
      : fail('.cspell.json не імпортує @nitra/cspell-dict/cspell-ext.json')

    Array.isArray(cfg.ignorePaths)
      ? pass('.cspell.json містить ignorePaths')
      : fail('.cspell.json не містить ignorePaths')
  } else {
    fail('.cspell.json не існує — створи його')
  }

  if (existsSync('package.json')) {
    const pkg = JSON.parse(await readFile('package.json', 'utf8'))
    const devDeps = pkg.devDependencies || {}

    devDeps['@nitra/cspell-dict']
      ? pass('@nitra/cspell-dict є в devDependencies')
      : fail('@nitra/cspell-dict відсутній — bun add -d @nitra/cspell-dict')

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

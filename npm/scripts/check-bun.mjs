import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

import { pass } from './utils/pass.mjs'

/**
 * Перевіряє відповідність проєкту правилам bun.mdc
 * @returns {Promise<number>} 0 — все OK, 1 — є проблеми
 */
export async function check() {
  let exitCode = 0
  const fail = msg => {
    console.log(`  ❌ ${msg}`)
    exitCode = 1
  }

  const forbidden = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', '.yarnrc.yml']
  for (const f of forbidden) {
    if (existsSync(f)) {
      fail(`Знайдено заборонений файл: ${f} — видали його`)
    } else {
      pass(`Немає ${f}`)
    }
  }

  if (existsSync('.yarn')) {
    fail('Знайдено директорію .yarn — видали її')
  } else {
    pass('Немає .yarn/')
  }
  if (existsSync('bun.lock')) {
    pass('bun.lock є')
  } else {
    fail('Відсутній bun.lock — запусти bun i')
  }

  if (existsSync('package.json')) {
    const pkg = JSON.parse(await readFile('package.json', 'utf8'))
    if (pkg.packageManager) {
      fail(`package.json містить поле packageManager: "${pkg.packageManager}" — видали його`)
    } else {
      pass('package.json не містить packageManager')
    }
  }

  return exitCode
}

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

/**
 * Перевіряє відповідність проєкту правилам bun.mdc
 * @returns {Promise<number>} 0 — все OK, 1 — є проблеми
 */
export async function check() {
  let exitCode = 0
  const pass = msg => console.log(`  ✅ ${msg}`)
  const fail = msg => {
    console.log(`  ❌ ${msg}`)
    exitCode = 1
  }

  const forbidden = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', '.yarnrc.yml']
  for (const f of forbidden) {
    existsSync(f) ? fail(`Знайдено заборонений файл: ${f} — видали його`) : pass(`Немає ${f}`)
  }

  existsSync('.yarn') ? fail('Знайдено директорію .yarn — видали її') : pass('Немає .yarn/')
  existsSync('bun.lock') ? pass('bun.lock є') : fail('Відсутній bun.lock — запусти bun i')

  if (existsSync('package.json')) {
    const pkg = JSON.parse(await readFile('package.json', 'utf8'))
    pkg.packageManager
      ? fail(`package.json містить поле packageManager: "${pkg.packageManager}" — видали його`)
      : pass('package.json не містить packageManager')
  }

  return exitCode
}

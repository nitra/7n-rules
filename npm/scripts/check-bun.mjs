/**
 * Перевіряє відповідність репозиторію правилам Bun (n-bun.mdc).
 *
 * Очікує наявність `bun.lock`, забороняє lockfile та артефакти yarn/pnpm, директорію `.yarn`
 * і поле `packageManager` у кореневому `package.json`.
 *
 * Якщо в кореневому `package.json` є скрипти з префіксом `lint-`, перевіряє наявність агрегованого
 * скрипта `lint`, у якому через `bun run <ім’я>` викликаються всі такі скрипти, і що рядок `lint`
 * закінчується на `&& oxfmt .`.
 */
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

    const scripts = pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {}
    const lintPrefixed = Object.keys(scripts).filter(name => name.startsWith('lint-'))
    if (lintPrefixed.length > 0) {
      const aggregate = typeof scripts.lint === 'string' ? scripts.lint : ''
      if (aggregate.trim()) {
        const missing = lintPrefixed.filter(name => !aggregate.includes(`bun run ${name}`))
        if (missing.length > 0) {
          fail(
            `Скрипт \`lint\` має викликати всі lint-* через bun run; відсутньо: ${missing.map(s => `\`${s}\``).join(', ')}`
          )
        } else {
          pass('package.json: агрегований `lint` покриває всі `lint-*` скрипти')
          if (/\s*&&\s+oxfmt\s+\.\s*$/.test(aggregate.trim())) {
            pass('package.json: `lint` завершується `&& oxfmt .`')
          } else {
            fail('Скрипт `lint` має закінчуватися на `&& oxfmt .`')
          }
        }
      } else {
        fail(
          `У package.json є скрипти ${lintPrefixed.map(s => `\`${s}\``).join(', ')}, але немає агрегованого \`lint\` — додай скрипт, який запускає їх через \`bun run\``
        )
      }
    }
  }

  return exitCode
}

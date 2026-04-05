import { existsSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'

/**
 * Перевіряє відповідність проєкту правилам npm-module.mdc
 * @returns {Promise<number>} 0 — все OK, 1 — є проблеми
 */
export async function check() {
  let exitCode = 0
  const pass = msg => console.log(`  ✅ ${msg}`)
  const fail = msg => {
    console.log(`  ❌ ${msg}`)
    exitCode = 1
  }

  existsSync('package.json') ? pass('package.json існує') : fail('package.json не існує')

  if (existsSync('npm')) {
    const s = await stat('npm')
    s.isDirectory() ? pass('npm/ директорія існує') : fail('npm має бути директорією')
  } else {
    fail('npm/ директорія не існує')
  }

  if (existsSync('package.json')) {
    const pkg = JSON.parse(await readFile('package.json', 'utf8'))
    const ws = pkg.workspaces
    if (Array.isArray(ws) && ws.includes('npm')) {
      pass('package.json workspaces містить "npm"')
    } else {
      fail('package.json workspaces має містити "npm"')
    }
  }

  existsSync('npm/package.json')
    ? pass('npm/package.json існує')
    : fail('npm/package.json не існує — створи package.json для npm модуля')

  existsSync('.github/workflows')
    ? pass('.github/workflows/ існує')
    : fail('.github/workflows/ не існує')

  return exitCode
}

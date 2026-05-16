/**
 * Перевірка abie: у **підкаталогах першого рівня** (без `.git`/`node_modules`) не має бути
 * `.firebaserc`, `firebase.json`, `.firebase/` (abie.mdc — Firebase Hosting заборонено).
 * У самому корені репозиторію ці імена не перевіряються (можуть бути від суміжних проєктів).
 */
import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

import { createCheckReporter } from '../../../../scripts/utils/check-reporter.mjs'

const SKIP_TOP_DIR_NAMES = new Set(['.git', 'node_modules'])

/**
 * @returns {Promise<number>} результат
 */
export async function check() {
  const reporter = createCheckReporter()
  const { pass, fail } = reporter
  const root = process.cwd()

  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    fail(`Не вдалося прочитати ${root} для перевірки Firebase Hosting: ${msg} (abie.mdc)`)
    return reporter.getExitCode()
  }
  const topDirs = entries.filter(e => e.isDirectory() && !SKIP_TOP_DIR_NAMES.has(e.name))
  let hasViolation = false
  for (const e of topDirs) {
    for (const name of ['.firebaserc', 'firebase.json']) {
      const rel = join(e.name, name).replaceAll('\\', '/')
      if (existsSync(join(root, e.name, name))) {
        fail(`Знайдено заборонений файл Firebase Hosting: ${rel} — видали його (abie.mdc)`)
        hasViolation = true
      }
    }
    if (existsSync(join(root, e.name, '.firebase'))) {
      fail(`Знайдено заборонену директорію: ${e.name}/.firebase/ — видали її (abie.mdc)`)
      hasViolation = true
    }
  }
  if (!hasViolation) {
    pass('Підкаталоги кореня (1-й рівень, без .git/node_modules): артефактів Firebase Hosting не знайдено (abie.mdc)')
  }
  return reporter.getExitCode()
}

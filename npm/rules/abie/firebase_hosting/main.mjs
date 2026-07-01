/** @see ./docs/firebase_hosting.md */
import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

import { createViolationReporter } from '../../../scripts/lib/lint-surface/violation-reporter.mjs'

const SKIP_TOP_DIR_NAMES = new Set(['.git', 'node_modules'])

/**
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінту.
 * @returns {Promise<import('../../../scripts/lib/lint-surface/types.mjs').LintResult>} результат із порушеннями.
 */
export async function lint(ctx) {
  const reporter = createViolationReporter(ctx)
  const { pass, fail } = reporter
  const root = ctx.cwd

  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    fail(`Не вдалося прочитати ${root} для перевірки Firebase Hosting: ${msg} (abie.mdc)`)
    return reporter.result()
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
  return reporter.result()
}

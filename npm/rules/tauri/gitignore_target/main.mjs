/**
 * @see ./docs/main.md
 *
 * Read-only detector: для кожного знайденого `<ws>/src-tauri/` у монорепо
 * корінний `.gitignore` повинен містити точний ignore-запис
 * `<ws>/src-tauri/target/` (tauri.mdc).
 *
 * Реальний інцидент: у `nitra/task` `.gitignore` мав `owner/target/` замість
 * `owner/src-tauri/target/` (typo — воркспейс скопійований без заміни шляху),
 * тому build-артефакти (~600MB, ~28k файлів) не ігнорувались і мало не
 * потрапили в коміт через `git add -A`. Тому перевірка — точний match рядка
 * повного шляху, не пошук голого `target/` десь у файлі: голий `target/`
 * (чи `owner/target/`) дав би false negative саме на цьому кейсі.
 *
 * Обхід `<ws>/src-tauri/` — спільний з `tauri/cargo_mutants_config`
 * (`findSrcTauriDirs`), без дублювання.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

import { createViolationReporter } from '../../../scripts/lib/lint-surface/violation-reporter.mjs'
import { findSrcTauriDirs } from '../cargo_mutants_config/main.mjs'

/** Стабільний reason: у корінному `.gitignore` бракує ignore-запису(ів) для `src-tauri/target/`. */
export const MISSING_GITIGNORE_TARGET_ENTRIES = 'missing-gitignore-target-entries'

/** Корінний `.gitignore` — один на монорепо, не по workspace. */
export const ROOT_GITIGNORE = '.gitignore'

/**
 * Очікуваний ignore-запис для build-артефактів одного `<ws>/src-tauri/`.
 * @param {string} cwd корінь монорепо
 * @param {string} srcTauriDir абсолютний шлях до `src-tauri/`
 * @returns {string} очікуваний рядок у корінному `.gitignore` (`<ws>/src-tauri/target/`)
 */
export function expectedTargetEntry(cwd, srcTauriDir) {
  return `${relative(cwd, srcTauriDir)}/target/`
}

/**
 * Знаходить очікувані entries, яких бракує у вмісті кореневого `.gitignore`.
 * Точний match рядка (після trim) — голий `target/` чи typo на кшталт
 * `owner/target/` не рахуються присутністю очікуваного запису.
 * @param {string} content вміст `.gitignore`
 * @param {string[]} expectedEntries очікувані ignore-рядки
 * @returns {string[]} відсутні entries (зі збереженням порядку expectedEntries)
 */
export function findMissingEntries(content, expectedEntries) {
  const present = new Set(content.split('\n').map(l => l.trim()))
  return expectedEntries.filter(e => !present.has(e))
}

/**
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінт-прогону
 * @returns {Promise<import('../../../scripts/lib/lint-surface/types.mjs').LintResult>} результат перевірки
 */
export async function lint(ctx) {
  const cwd = ctx.cwd
  const reporter = createViolationReporter(ctx)

  const srcTauriDirs = await findSrcTauriDirs(cwd)
  if (srcTauriDirs.length === 0) return reporter.result()

  const expectedEntries = srcTauriDirs.map(dir => expectedTargetEntry(cwd, dir))
  const abs = join(cwd, ROOT_GITIGNORE)
  const content = existsSync(abs) ? await readFile(abs, 'utf8') : ''

  const missing = findMissingEntries(content, expectedEntries)
  if (missing.length === 0) {
    reporter.pass(`${ROOT_GITIGNORE}: build-артефакти всіх src-tauri/ ігноруються`)
    return reporter.result()
  }

  reporter.fail(
    `${ROOT_GITIGNORE}: бракує ignore-запису(ів) для Tauri build-артефактів [${missing.join(', ')}] — build-артефакти можуть потрапити в коміт (tauri.mdc)`,
    {
      reason: MISSING_GITIGNORE_TARGET_ENTRIES,
      file: ROOT_GITIGNORE,
      data: { kind: MISSING_GITIGNORE_TARGET_ENTRIES, missing }
    }
  )
  return reporter.result()
}

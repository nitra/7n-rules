/**
 * @see ./docs/main.md
 *
 * Read-only detector: для кожного знайденого `<ws>/src-tauri/` у монорепо
 * корінний `.gitignore` повинен містити точний ignore-запис для build-артефактів
 * — але шлях залежить від фактичного Cargo workspace root крейту, не від
 * розташування самого `src-tauri/` (tauri.mdc).
 *
 * Крейт `src-tauri/` компілюється в `<workspace-root>/target/`, а не обов'язково
 * в `<ws>/src-tauri/target/`: коли над `src-tauri/` є предок-workspace (канон
 * `rust/workspace_root` — один кореневий Cargo workspace на репозиторій), Cargo
 * кладе `target/` саме туди. Реальний прецедент: у `nitra/task` коміт `3cb0df3`
 * помилково "виправив" коректний запис `owner/target/` назад на `owner/src-tauri/target/`
 * (бо `owner/Cargo.toml` — workspace root для `owner/src-tauri`), що скасував наступний
 * коміт `ac3451e`. Тому перевірка обчислює очікуваний шлях від реального workspace root,
 * а не від фіксованого суфікса `src-tauri/target/`, і звіряє точний рядок — голий
 * `target/` чи запис не-того рівня не рахуються присутністю потрібного запису.
 *
 * Обхід `<ws>/src-tauri/` — спільний з `tauri/cargo_mutants_config`
 * (`findSrcTauriDirs`), без дублювання.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

import { createViolationReporter } from '../../../scripts/lib/lint-surface/violation-reporter.mjs'
import { findAncestorWorkspaceRoot } from '../../../scripts/utils/cargo-workspace.mjs'
import { findSrcTauriDirs } from '../cargo_mutants_config/main.mjs'

/** Стабільний reason: у корінному `.gitignore` бракує ignore-запису(ів) для `src-tauri/target/`. */
export const MISSING_GITIGNORE_TARGET_ENTRIES = 'missing-gitignore-target-entries'

/** Корінний `.gitignore` — один на монорепо, не по workspace. */
export const ROOT_GITIGNORE = '.gitignore'

/**
 * Очікуваний ignore-запис для build-артефактів одного `<ws>/src-tauri/`: шлях до
 * `target/` фактичного Cargo workspace root цього крейту (найближчий предок з
 * `[workspace]`, чиї `members` покривають `src-tauri/`), а не суфікс `src-tauri/target/`
 * за замовчуванням. Якщо предка-workspace немає — крейт сам собі workspace root
 * (standalone `src-tauri/Cargo.toml`), і `target/` лишається під `src-tauri/`.
 * @param {string} cwd корінь монорепо
 * @param {string} srcTauriDir абсолютний шлях до `src-tauri/`
 * @returns {Promise<string>} очікуваний рядок у корінному `.gitignore`
 */
export async function expectedTargetEntry(cwd, srcTauriDir) {
  const ancestor = await findAncestorWorkspaceRoot(srcTauriDir, cwd)
  if (!ancestor) {
    return `${relative(cwd, srcTauriDir)}/target/`
  }
  const relRoot = relative(cwd, ancestor.rootDir)
  return relRoot === '' ? 'target/' : `${relRoot}/target/`
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

  const expectedEntries = []
  for (const dir of srcTauriDirs) expectedEntries.push(await expectedTargetEntry(cwd, dir))
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

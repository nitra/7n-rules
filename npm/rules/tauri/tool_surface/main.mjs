/** @see ./docs/main.md */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { globby } from 'globby'

import { createViolationReporter } from '../../../scripts/lib/lint-surface/violation-reporter.mjs'
import { collectCapabilityPermissionIds, findTauriAppWorkspaces, groupCargoDepsBySection } from '../updater/main.mjs'

/** JS торкається плагіна, але crate відсутній у `src-tauri/Cargo.toml`. */
export const PLUGIN_DEP_MISSING = 'tool-surface-plugin-dep-missing'
/** JS торкається плагіна, але його rust-ідентифікатор ніде не згадується в `lib.rs`. */
export const PLUGIN_NOT_REGISTERED = 'tool-surface-plugin-not-registered'
/** JS торкається плагіна, але жодна `capabilities/*.json` не дає йому permission. */
export const PLUGIN_CAPABILITY_MISSING = 'tool-surface-plugin-capability-missing'

const JS_PLUGIN_IMPORT_RE = /@tauri-apps\/plugin-([a-z0-9-]+)/gu
const INVOKE_PLUGIN_RE = /invoke\(\s*['"]plugin:([a-z0-9-]+)\|/gu

/**
 * Збирає slugs Tauri-плагінів, яких торкається JS/TS/Vue-код через wrapper-пакет
 * `@tauri-apps/plugin-*` (`import ... from '@tauri-apps/plugin-dialog'`) або прямий
 * `invoke('plugin:<slug>|<command>')`. Це "тули" в термінах n-tool-surface — call
 * surface, яким користується UI/оркестратор/LLM.
 * @param {string} srcDir абсолютний шлях до `<ws>/src`
 * @returns {Promise<Set<string>>} множина slugs (`dialog`, `http`, …)
 */
async function collectPluginUsages(srcDir) {
  const slugs = new Set()
  if (!existsSync(srcDir)) return slugs

  const files = await globby(['**/*.js', '**/*.ts', '**/*.jsx', '**/*.tsx', '**/*.vue'], {
    cwd: srcDir,
    onlyFiles: true,
    gitignore: false
  })
  for (const file of files) {
    const content = await readFile(join(srcDir, file), 'utf8')
    for (const m of content.matchAll(JS_PLUGIN_IMPORT_RE)) slugs.add(m[1])
    for (const m of content.matchAll(INVOKE_PLUGIN_RE)) slugs.add(m[1])
  }
  return slugs
}

/**
 * Перевіряє один workspace: кожен Tauri-плагін, якого JS торкається через
 * wrapper-пакет `@tauri-apps/plugin-*` чи прямий `invoke('plugin:...')`, має бути
 * (1) залежністю в Cargo.toml, (2) згаданий у lib.rs (реєстрація builder-а), (3) мати
 * permission у capabilities/*.json — інакше виклик тихо падає в рантаймі, без
 * компіляційної помилки (tauri.mdc tool_surface).
 * @param {string} ws відносний шлях workspace
 * @param {string} cwd корінь репо
 * @param {ReturnType<typeof createViolationReporter>} reporter репортер концерну
 * @returns {Promise<void>} завершується після перевірки
 */
async function checkWorkspace(ws, cwd, reporter) {
  const base = ws === '.' ? cwd : join(cwd, ws)
  const srcDir = join(base, 'src')
  const usedSlugs = await collectPluginUsages(srcDir)
  if (usedSlugs.size === 0) return

  const srcTauriDir = join(base, 'src-tauri')
  const cargoPath = join(srcTauriDir, 'Cargo.toml')
  const libRsPath = join(srcTauriDir, 'src', 'lib.rs')
  const capDir = join(srcTauriDir, 'capabilities')

  const bySection = existsSync(cargoPath) ? groupCargoDepsBySection(await readFile(cargoPath, 'utf8')) : new Map()
  const libRsContent = existsSync(libRsPath) ? await readFile(libRsPath, 'utf8') : ''
  const capIds = await collectCapabilityPermissionIds(capDir)

  const cargoRel = cargoPath.slice(cwd.length + 1)
  const libRsRel = libRsPath.slice(cwd.length + 1)
  const capRel = capDir.slice(cwd.length + 1)

  const depKeysList = bySection.values().toArray()

  for (const slug of [...usedSlugs].toSorted()) {
    const cargoDep = `tauri-plugin-${slug}`
    const rustIdent = `tauri_plugin_${slug.replaceAll('-', '_')}`

    if (depKeysList.every(keys => !keys.includes(cargoDep))) {
      reporter.fail(
        `${cargoRel}: JS звертається до плагіна "${slug}" (@tauri-apps/plugin-${slug} чи invoke('plugin:${slug}|...')), але "${cargoDep}" відсутній у Cargo.toml (tauri.mdc tool_surface)`,
        { reason: PLUGIN_DEP_MISSING, file: cargoRel, data: { slug } }
      )
    }

    if (!libRsContent.includes(rustIdent)) {
      reporter.fail(
        `${libRsRel}: плагін "${slug}" ніде не згадується — invoke('plugin:${slug}|...') з UI тихо впаде, бо builder.plugin(${rustIdent}::…) не зареєстрований (tauri.mdc tool_surface)`,
        { reason: PLUGIN_NOT_REGISTERED, file: libRsRel, data: { slug } }
      )
    }

    if (capIds.values().every(id => id !== slug && !id.startsWith(`${slug}:`))) {
      reporter.fail(
        `${capRel}/*.json: бракує permission "${slug}:*" для плагіна, якого торкається JS — invoke тихо падає permission-denied, видно лише в console.error (tauri.mdc tool_surface)`,
        { reason: PLUGIN_CAPABILITY_MISSING, file: capRel, data: { slug } }
      )
    }
  }
}

/**
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст lint-прогону
 * @returns {Promise<import('../../../scripts/lib/lint-surface/types.mjs').LintResult>} результат перевірки
 */
export async function lint(ctx) {
  const cwd = ctx.cwd
  const reporter = createViolationReporter(ctx)

  const apps = await findTauriAppWorkspaces(cwd)
  for (const ws of apps) {
    await checkWorkspace(ws, cwd, reporter)
  }

  return reporter.result()
}

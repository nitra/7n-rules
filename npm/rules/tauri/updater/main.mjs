/** @see ./docs/updater.md */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { globby } from 'globby'

import { createViolationReporter } from '../../../scripts/lib/lint-surface/violation-reporter.mjs'
import { getMonorepoPackageRootDirs } from '../../../scripts/lib/workspaces.mjs'

export const MIN_TAURI_COMPONENTS_VERSION = [0, 8, 0]
const CARGO_TABLE_HEADER_RE = /^\[(.+)\]\s*$/u
const CARGO_DEP_KEY_RE = /^([A-Za-z0-9_-]+)\s*=/u
const SEMVER_FLOOR_RE = /(\d+)(?:\.(\d+))?(?:\.(\d+))?/u
export const CARGO_TARGET_SECTION_RE = /target\./u
export const CARGO_MOBILE_SECTION_RE = /android|ios/u
export const CARGO_DESKTOP_TARGET_HEADER =
  'target.\'cfg(not(any(target_os = "android", target_os = "ios")))\'.dependencies'

/**
 * Звітує pass/fail через reporter за булевим предикатом — спільна форма для всіх canon-перевірок нижче.
 * @param {boolean} ok чи пройшла перевірка
 * @param {string} passMessage повідомлення при успіху
 * @param {string} failMessage повідомлення при провалі (без суфіксу правила)
 * @param {string} reason стабільна причина порушення
 * @param {string} file відносний шлях файла для звіту
 * @param {ReturnType<typeof createViolationReporter>} reporter репортер концерну
 * @returns {void}
 */
function reportCheck(ok, passMessage, failMessage, reason, file, reporter) {
  if (ok) {
    reporter.pass(passMessage)
  } else {
    reporter.fail(`${failMessage} (tauri.mdc updater)`, { reason, file })
  }
}

/**
 * Знаходить workspace-каталоги з Tauri-застосунком (`<ws>/src-tauri/tauri.conf.json` чи legacy `<ws>/tauri.conf.json`).
 * @param {string} cwd корінь репо
 * @returns {Promise<string[]>} відносні шляхи workspace-каталогів
 */
export async function findTauriAppWorkspaces(cwd) {
  const roots = await getMonorepoPackageRootDirs(cwd)
  const found = []
  for (const ws of roots) {
    const base = ws === '.' ? cwd : join(cwd, ws)
    const hasMarker =
      existsSync(join(base, 'src-tauri', 'tauri.conf.json')) || existsSync(join(base, 'tauri.conf.json'))
    if (hasMarker) found.push(ws)
  }
  return found
}

/**
 * Розбирає semver-діапазон (`^0.8.0`, `~2.3.1`, `2`) на числові компоненти нижньої межі.
 * @param {string} range рядок версії з package.json
 * @returns {number[]} [major, minor, patch] (відсутні компоненти — 0)
 */
function parseRangeFloor(range) {
  const m = SEMVER_FLOOR_RE.exec(range ?? '')
  if (!m) return [0, 0, 0]
  return [Number(m[1] ?? 0), Number(m[2] ?? 0), Number(m[3] ?? 0)]
}

/**
 * Чи нижня межа `range` >= `min` (порівняння major.minor.patch).
 * @param {string} range рядок версії
 * @param {number[]} min мінімальна версія [major, minor, patch]
 * @returns {boolean} true, якщо range задовольняє мінімум
 */
export function meetsMinVersion(range, min) {
  const v = parseRangeFloor(range)
  for (const [i, minPart] of min.entries()) {
    if (v[i] !== minPart) return v[i] > minPart
  }
  return true
}

/**
 * Чи мажорна версія `range` дорівнює очікуваній.
 * @param {string} range рядок версії
 * @param {number} major очікувана мажорна версія
 * @returns {boolean} true, якщо збігається
 */
export function hasMajor(range, major) {
  return parseRangeFloor(range)[0] === major
}

/**
 * Перевіряє package.json workspace-каталогу на канонічні updater-залежності.
 * @param {string} ws відносний шлях workspace
 * @param {string} cwd корінь репо
 * @param {ReturnType<typeof createViolationReporter>} reporter репортер концерну
 * @returns {Promise<void>} завершується після перевірки
 */
async function checkPackageJson(ws, cwd, reporter) {
  const base = ws === '.' ? cwd : join(cwd, ws)
  const pkgPath = join(base, 'package.json')
  if (!existsSync(pkgPath)) return
  const rel = ws === '.' ? 'package.json' : `${ws}/package.json`

  const pkg = JSON.parse(await readFile(pkgPath, 'utf8'))
  const deps = { ...pkg.dependencies, ...pkg.devDependencies }

  reportCheck(
    Boolean(deps['@7n/tauri-components']) &&
      meetsMinVersion(deps['@7n/tauri-components'], MIN_TAURI_COMPONENTS_VERSION),
    `${rel}: @7n/tauri-components >=0.8`,
    `${rel}: потрібна залежність "@7n/tauri-components" >=0.8 — useUpdater() з локальної копії заборонений`,
    'tauri-components-version',
    rel,
    reporter
  )
  reportCheck(
    Boolean(deps['@tauri-apps/plugin-updater']) && hasMajor(deps['@tauri-apps/plugin-updater'], 2),
    `${rel}: @tauri-apps/plugin-updater ^2`,
    `${rel}: потрібна залежність "@tauri-apps/plugin-updater" ^2`,
    'plugin-updater-missing',
    rel,
    reporter
  )
  reportCheck(
    Boolean(deps['@tauri-apps/plugin-process']) && hasMajor(deps['@tauri-apps/plugin-process'], 2),
    `${rel}: @tauri-apps/plugin-process ^2`,
    `${rel}: потрібна залежність "@tauri-apps/plugin-process" ^2`,
    'plugin-process-missing',
    rel,
    reporter
  )
}

/**
 * Групує рядки Cargo.toml за заголовком секції `[...]` для контекстного пошуку залежностей.
 * @param {string} content вміст Cargo.toml
 * @returns {Map<string, string[]>} секція → список ключів-залежностей у ній
 */
export function groupCargoDepsBySection(content) {
  const bySection = new Map()
  let current = null
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    const header = CARGO_TABLE_HEADER_RE.exec(line)
    if (header) {
      current = header[1]
      if (!bySection.has(current)) bySection.set(current, [])
      continue
    }
    const kv = CARGO_DEP_KEY_RE.exec(line)
    if (kv && current) bySection.get(current).push(kv[1])
  }
  return bySection
}

/**
 * Знаходить назву секції Cargo.toml, що оголошує задану залежність.
 * @param {Map<string, string[]>} bySection секція → ключі-залежності
 * @param {string} depName ім'я залежності
 * @returns {string | null} назва секції або null, якщо не знайдено
 */
export function findSectionDeclaring(bySection, depName) {
  for (const [section, keys] of bySection) {
    if (keys.includes(depName)) return section
  }
  return null
}

/**
 * Перевіряє Cargo.toml workspace-каталогу на канонічні updater/process залежності.
 * @param {string} ws відносний шлях workspace
 * @param {string} cwd корінь репо
 * @param {ReturnType<typeof createViolationReporter>} reporter репортер концерну
 * @returns {Promise<void>} завершується після перевірки
 */
async function checkCargoToml(ws, cwd, reporter) {
  const base = ws === '.' ? cwd : join(cwd, ws)
  const cargoPath = join(base, 'src-tauri', 'Cargo.toml')
  if (!existsSync(cargoPath)) return
  const rel = cargoPath.slice(cwd.length + 1)

  const bySection = groupCargoDepsBySection(await readFile(cargoPath, 'utf8'))

  reportCheck(
    bySection.values().some(keys => keys.includes('tauri-plugin-process')),
    `${rel}: tauri-plugin-process присутній`,
    `${rel}: бракує "tauri-plugin-process" у [dependencies]`,
    'cargo-plugin-process-missing',
    rel,
    reporter
  )

  const updaterSection = findSectionDeclaring(bySection, 'tauri-plugin-updater')
  if (updaterSection === null) {
    reporter.fail(`${rel}: бракує "tauri-plugin-updater" (tauri.mdc updater)`, {
      reason: 'cargo-plugin-updater-missing',
      file: rel
    })
    return
  }
  reportCheck(
    CARGO_TARGET_SECTION_RE.test(updaterSection) && CARGO_MOBILE_SECTION_RE.test(updaterSection),
    `${rel}: tauri-plugin-updater desktop-scoped`,
    `${rel}: "tauri-plugin-updater" має бути в desktop-only [target.'cfg(not(any(target_os = "android", target_os = "ios")))'.dependencies], не в безумовному [dependencies] — плагін не реєструється на mobile`,
    'cargo-plugin-updater-not-scoped',
    rel,
    reporter
  )
}

/**
 * Перевіряє реєстрацію updater/process плагінів у `src-tauri/src/lib.rs`.
 * @param {string} ws відносний шлях workspace
 * @param {string} cwd корінь репо
 * @param {ReturnType<typeof createViolationReporter>} reporter репортер концерну
 * @returns {Promise<void>} завершується після перевірки
 */
async function checkLibRs(ws, cwd, reporter) {
  const base = ws === '.' ? cwd : join(cwd, ws)
  const libPath = join(base, 'src-tauri', 'src', 'lib.rs')
  if (!existsSync(libPath)) return
  const rel = libPath.slice(cwd.length + 1)

  const raw = await readFile(libPath, 'utf8')
  const lines = raw.split('\n')

  reportCheck(
    lines.some(l => l.includes('tauri_plugin_process::init')),
    `${rel}: tauri_plugin_process зареєстрований`,
    `${rel}: бракує builder.plugin(tauri_plugin_process::init())`,
    'lib-rs-process-missing',
    rel,
    reporter
  )

  const updaterIdx = lines.findIndex(l => l.includes('tauri_plugin_updater::Builder'))
  if (updaterIdx === -1) {
    reporter.fail(`${rel}: бракує builder.plugin(tauri_plugin_updater::Builder::new().build()) (tauri.mdc updater)`, {
      reason: 'lib-rs-updater-missing',
      file: rel
    })
    return
  }
  const guardLine = lines.slice(0, updaterIdx).findLast(l => l.trim() !== '')
  reportCheck(
    Boolean(guardLine?.includes('#[cfg(desktop)]')),
    `${rel}: tauri_plugin_updater під #[cfg(desktop)]`,
    `${rel}: tauri_plugin_updater::Builder має бути одразу під #[cfg(desktop)] — інакше mobile-збірка падає`,
    'lib-rs-updater-not-guarded',
    rel,
    reporter
  )
}

/**
 * Збирає всі permission-ідентифікатори з `capabilities/*.json` workspace-каталогу.
 * @param {string} capDir абсолютний шлях до каталогу capabilities
 * @returns {Promise<Set<string>>} множина permission-ідентифікаторів
 */
async function collectCapabilityPermissionIds(capDir) {
  const files = await globby('*.json', { cwd: capDir, onlyFiles: true, gitignore: false })
  const ids = new Set()
  for (const file of files) {
    let cap
    try {
      cap = JSON.parse(await readFile(join(capDir, file), 'utf8'))
    } catch {
      continue
    }
    const perms = Array.isArray(cap.permissions) ? cap.permissions : []
    for (const p of perms) {
      const id = typeof p === 'string' ? p : p?.identifier
      if (id) ids.add(id)
    }
  }
  return ids
}

/**
 * Перевіряє `capabilities/*.json` на permissions "updater:default" і "process:allow-restart".
 * @param {string} ws відносний шлях workspace
 * @param {string} cwd корінь репо
 * @param {ReturnType<typeof createViolationReporter>} reporter репортер концерну
 * @returns {Promise<void>} завершується після перевірки
 */
async function checkCapabilities(ws, cwd, reporter) {
  const base = ws === '.' ? cwd : join(cwd, ws)
  const capDir = join(base, 'src-tauri', 'capabilities')
  if (!existsSync(capDir)) return
  const relDir = capDir.slice(cwd.length + 1)

  const ids = await collectCapabilityPermissionIds(capDir)

  reportCheck(
    ids.has('updater:default'),
    `${relDir}: updater:default присутній`,
    `${relDir}/*.json: бракує permission "updater:default" — check() з @7n/tauri-components/vue впаде мовчазним permission-denied, видно лише в console.error`,
    'capability-updater-missing',
    relDir,
    reporter
  )
  reportCheck(
    ids.has('process:allow-restart'),
    `${relDir}: process:allow-restart присутній`,
    `${relDir}/*.json: бракує permission "process:allow-restart" — relaunch() після встановлення оновлення впаде`,
    'capability-process-restart-missing',
    relDir,
    reporter
  )
}

/**
 * Перевіряє, що якийсь Vue-компонент викликає `useUpdater()` з `@7n/tauri-components/vue`.
 * @param {string} ws відносний шлях workspace
 * @param {string} cwd корінь репо
 * @param {ReturnType<typeof createViolationReporter>} reporter репортер концерну
 * @returns {Promise<void>} завершується після перевірки
 */
async function checkUseUpdaterCall(ws, cwd, reporter) {
  const base = ws === '.' ? cwd : join(cwd, ws)
  const srcDir = join(base, 'src')
  if (!existsSync(srcDir)) return
  const relDir = srcDir.slice(cwd.length + 1)

  const files = await globby('**/*.vue', { cwd: srcDir, onlyFiles: true, gitignore: false })
  let found = false
  for (const file of files) {
    const content = await readFile(join(srcDir, file), 'utf8')
    if (content.includes('@7n/tauri-components/vue') && content.includes('useUpdater()')) {
      found = true
      break
    }
  }

  reportCheck(
    found,
    `${relDir}: useUpdater() викликається`,
    `${relDir}: жоден *.vue не імпортує useUpdater з "@7n/tauri-components/vue" і не викликає useUpdater() — автооновлення не активується`,
    'use-updater-not-called',
    relDir,
    reporter
  )
}

const QUASAR_DIALOG_IMPORT_RE = /import\s*\{[^}]*\bDialog\b[^}]*\}\s*from\s*['"]quasar['"]/u
const QUASAR_DIALOG_PLUGIN_RE = /plugins\s*:\s*\{[^}]*\bDialog\b/u

/**
 * Перевіряє, що Quasar-плагін `Dialog` підключено в `src/main.{js,ts}`. Без нього
 * `useUpdater()` знаходить і навіть завантажує оновлення, але виклик `$q.dialog(...)`
 * падає з `TypeError: e.dialog is not a function` — помилка тихо ковтається у власному
 * catch хука, і жоден користувач ніколи не бачить діалог оновлення (виявлено реальним
 * інцидентом 2026-07-11: check() працював, install() працював, діалогу не було ніде).
 * @param {string} ws відносний шлях workspace
 * @param {string} cwd корінь репо
 * @param {ReturnType<typeof createViolationReporter>} reporter репортер концерну
 * @returns {Promise<void>} завершується після перевірки
 */
async function checkQuasarDialogPlugin(ws, cwd, reporter) {
  const base = ws === '.' ? cwd : join(cwd, ws)
  const srcDir = join(base, 'src')
  if (!existsSync(srcDir)) return
  const relDir = srcDir.slice(cwd.length + 1)

  const entryFiles = await globby(['main.js', 'main.ts'], { cwd: srcDir, onlyFiles: true, gitignore: false })
  for (const file of entryFiles) {
    const content = await readFile(join(srcDir, file), 'utf8')
    if (!content.includes('Quasar')) continue // не Quasar-застосунок — поза межами цього чека

    const ok = QUASAR_DIALOG_IMPORT_RE.test(content) && QUASAR_DIALOG_PLUGIN_RE.test(content)
    reportCheck(
      ok,
      `${relDir}/${file}: Quasar Dialog plugin підключено`,
      `${relDir}/${file}: useUpdater() показує оновлення через $q.dialog(...), але Quasar-плагін "Dialog" не в списку plugins: {...} — check()/downloadAndInstall() відпрацьовують, та $q.dialog(...) падає з "e.dialog is not a function"; помилка тихо ковтається в catch, діалог оновлення не з'являється ніколи`,
      'quasar-dialog-plugin-missing',
      relDir,
      reporter
    )
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
  if (apps.length === 0) {
    return reporter.result()
  }

  for (const ws of apps) {
    await checkPackageJson(ws, cwd, reporter)
    await checkCargoToml(ws, cwd, reporter)
    await checkLibRs(ws, cwd, reporter)
    await checkCapabilities(ws, cwd, reporter)
    await checkUseUpdaterCall(ws, cwd, reporter)
    await checkQuasarDialogPlugin(ws, cwd, reporter)
  }

  return reporter.result()
}

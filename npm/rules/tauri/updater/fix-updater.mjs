/**
 * T0-autofix для `tauri/updater` — детерміновані доповнення канонічних updater-конфігів:
 * package.json (deps), Cargo.toml (desktop-scoped плагіни), lib.rs (#[cfg(desktop)]-guard
 * над вже існуючим рядком реєстрації), capabilities/*.json (permissions).
 *
 * Свідомо НЕ чіпає:
 *   - `lib-rs-process-missing`/`lib-rs-updater-missing` — треба вставити НОВИЙ рядок
 *     `.plugin(...)` у середину довільного builder-ланцюжка; точка вставки не
 *     детермінована між проєктами (ризик поламати build);
 *   - `use-updater-not-called` — редагування чужого SFC (`<script setup>`), ризик
 *     поламати існуючі імпорти.
 * Обидва пункти лишаються manual (structural fixability, без LLM-ladder).
 */
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  CARGO_DESKTOP_TARGET_HEADER,
  CARGO_MOBILE_SECTION_RE,
  CARGO_TARGET_SECTION_RE,
  MIN_TAURI_COMPONENTS_VERSION,
  findSectionDeclaring,
  findTauriAppWorkspaces,
  groupCargoDepsBySection,
  hasMajor,
  meetsMinVersion
} from './main.mjs'

const CARGO_DEP_LINE_RE = new Map([
  ['tauri-plugin-process', /^tauri-plugin-process\s*=.*$/u],
  ['tauri-plugin-updater', /^tauri-plugin-updater\s*=.*$/u]
])
const LEADING_WHITESPACE_RE = /^(\s*)/u

/**
 * Доповнює `package.json` workspace-каталогу канонічними updater-залежностями.
 * @param {string} ws відносний шлях workspace
 * @param {string} cwd корінь репо
 * @returns {Promise<string | null>} абсолютний шлях зміненого файла або null
 */
async function fixPackageJson(ws, cwd) {
  const base = ws === '.' ? cwd : join(cwd, ws)
  const pkgPath = join(base, 'package.json')
  if (!existsSync(pkgPath)) return null

  const pkg = JSON.parse(await readFile(pkgPath, 'utf8'))
  const deps = { ...pkg.dependencies, ...pkg.devDependencies }
  let changed = false

  if (!deps['@7n/tauri-components'] || !meetsMinVersion(deps['@7n/tauri-components'], MIN_TAURI_COMPONENTS_VERSION)) {
    pkg.dependencies = { ...pkg.dependencies, '@7n/tauri-components': '^0.8.0' }
    changed = true
  }
  if (!deps['@tauri-apps/plugin-updater'] || !hasMajor(deps['@tauri-apps/plugin-updater'], 2)) {
    pkg.dependencies = { ...pkg.dependencies, '@tauri-apps/plugin-updater': '^2' }
    changed = true
  }
  if (!deps['@tauri-apps/plugin-process'] || !hasMajor(deps['@tauri-apps/plugin-process'], 2)) {
    pkg.dependencies = { ...pkg.dependencies, '@tauri-apps/plugin-process': '^2' }
    changed = true
  }

  if (!changed) return null
  await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')
  return pkgPath
}

/**
 * Вставляє `lineText` одразу після заголовка секції `[sectionHeaderExact]`; якщо секції
 * немає — додає нову секцію в кінець файла. Ідемпотентно (не дублює вже присутній рядок).
 * @param {string[]} lines рядки файла
 * @param {string} sectionHeaderExact точний вміст заголовка секції (без дужок)
 * @param {string} lineText рядок для вставки
 * @returns {{lines: string[], changed: boolean}} оновлені рядки й ознака зміни
 */
function insertLineIntoCargoSection(lines, sectionHeaderExact, lineText) {
  if (lines.some(l => l.trim() === lineText.trim())) return { lines, changed: false }
  const headerIdx = lines.findIndex(l => l.trim() === `[${sectionHeaderExact}]`)
  if (headerIdx === -1) {
    const next = [...lines]
    if (next.at(-1)?.trim() !== '') next.push('')
    next.push(`[${sectionHeaderExact}]`, lineText, '')
    return { lines: next, changed: true }
  }
  const next = [...lines]
  next.splice(headerIdx + 1, 0, lineText)
  return { lines: next, changed: true }
}

/**
 * Видаляє перший рядок, що оголошує `depName` (незалежно від секції).
 * @param {string[]} lines рядки файла
 * @param {RegExp} depLineRe регекс рядка залежності
 * @returns {{lines: string[], removed: string | null}} оновлені рядки й видалений рядок (як є)
 */
function removeCargoDependencyLine(lines, depLineRe) {
  const idx = lines.findIndex(l => depLineRe.test(l.trim()))
  if (idx === -1) return { lines, removed: null }
  const next = [...lines]
  const [removed] = next.splice(idx, 1)
  return { lines: next, removed }
}

/**
 * Доповнює `Cargo.toml` канонічними updater/process залежностями (append чи move у
 * desktop-only target-секцію) — read-once, re-detect потім підтвердить стан.
 * @param {string} ws відносний шлях workspace
 * @param {string} cwd корінь репо
 * @returns {Promise<string | null>} абсолютний шлях зміненого файла або null
 */
async function fixCargoToml(ws, cwd) {
  const base = ws === '.' ? cwd : join(cwd, ws)
  const cargoPath = join(base, 'src-tauri', 'Cargo.toml')
  if (!existsSync(cargoPath)) return null

  const content = await readFile(cargoPath, 'utf8')
  let lines = content.split('\n')
  let changed = false

  const bySection = groupCargoDepsBySection(content)
  const hasProcess = bySection.values().some(keys => keys.includes('tauri-plugin-process'))
  if (!hasProcess) {
    const res = insertLineIntoCargoSection(lines, 'dependencies', 'tauri-plugin-process = "2.3.1"')
    lines = res.lines
    changed ||= res.changed
  }

  const updaterSection = findSectionDeclaring(bySection, 'tauri-plugin-updater')
  const isDesktopScoped =
    updaterSection !== null &&
    CARGO_TARGET_SECTION_RE.test(updaterSection) &&
    CARGO_MOBILE_SECTION_RE.test(updaterSection)
  if (updaterSection === null) {
    const res = insertLineIntoCargoSection(lines, CARGO_DESKTOP_TARGET_HEADER, 'tauri-plugin-updater = "2"')
    lines = res.lines
    changed ||= res.changed
  } else if (!isDesktopScoped) {
    const removal = removeCargoDependencyLine(lines, CARGO_DEP_LINE_RE.get('tauri-plugin-updater'))
    if (removal.removed) {
      const res = insertLineIntoCargoSection(removal.lines, CARGO_DESKTOP_TARGET_HEADER, removal.removed.trim())
      lines = res.lines
      changed ||= true
    }
  }

  if (!changed) return null
  await writeFile(cargoPath, lines.join('\n'), 'utf8')
  return cargoPath
}

/**
 * Вставляє `#[cfg(desktop)]` одразу над рядком реєстрації `tauri_plugin_updater::Builder`,
 * якщо його там ще немає. Не чіпає файл, якщо самого рядка реєстрації немає взагалі
 * (це окрема, не-T0 причина — `lib-rs-updater-missing`).
 * @param {string} ws відносний шлях workspace
 * @param {string} cwd корінь репо
 * @returns {Promise<string | null>} абсолютний шлях зміненого файла або null
 */
async function fixLibRsGuard(ws, cwd) {
  const base = ws === '.' ? cwd : join(cwd, ws)
  const libPath = join(base, 'src-tauri', 'src', 'lib.rs')
  if (!existsSync(libPath)) return null

  const libContent = await readFile(libPath, 'utf8')
  const lines = libContent.split('\n')
  const updaterIdx = lines.findIndex(l => l.includes('tauri_plugin_updater::Builder'))
  if (updaterIdx === -1) return null

  const guardLine = lines.slice(0, updaterIdx).findLast(l => l.trim() !== '')
  if (guardLine?.includes('#[cfg(desktop)]')) return null

  const indentMatch = LEADING_WHITESPACE_RE.exec(lines[updaterIdx])
  const indent = indentMatch ? indentMatch[1] : ''
  lines.splice(updaterIdx, 0, `${indent}#[cfg(desktop)]`)
  await writeFile(libPath, lines.join('\n'), 'utf8')
  return libPath
}

/**
 * Додає permission у `permissions[]` JSON-файла capability; створює файл з канонічним
 * baseline, якщо його ще немає.
 * @param {string} path абсолютний шлях JSON-файла
 * @param {string} permission permission-ідентифікатор для додавання
 * @param {Record<string, unknown>} baseline канонічний вміст, якщо файла немає
 * @returns {Promise<boolean>} true, якщо файл записано
 */
async function ensureCapabilityPermission(path, permission, baseline) {
  if (!existsSync(path)) {
    await writeFile(path, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8')
    return true
  }
  let cap
  try {
    cap = JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return false
  }
  const perms = Array.isArray(cap.permissions) ? cap.permissions : []
  if (perms.includes(permission)) return false
  cap.permissions = [...perms, permission]
  await writeFile(path, `${JSON.stringify(cap, null, 2)}\n`, 'utf8')
  return true
}

/**
 * Доповнює `capabilities/*.json` канонічними permissions (`updater:default` — в окремому
 * platform-scoped `updater.json`, `process:allow-restart` — в `default.json`).
 * @param {string} ws відносний шлях workspace
 * @param {string} cwd корінь репо
 * @param {Set<string>} reasons причини порушень, наявні для цього workspace
 * @returns {Promise<string[]>} абсолютні шляхи змінених файлів
 */
async function fixCapabilities(ws, cwd, reasons) {
  const base = ws === '.' ? cwd : join(cwd, ws)
  const capDir = join(base, 'src-tauri', 'capabilities')
  if (!existsSync(capDir)) return []
  const touched = []

  if (reasons.has('capability-updater-missing')) {
    const wrote = await ensureCapabilityPermission(join(capDir, 'updater.json'), 'updater:default', {
      identifier: 'updater',
      windows: ['main'],
      platforms: ['macOS', 'windows', 'linux'],
      permissions: ['updater:default']
    })
    if (wrote) touched.push(join(capDir, 'updater.json'))
  }

  if (reasons.has('capability-process-restart-missing')) {
    const wrote = await ensureCapabilityPermission(join(capDir, 'default.json'), 'process:allow-restart', {
      identifier: 'default',
      windows: ['main'],
      permissions: ['core:default', 'process:allow-restart']
    })
    if (wrote) touched.push(join(capDir, 'default.json'))
  }

  return touched
}

/**
 * Групує violations concern-а за workspace (`v.file` починається з `<ws>/`).
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintViolation[]} violations порушення концерну
 * @param {string[]} apps список workspace-шляхів
 * @returns {Map<string, Set<string>>} workspace → множина reasons
 */
function groupReasonsByWorkspace(violations, apps) {
  const byWs = new Map(apps.map(ws => [ws, new Set()]))
  const specificFirst = apps.toSorted((a, b) => (a === '.' ? 1 : 0) - (b === '.' ? 1 : 0))
  for (const v of violations) {
    const ws = specificFirst.find(a => (a === '.' ? true : v.file?.startsWith(`${a}/`))) ?? '.'
    byWs.get(ws)?.add(v.reason)
  }
  return byWs
}

/** @type {import('../../../scripts/lib/lint-surface/types.mjs').T0Pattern[]} */
export const patterns = [
  {
    id: 'updater-package-json-deps',
    test: violations =>
      violations.some(v =>
        ['tauri-components-version', 'plugin-updater-missing', 'plugin-process-missing'].includes(v.reason)
      ),
    apply: async (_violations, ctx) => {
      const apps = await findTauriAppWorkspaces(ctx.cwd)
      const results = await Promise.all(apps.map(ws => fixPackageJson(ws, ctx.cwd)))
      const touchedFiles = results.filter(Boolean)
      for (const f of touchedFiles) ctx.recordWrite?.(f)
      return touchedFiles.length > 0
        ? { touchedFiles, message: `package.json updater-залежності доповнено: ${touchedFiles.length} файл(ів)` }
        : { touchedFiles: [] }
    }
  },
  {
    id: 'updater-cargo-toml-canon',
    test: violations =>
      violations.some(v =>
        ['cargo-plugin-process-missing', 'cargo-plugin-updater-missing', 'cargo-plugin-updater-not-scoped'].includes(
          v.reason
        )
      ),
    apply: async (_violations, ctx) => {
      const apps = await findTauriAppWorkspaces(ctx.cwd)
      const results = await Promise.all(apps.map(ws => fixCargoToml(ws, ctx.cwd)))
      const touchedFiles = results.filter(Boolean)
      for (const f of touchedFiles) ctx.recordWrite?.(f)
      return touchedFiles.length > 0
        ? { touchedFiles, message: `Cargo.toml updater/process-плагіни доповнено: ${touchedFiles.length} файл(ів)` }
        : { touchedFiles: [] }
    }
  },
  {
    id: 'updater-lib-rs-cfg-guard',
    test: violations => violations.some(v => v.reason === 'lib-rs-updater-not-guarded'),
    apply: async (_violations, ctx) => {
      const apps = await findTauriAppWorkspaces(ctx.cwd)
      const results = await Promise.all(apps.map(ws => fixLibRsGuard(ws, ctx.cwd)))
      const touchedFiles = results.filter(Boolean)
      for (const f of touchedFiles) ctx.recordWrite?.(f)
      return touchedFiles.length > 0
        ? { touchedFiles, message: `lib.rs: #[cfg(desktop)] проставлено: ${touchedFiles.length} файл(ів)` }
        : { touchedFiles: [] }
    }
  },
  {
    id: 'updater-capabilities-canon',
    test: violations =>
      violations.some(v => ['capability-updater-missing', 'capability-process-restart-missing'].includes(v.reason)),
    apply: async (violations, ctx) => {
      const apps = await findTauriAppWorkspaces(ctx.cwd)
      const byWs = groupReasonsByWorkspace(violations, apps)
      const results = await Promise.all(apps.map(ws => fixCapabilities(ws, ctx.cwd, byWs.get(ws) ?? new Set())))
      const touchedFiles = results.flat()
      for (const f of touchedFiles) ctx.recordWrite?.(f)
      return touchedFiles.length > 0
        ? { touchedFiles, message: `capabilities/*.json permissions доповнено: ${touchedFiles.length} файл(ів)` }
        : { touchedFiles: [] }
    }
  }
]

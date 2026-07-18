/** @see ./docs/cargo-diff.md */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse as parseToml } from 'smol-toml'

import { isBreaking } from '@7n/rules/plugin-api'

/** Поля Cargo.toml із залежностями, які порівнюємо (аналог DEP_FIELDS у diff.mjs). */
const CARGO_DEP_FIELDS = ['dependencies', 'dev-dependencies', 'build-dependencies']

/** Дефолтний суфікс бекапу — той самий, що й для package.json (крок 1 SKILL.md, Rust-гілка). */
const DEFAULT_BACKUP_SUFFIX = '.taze-bak'

// 1-3 числові компоненти (`"1"`, `"0.4"`, `"1.2.3"`), опційний `=`/`~`/`^`/`>=`-префікс.
//Cargo трактує відсутні компоненти як 0 і для матчингу, і для caret-сумісності —
// той самий "найлівіша ненульова компонента" принцип, що й у isBreaking з diff.mjs.
const CARGO_VERSION_RE = /^[\s=~^><]*(\d+)(?:\.(\d+))?(?:\.(\d+))?/

/**
 * Парсить Cargo-версійний specifier (1-3 компоненти, відсутні → 0).
 * @param {string} spec версійний specifier із Cargo.toml (`"1"`, `"0.4.2"`, `"=1.2.3"`)
 * @returns {{major:number, minor:number, patch:number}|null} ядро або null для не-semver
 */
export function parseCargoVersion(spec) {
  if (typeof spec !== 'string') return null
  const m = CARGO_VERSION_RE.exec(spec)
  if (!m) return null
  return { major: Number(m[1]), minor: Number(m[2] ?? 0), patch: Number(m[3] ?? 0) }
}

/**
 * Дістає версійний specifier одного запису залежності Cargo.toml — рядок
 * напряму (`tokio = "1"`), або поле `version` inline-таблиці
 * (`serde = { version = "1", features = [...] }`).
 * @param {unknown} value значення запису залежності
 * @returns {string|null} specifier, або null для path/git-залежності (без номера версії)
 */
export function extractCargoVersionSpec(value) {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && !Array.isArray(value) && typeof value.version === 'string') {
    return value.version
  }
  return null
}

/**
 * Порівнює два розпарсені Cargo.toml і повертає зміни залежностей —
 * той самий контракт, що й `diffPackageJson` ядра, лише для Cargo.
 * @param {object} oldManifest розпарсений старий Cargo.toml (бекап)
 * @param {object} newManifest розпарсений новий Cargo.toml
 * @param {string} manifest відносний шлях Cargo.toml (мітка джерела запису)
 * @returns {{major: Array<{manifest:string, pkg:string, from:string, to:string}>, minorPatch:number}} зміни
 */
export function diffCargoToml(oldManifest, newManifest, manifest) {
  const major = []
  let minorPatch = 0
  for (const field of CARGO_DEP_FIELDS) {
    const oldDeps = oldManifest?.[field]
    const newDeps = newManifest?.[field]
    if (!oldDeps || !newDeps) continue
    for (const [crate, oldValue] of Object.entries(oldDeps)) {
      const newValue = newDeps[crate]
      if (newValue === undefined) continue
      const from = extractCargoVersionSpec(oldValue)
      const to = extractCargoVersionSpec(newValue)
      if (from === null || to === null || from === to) continue
      const fromV = parseCargoVersion(from)
      const toV = parseCargoVersion(to)
      if (fromV && toV && isBreaking(fromV, toV)) {
        major.push({ manifest, pkg: crate, from, to })
      } else {
        minorPatch += 1
      }
    }
  }
  return { major, minorPatch }
}

/**
 * Читає й парсить TOML-файл, або повертає null, якщо файл відсутній/невалідний.
 * @param {string} path абсолютний шлях
 * @returns {Promise<object|null>} розпарсений обʼєкт або null
 */
async function readTomlOrNull(path) {
  if (!existsSync(path)) return null
  try {
    return parseToml(await readFile(path, 'utf8'))
  } catch {
    return null
  }
}

/**
 * Збирає diff по всіх Cargo.toml монорепо: для кожного шляху зі списку
 * порівнює `<manifest>` з `<manifest><backupSuffix>` — той самий контракт,
 * що й `collectTazeDiff` для package.json.
 * @param {string} cwd корінь репозиторію
 * @param {string[]} manifestPaths відносні шляхи Cargo.toml (з `findCargoManifests`)
 * @param {string} [backupSuffix] суфікс бекап-файлу
 * @returns {Promise<{major: Array<{manifest:string, pkg:string, from:string, to:string}>, minorPatch:number, totalChanged:number, comparedManifests:number}>} агрегований diff
 */
export async function collectCargoDiff(cwd, manifestPaths, backupSuffix = DEFAULT_BACKUP_SUFFIX) {
  const major = []
  let minorPatch = 0
  let comparedManifests = 0
  for (const manifest of manifestPaths) {
    const oldManifest = await readTomlOrNull(join(cwd, `${manifest}${backupSuffix}`))
    const newManifest = await readTomlOrNull(join(cwd, manifest))
    if (!oldManifest || !newManifest) continue
    comparedManifests += 1
    const res = diffCargoToml(oldManifest, newManifest, manifest)
    major.push(...res.major)
    minorPatch += res.minorPatch
  }
  return { major, minorPatch, totalChanged: major.length + minorPatch, comparedManifests }
}

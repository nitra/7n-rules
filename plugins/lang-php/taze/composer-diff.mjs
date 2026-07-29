/** @see ./docs/composer-diff.md */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { isBreaking } from '@7n/rules/plugin-api'

/** Поля composer.json із залежностями, які порівнюємо (аналог CARGO_DEP_FIELDS у lang-rust). */
const COMPOSER_DEP_FIELDS = ['require', 'require-dev']

/** Дефолтний суфікс бекапу — той самий, що й для package.json/pyproject.toml/Cargo.toml. */
const DEFAULT_BACKUP_SUFFIX = '.taze-bak'

// 1-3 числові компоненти (`"7"`, `"7.4"`, `"1.2.3"`), опційний `^`/`~`/`>=`/`v`-префікс,
// зупиняється на першому нечисловому сегменті (`.*`-wildcard, ` || `-альтернатива,
// `-stable`/`-dev`-суфікс) — той самий "мінімально достатньо" підхід, що й parseCargoVersion:
// нас цікавить лише ліва (найконсервативніша) гілка constraint-у для caret-класифікації.
const COMPOSER_VERSION_RE = /^[\s^~>=<v]*(\d+)(?:\.(\d+))?(?:\.(\d+))?/

/**
 * Парсить Composer-версійний constraint (1-3 компоненти, відсутні → 0). Не претендує на повний
 * розбір усіх Composer-версійних форм (OR-набори `||`, wildcard `.*`, `dev-`/`branch-alias`) —
 * бере лише ліву числову гілку, достатню для caret-класифікації major vs minor/patch.
 * @param {string} spec версійний constraint із composer.json (`"^7.4"`, `"~1.2"`, `"1.2.*"`)
 * @returns {{major:number, minor:number, patch:number}|null} ядро або null для не-semver (`"*"`, `"dev-master"`)
 */
export function parseComposerVersion(spec) {
  if (typeof spec !== 'string') return null
  const m = COMPOSER_VERSION_RE.exec(spec)
  if (!m) return null
  return { major: Number(m[1]), minor: Number(m[2] ?? 0), patch: Number(m[3] ?? 0) }
}

/**
 * Чи є ключ `require`/`require-dev` реальним Composer-пакетом (`vendor/package`), а не
 * платформним псевдо-пакетом (`php`, `ext-json`, `lib-openssl`, `composer-plugin-api`,
 * `composer-runtime-api`) — платформні вимоги не мають окремого дерева версій, яке можна
 * підняти через `composer require`, тому виключені з diff/bump.
 * @param {string} name ключ секції `require`/`require-dev`
 * @returns {boolean} true — реальний пакет (`vendor/package`)
 */
export function isRealComposerPackage(name) {
  return typeof name === 'string' && name.includes('/')
}

/**
 * Порівнює два розпарсені composer.json і повертає зміни залежностей — той самий контракт,
 * що й `diffCargoToml`/`diffPyprojectDeps` інших мовних плагінів.
 * @param {object} oldManifest розпарсений старий composer.json (бекап)
 * @param {object} newManifest розпарсений новий composer.json
 * @param {string} manifest відносний шлях composer.json (мітка джерела запису)
 * @returns {{major: Array<{manifest:string, pkg:string, from:string, to:string}>, minorPatch:number}} зміни
 */
export function diffComposerJson(oldManifest, newManifest, manifest) {
  const major = []
  let minorPatch = 0
  for (const field of COMPOSER_DEP_FIELDS) {
    const oldDeps = oldManifest?.[field]
    const newDeps = newManifest?.[field]
    if (!oldDeps || !newDeps) continue
    for (const [pkg, from] of Object.entries(oldDeps)) {
      if (!isRealComposerPackage(pkg)) continue
      const to = newDeps[pkg]
      if (typeof from !== 'string' || typeof to !== 'string' || from === to) continue

      const fromV = parseComposerVersion(from)
      const toV = parseComposerVersion(to)
      if (fromV && toV && isBreaking(fromV, toV)) {
        major.push({ manifest, pkg, from, to })
      } else {
        minorPatch += 1
      }
    }
  }
  return { major, minorPatch }
}

/**
 * Читає й парсить JSON-файл, або повертає null, якщо файл відсутній/невалідний.
 * @param {string} path абсолютний шлях
 * @returns {Promise<object|null>} розпарсений обʼєкт або null
 */
async function readJsonOrNull(path) {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return null
  }
}

/**
 * Збирає diff по composer.json: порівнює `<cwd>/composer.json` з
 * `<cwd>/composer.json<backupSuffix>` — той самий контракт, що й `collectUvDiff`/`collectCargoDiff`.
 * @param {string} cwd корінь репозиторію (root-only — той самий автодетект-конвенція, що й `rules/php/project/main.mjs`)
 * @param {string} [backupSuffix] суфікс бекап-файлу
 * @returns {Promise<{major: Array<{manifest:string, pkg:string, from:string, to:string}>, minorPatch:number, totalChanged:number, comparedManifests:number}>} агрегований diff
 */
export async function collectComposerDiff(cwd, backupSuffix = DEFAULT_BACKUP_SUFFIX) {
  const oldManifest = await readJsonOrNull(join(cwd, `composer.json${backupSuffix}`))
  const newManifest = await readJsonOrNull(join(cwd, 'composer.json'))
  if (!oldManifest || !newManifest) {
    return { major: [], minorPatch: 0, totalChanged: 0, comparedManifests: 0 }
  }
  const res = diffComposerJson(oldManifest, newManifest, 'composer.json')
  return {
    major: res.major,
    minorPatch: res.minorPatch,
    totalChanged: res.major.length + res.minorPatch,
    comparedManifests: 1
  }
}

/**
 * Дістає `{name, dev}` кожної прямої залежності з `require`/`require-dev` поточного
 * composer.json (платформні псевдо-пакети — виключені, `isRealComposerPackage`) — вхід для
 * per-пакетного bump-циклу.
 * @param {object} manifest розпарсений composer.json
 * @returns {Array<{name: string, dev: boolean}>} прямі залежності
 */
export function listDirectComposerDependencies(manifest) {
  const deps = []
  for (const name of Object.keys(manifest?.require ?? {})) {
    if (isRealComposerPackage(name)) deps.push({ name, dev: false })
  }
  for (const name of Object.keys(manifest?.['require-dev'] ?? {})) {
    if (isRealComposerPackage(name)) deps.push({ name, dev: true })
  }
  return deps
}

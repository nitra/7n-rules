/**
 * `n-cursor taze diff` — read-only детермінований diff версій залежностей між
 * `package.json` і його бекапом `package.json.taze-bak` (root + усі воркспейси
 * монорепо), із класифікацією кожної зміни за semver.
 *
 * Мотивація: скіл `n-taze` раніше казав LLM-агенту вручну порівнювати backup із
 * новим `package.json` по всіх воркспейсах і вирішувати, де «змінилась перша
 * значуща цифра semver» (major). Це детермінований JSON-diff + semver-логіка —
 * скрипт робить це за мілісекунди й без помилок, а агент отримує готовий список
 * major-оновлень для справді когнітивної роботи (читання CHANGELOG, рефакторинг).
 *
 * «Breaking» (major) рахуємо за caret-семантикою — змінилась найлівіша ненульова
 * компонента: `1.x→2.x`, `0.4.x→0.5.x`, `0.0.3→0.0.4`. Minor/patch вважаємо
 * сумісними.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { getMonorepoPackageRootDirs } from '../../../scripts/lib/workspaces.mjs'

/** Поля package.json із залежностями, які порівнюємо. */
const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']

/** Дефолтний суфікс бекапу, який створює крок 1 скіла (`cp package.json package.json.taze-bak`). */
const DEFAULT_BACKUP_SUFFIX = '.taze-bak'

// Заякорено на початок (після можливих range-операторів `^~>=<`, пробілів, `v`),
// щоб НЕ ловити версію всередині protocol-specifier-ів (`workspace:1.0.0`, `npm:x@1.2.3`).
const SEMVER_RE = /^[\s~^>=<v]*(\d+)\.(\d+)\.(\d+)/

/**
 * Парсить semver-ядро зі specifier-а (ігнорує range-префікси `^`/`~`/`>=` тощо).
 * @param {string} spec версійний specifier із package.json
 * @returns {{major:number, minor:number, patch:number}|null} ядро або null для не-semver (`workspace:*`, git-url, `*`)
 */
export function parseVersion(spec) {
  if (typeof spec !== 'string') return null
  const m = SEMVER_RE.exec(spec)
  if (!m) return null
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) }
}

/**
 * Чи є перехід `from → to` breaking за caret-семантикою (змінилась найлівіша
 * ненульова компонента).
 * @param {{major:number,minor:number,patch:number}} from стара версія
 * @param {{major:number,minor:number,patch:number}} to нова версія
 * @returns {boolean} true — major/breaking
 */
export function isBreaking(from, to) {
  if (from.major !== to.major) return true
  if (from.major > 0) return false
  if (from.minor !== to.minor) return true
  if (from.minor > 0) return false
  return from.patch !== to.patch
}

/**
 * Порівнює два package.json-обʼєкти й повертає зміни залежностей.
 * @param {object} oldPkg розпарсений старий package.json (бекап)
 * @param {object} newPkg розпарсений новий package.json
 * @param {string} workspace мітка воркспейсу (`.` для кореня)
 * @returns {{major: Array<{workspace:string, pkg:string, from:string, to:string}>, minorPatch:number}} зміни
 */
export function diffPackageJson(oldPkg, newPkg, workspace) {
  const major = []
  let minorPatch = 0
  for (const field of DEP_FIELDS) {
    const oldDeps = oldPkg?.[field]
    const newDeps = newPkg?.[field]
    if (!oldDeps || !newDeps) continue
    for (const [pkg, from] of Object.entries(oldDeps)) {
      const to = newDeps[pkg]
      if (to === undefined || to === from) continue
      const fromV = parseVersion(from)
      const toV = parseVersion(to)
      if (fromV && toV && isBreaking(fromV, toV)) {
        major.push({ workspace, pkg, from, to })
      } else {
        minorPatch += 1
      }
    }
  }
  return { major, minorPatch }
}

/**
 * Читає JSON-файл або повертає null, якщо файл відсутній / невалідний.
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
 * Збирає diff по всьому монорепо: для кожного воркспейсу порівнює
 * `<ws>/package.json` з `<ws>/package.json<backupSuffix>`.
 * @param {string} cwd корінь репозиторію
 * @param {string} [backupSuffix] суфікс бекап-файлу
 * @returns {Promise<{major: Array<{workspace:string, pkg:string, from:string, to:string}>, minorPatch:number, totalChanged:number, comparedWorkspaces:number}>} агрегований diff
 */
export async function collectTazeDiff(cwd, backupSuffix = DEFAULT_BACKUP_SUFFIX) {
  const roots = await getMonorepoPackageRootDirs(cwd)
  const major = []
  let minorPatch = 0
  let comparedWorkspaces = 0
  for (const ws of roots) {
    const dir = join(cwd, ws)
    const oldPkg = await readJsonOrNull(join(dir, `package.json${backupSuffix}`))
    const newPkg = await readJsonOrNull(join(dir, 'package.json'))
    if (!oldPkg || !newPkg) continue
    comparedWorkspaces += 1
    const res = diffPackageJson(oldPkg, newPkg, ws)
    major.push(...res.major)
    minorPatch += res.minorPatch
  }
  return { major, minorPatch, totalChanged: major.length + minorPatch, comparedWorkspaces }
}

const USAGE = 'Usage: n-cursor taze diff [--backup-suffix <suffix>]'

/**
 * CLI: `n-cursor taze diff` друкує компактний JSON зі списком major-оновлень і
 * лічбою minor/patch. Read-only.
 * @param {string[]} args аргументи після `taze`
 * @param {string} [cwd] корінь репозиторію (ін'єкція для тестів)
 * @returns {Promise<number>} exit code
 */
export async function runTazeCli(args, cwd = process.cwd()) {
  if (args[0] !== 'diff') {
    console.error(USAGE)
    return 1
  }
  const flagAt = args.indexOf('--backup-suffix')
  const backupSuffix = flagAt === -1 ? DEFAULT_BACKUP_SUFFIX : args[flagAt + 1]
  if (!backupSuffix) {
    console.error(USAGE)
    return 1
  }
  const diff = await collectTazeDiff(cwd, backupSuffix)
  if (diff.comparedWorkspaces === 0) {
    console.error(`✗ Не знайдено жодного package.json${backupSuffix} — спершу зроби бекап (крок 1 скіла).`)
    return 1
  }
  process.stdout.write(`${JSON.stringify(diff)}\n`)
  return 0
}

/** @see ./docs/diff.md */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { isBreaking, parseVersion } from '@7n/rules/plugin-api'
import { getMonorepoPackageRootDirs } from '@7n/rules/scripts/lib/workspaces.mjs'

/** Поля package.json із залежностями, які порівнюємо. */
const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']

/** Дефолтний суфікс бекапу, який створює крок 1 скіла (`cp package.json package.json.taze-bak`). */
const DEFAULT_BACKUP_SUFFIX = '.taze-bak'

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

const USAGE = 'Usage: n-rules taze diff [--backup-suffix <suffix>]'

/**
 * CLI: `n-rules taze diff` друкує компактний JSON зі списком major-оновлень і
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

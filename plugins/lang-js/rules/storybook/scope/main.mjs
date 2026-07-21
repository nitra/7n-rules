/** @see ./docs/main.md */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { createViolationReporter } from '@7n/rules/scripts/lib/lint-surface/violation-reporter.mjs'
import { loadCursorIgnorePaths } from '@7n/rules/scripts/lib/load-cursor-config.mjs'
import { walkDir } from '@7n/rules/scripts/utils/walkDir.mjs'
import { getMonorepoPackageRootDirs } from '@7n/rules/scripts/lib/workspaces.mjs'
import { isVueComponentLibraryPkg } from '../../vue/packages/main.mjs'

const CONFIG_FILE = '.n-rules.json'
const LEGACY_CONFIG_FILE = '.n-cursor.json'
const VITE_CONFIG_FILES = ['vite.config.js', 'vite.config.ts', 'vite.config.mjs']

/** Поріг кількості `.vue`-файлів для скоупу канону Storybook (ADR Кластер 1). */
export const VUE_FILE_THRESHOLD = 3

/**
 * @typedef {object} InScopePackage
 * @property {string} rootDir відносний (posix) корінь пакета, `.` для кореня монорепо
 * @property {string} absDir абсолютний шлях кореня пакета
 * @property {Record<string, unknown>} pkg розпарсений `package.json` пакета
 * @property {number} vueFileCount кількість знайдених `.vue`-файлів
 */

/**
 * Читає `storybook.optOut` з `.n-rules.json` (fallback — legacy `.n-cursor.json`). Толерантно до
 * відсутнього файлу/поля/невалідного JSON — повертає порожній масив (open-by-default, як
 * `read-n-rules-config-lite.mjs`). Значення — root dir пакетів (`.` для кореня, `packages/ui` тощо),
 * той самий формат, що повертає `getMonorepoPackageRootDirs`.
 * @param {string} cwd абсолютний корінь репозиторію
 * @returns {Promise<string[]>} перелік opt-out root dir-ів
 */
export async function readStorybookOptOut(cwd) {
  let file = join(cwd, CONFIG_FILE)
  if (!existsSync(file)) file = join(cwd, LEGACY_CONFIG_FILE)
  if (!existsSync(file)) return []
  let raw
  try {
    raw = JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return []
  }
  const list = raw?.storybook?.optOut
  if (!Array.isArray(list)) return []
  return list.filter(v => typeof v === 'string' && v.trim().length > 0)
}

/**
 * Читає прапорець хвилі 2 `storybook.detectApps` з `.n-rules.json`. За замовчуванням `false` —
 * детекція app-проєктів (`vue` у dependencies + `src/pages/`) лишається відкритим питанням ADR
 * і не впливає на скоуп, доки консюмер-репо не увімкне прапорець явно.
 * @param {string} cwd абсолютний корінь репозиторію
 * @returns {Promise<boolean>} true, якщо app-проєкти теж треба зібрати у скоуп
 */
export async function readDetectAppsFlag(cwd) {
  let file = join(cwd, CONFIG_FILE)
  if (!existsSync(file)) file = join(cwd, LEGACY_CONFIG_FILE)
  if (!existsSync(file)) return false
  let raw
  try {
    raw = JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return false
  }
  return raw?.storybook?.detectApps === true
}

/**
 * Рахує `.vue`-файли в дереві пакета (поважає `.gitignore` й `ignore` з `.n-rules.json` через
 * `walkDir`/`ignorePaths` — той самий обхід, що й `vue/packages`).
 * @param {string} absPkgDir абсолютний шлях кореня пакета
 * @param {string[]} ignorePaths абсолютні шляхи, повністю виключені з обходу
 * @returns {Promise<number>} кількість `.vue`-файлів
 */
export async function countVueFiles(absPkgDir, ignorePaths) {
  let count = 0
  await walkDir(
    absPkgDir,
    absPath => {
      if (absPath.endsWith('.vue')) count += 1
    },
    ignorePaths
  )
  return count
}

/**
 * Чи має пакет "стандартний" build — розпізнаваний `vite.config.{js,ts,mjs}` у корені пакета.
 * Канонічний `.storybook/main.js` спирається саме на цей файл (`viteFinal` мерджить його
 * плагіни) — без нього автоматичний скафолд неможливий, і пакет пропускається мовчки
 * (ADR Кластер 1: "skip пакетів із нестандартним build").
 * @param {string} absPkgDir абсолютний шлях кореня пакета
 * @returns {boolean} true, якщо знайдено відомий `vite.config.*`
 */
export function hasStandardBuild(absPkgDir) {
  return VITE_CONFIG_FILES.some(f => existsSync(join(absPkgDir, f)))
}

/**
 * Чи є пакет app-проєктом (не бібліотекою) для хвилі 2: `vue` у `dependencies` (не лише
 * `peerDependencies`) і не бібліотека компонентів. Реалізовано зараз (щоб не переписувати
 * модуль пізніше), але результат впливає на скоуп лише за прапорця `storybook.detectApps`.
 * @param {{ dependencies?: Record<string, unknown>, peerDependencies?: Record<string, unknown> }} pkg розпарсений package.json
 * @returns {boolean} true — app-проєкт (кандидат хвилі 2)
 */
export function isVueAppPkg(pkg) {
  return Boolean(pkg?.dependencies?.vue) && !isVueComponentLibraryPkg(pkg)
}

/**
 * Перевіряє один workspace-корінь на відповідність предикату скоупу (бібліотека чи app) і,
 * за успіху, повертає його `InScopePackage`-запис.
 * @param {string} rootDir відносний корінь пакета
 * @param {string} cwd абсолютний корінь репозиторію
 * @param {(pkg: Record<string, unknown>) => boolean} matches предикат скоупу (бібліотека/app)
 * @param {string[]} ignorePaths абсолютні шляхи, повністю виключені з обходу
 * @returns {Promise<InScopePackage|null>} запис пакета або `null`, якщо поза скоупом
 */
async function evaluateCandidate(rootDir, cwd, matches, ignorePaths) {
  const absDir = rootDir === '.' ? cwd : join(cwd, rootDir)
  const pkgPath = join(absDir, 'package.json')
  if (!existsSync(pkgPath)) return null
  let pkg
  try {
    pkg = JSON.parse(await readFile(pkgPath, 'utf8'))
  } catch {
    return null
  }
  if (!matches(pkg)) return null
  if (!hasStandardBuild(absDir)) return null
  const vueFileCount = await countVueFiles(absDir, ignorePaths)
  if (vueFileCount < VUE_FILE_THRESHOLD) return null
  return { rootDir, absDir, pkg, vueFileCount }
}

/**
 * Збирає workspace-пакети у скоупі канону Storybook хвилі 1: Vue-компонентна бібліотека
 * (`vue` у `peerDependencies`, маркер `isVueComponentLibraryPkg` — той самий, що й `vue.mdc`)
 * з не менше {@link VUE_FILE_THRESHOLD} `.vue`-файлами, без `storybook.optOut`, зі
 * стандартним build (`vite.config.*`). Хвиля 2 (app-проєкти) додається лише за явного
 * прапорця `storybook.detectApps` у `.n-rules.json`.
 * @param {string} cwd абсолютний корінь репозиторію
 * @returns {Promise<InScopePackage[]>} пакети у скоупі
 */
export async function collectInScopeVuePackages(cwd) {
  const roots = await getMonorepoPackageRootDirs(cwd)
  const ignorePaths = await loadCursorIgnorePaths(cwd)
  const optOut = new Set(await readStorybookOptOut(cwd))
  const candidateRoots = roots.filter(r => !optOut.has(r))

  /** @type {InScopePackage[]} */
  const result = []
  for (const rootDir of candidateRoots) {
    const found = await evaluateCandidate(rootDir, cwd, isVueComponentLibraryPkg, ignorePaths)
    if (found) result.push(found)
  }

  if (await readDetectAppsFlag(cwd)) {
    for (const rootDir of candidateRoots) {
      if (result.some(r => r.rootDir === rootDir)) continue
      const absDir = rootDir === '.' ? cwd : join(cwd, rootDir)
      if (!existsSync(join(absDir, 'src/pages'))) continue
      const found = await evaluateCandidate(rootDir, cwd, isVueAppPkg, ignorePaths)
      if (found) result.push(found)
    }
  }

  return result
}

/**
 * Self-check конфігурації: `.n-rules.json` → `storybook.optOut` не має посилатись на
 * неіснуючі workspace-пакети (застаріле налаштування — пакет перейменували/видалили, а
 * opt-out лишився). Сама детекція скоупу (поріг, build, app-проєкти) — pure-функції вище,
 * покриті тестами напряму; тут лише конфіг-гігієна.
 * @param {import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінту
 * @returns {Promise<import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintResult>} результат лінту
 */
export async function lint(ctx) {
  const reporter = createViolationReporter(ctx)
  const cwd = ctx.cwd

  const optOut = await readStorybookOptOut(cwd)
  if (optOut.length === 0) {
    reporter.pass('storybook: storybook.optOut порожній або не заданий')
    return reporter.result()
  }

  const roots = new Set(await getMonorepoPackageRootDirs(cwd))
  for (const rootDir of optOut) {
    if (!roots.has(rootDir)) {
      reporter.fail(
        `.n-rules.json storybook.optOut містить '${rootDir}' — такого workspace-пакета немає (застаріле opt-out, storybook.mdc)`,
        'stale-opt-out'
      )
    }
  }

  return reporter.result()
}

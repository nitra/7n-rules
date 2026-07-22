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

/** Поріг кількості `.vue`-файлів для скоупу канону Storybook (ADR Кластер 1). */
export const VUE_FILE_THRESHOLD = 3

/**
 * @typedef {object} InScopePackage
 * @property {string} rootDir відносний (posix) корінь пакета, `.` для кореня монорепо
 * @property {string} absDir абсолютний шлях кореня пакета
 * @property {Record<string, unknown>} pkg розпарсений `package.json` пакета
 * @property {number} vueFileCount кількість знайдених `.vue`-файлів
 * @property {'library'|'app'} type тип пакета — Vue-компонентна бібліотека (хвиля 1) чи
 *   app-проєкт зі сторінками (хвиля 2a, `storybook.detectApps`); downstream-concern-и
 *   (`scaffold`/`adopt`/page-coverage) розгалужують перевірки за цим полем
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
 * за успіху, повертає його `InScopePackage`-запис (без поля `type` — його проставляє викликач,
 * бо той самий predicate-механізм переюзається для обох типів). Поріг {@link VUE_FILE_THRESHOLD}
 * — опційний: хвиля 2a (app-проєкти) свідомо БЕЗ порога (ADR-розширення, smoke-рівень покриття),
 * на відміну від бібліотек хвилі 1.
 * @param {string} rootDir відносний корінь пакета
 * @param {string} cwd абсолютний корінь репозиторію
 * @param {(pkg: Record<string, unknown>) => boolean} matches предикат скоупу (бібліотека/app)
 * @param {string[]} ignorePaths абсолютні шляхи, повністю виключені з обходу
 * @param {{ requireThreshold?: boolean }} [opts] `requireThreshold` (типово `true`) — вимагати
 *   не менше {@link VUE_FILE_THRESHOLD} `.vue`-файлів; `false` — app-проєкти хвилі 2a
 * @returns {Promise<Omit<InScopePackage, 'type'>|null>} запис пакета (без `type`) або `null`
 */
async function evaluateCandidate(rootDir, cwd, matches, ignorePaths, opts = {}) {
  const { requireThreshold = true } = opts
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
  const vueFileCount = await countVueFiles(absDir, ignorePaths)
  if (requireThreshold && vueFileCount < VUE_FILE_THRESHOLD) return null
  return { rootDir, absDir, pkg, vueFileCount }
}

/**
 * Збирає workspace-пакети у скоупі канону Storybook: Vue-компонентна бібліотека хвилі 1
 * (`vue` у `peerDependencies`, маркер `isVueComponentLibraryPkg` — той самий, що й `vue.mdc`)
 * з не менше {@link VUE_FILE_THRESHOLD} `.vue`-файлами, без `storybook.optOut` — тип `library`.
 * Наявність `vite.config.*` пакета — НЕ умова скоупу (rollout tauri-components/npm, хвиля 1.4):
 * канонічний скафолд (`viteConfigPath` на `empty-vite.config.js`, `loadConfigFromFile`
 * толерує відсутній конфіг) працює й для source-only Vue-бібліотек без власного Vite-білду
 * — див. секцію "Скоуп" у `main.mdc`.
 *
 * Опційно (лише за `storybook.detectApps: true` у `.n-rules.json`) — app-проєкти хвилі 2a:
 * `vue` у `dependencies` (не бібліотека) + наявний `src/pages/` — тип `app`, свідомо
 * **без** порога {@link VUE_FILE_THRESHOLD} (ADR-розширення 2026-07-20: сторінкове покриття —
 * smoke-рівень, поріг відсікав би легітимні app-проєкти з 1-2 сторінками).
 * @param {string} cwd абсолютний корінь репозиторію
 * @returns {Promise<InScopePackage[]>} пакети у скоупі (з полем `type`)
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
    if (found) result.push({ ...found, type: 'library' })
  }

  if (await readDetectAppsFlag(cwd)) {
    for (const rootDir of candidateRoots) {
      if (result.some(r => r.rootDir === rootDir)) continue
      const absDir = rootDir === '.' ? cwd : join(cwd, rootDir)
      if (!existsSync(join(absDir, 'src/pages'))) continue
      const found = await evaluateCandidate(rootDir, cwd, isVueAppPkg, ignorePaths, { requireThreshold: false })
      if (found) result.push({ ...found, type: 'app' })
    }
  }

  return result
}

/**
 * Self-check конфігурації: `.n-rules.json` → `storybook.optOut` не має посилатись на
 * неіснуючі workspace-пакети (застаріле налаштування — пакет перейменували/видалили, а
 * opt-out лишився). Сама детекція скоупу (поріг, app-проєкти) — pure-функції вище,
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

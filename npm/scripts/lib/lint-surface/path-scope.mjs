/**
 * Резолвер explicit-files списку для `n-rules lint --path <dir>`.
 *
 * На відміну від `--cwd` (підміняє корінь прогону — root-guard, `.n-rules.json`,
 * devDependencies), `--path` лишає корінь незмінним і лише звужує файловий
 * набір, передаючи його у `buildPlan` як `explicitFiles` — тим самим шляхом,
 * що вже годує `hook --post-tool-use`/`--stop`.
 *
 * Два режими збору:
 * - `collectPathScopedChangedFiles` (дефолт `--path`) — **перетин** піддерева
 *   з git-дельтою vs merge-base (сервіс-орієнтований CI-канон: перевіряються
 *   лише змінені файли сервісу);
 * - `collectPathScopedFiles` (`--path --full`) — всі файли піддерева, як
 *   історична поведінка `--path` (full-scope concerns при збігу glob ідуть
 *   whole-repo — так поводиться delta-режим).
 */
import { existsSync, statSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'

import { loadCursorIgnorePaths } from '../load-cursor-config.mjs'
import { collectChangedFilesSince, resolveChangedBase } from '../changed-files.mjs'
import { walkDir } from '../../utils/walkDir.mjs'

/**
 * Перевіряє, що резолвлений `--path` лежить усередині `cwd` (не traversal
 * через `..` і не абсолютний шлях поза коренем прогону).
 * @param {string} cwd абсолютний корінь прогону.
 * @param {string} target абсолютний резолв значення `--path`.
 * @returns {void}
 */
function assertWithinCwd(cwd, target) {
  const rel = relative(cwd, target)
  if (rel === '') return
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`--path має вказувати каталог усередині ${cwd} (отримано поза межами: ${target})`)
  }
}

/**
 * Резолвить `--path` в абсолютний шлях і валідує: усередині `cwd`, існує,
 * є каталогом. Спільний вхід обох режимів збору.
 * @param {string} cwd абсолютний корінь прогону.
 * @param {string} pathArg значення `--path` (відносний або абсолютний шлях).
 * @returns {string} абсолютний шлях каталогу.
 */
export function resolveAndAssertPathDir(cwd, pathArg) {
  const target = resolve(cwd, pathArg)
  assertWithinCwd(cwd, target)
  if (!existsSync(target) || !statSync(target).isDirectory()) {
    throw new Error(`--path не є каталогом: ${target}`)
  }
  return target
}

/**
 * Перетин git-дельти (vs merge-base) з піддеревом `--path`: posix-відносні
 * шляхи змінених/untracked файлів під каталогом, мінус `.n-rules.json:ignore`.
 * База не резолвиться (немає main/origin/main або заданого `baseRef`) —
 * `baseResolved: false` без обчислення дельти: caller робить fail-open
 * fallback на повне піддерево (мовчазного скіпу не існує).
 * @param {string} cwd абсолютний корінь прогону (root-guard уже пройдено).
 * @param {string} pathArg значення `--path` (відносний або абсолютний шлях).
 * @param {{ baseRef?: string|null }} [opts] явний ref бази (`--base`).
 * @returns {Promise<{ files: string[], baseResolved: boolean }>} відсортований перетин і статус бази.
 */
export async function collectPathScopedChangedFiles(cwd, pathArg, { baseRef = null } = {}) {
  const target = resolveAndAssertPathDir(cwd, pathArg)
  const base = resolveChangedBase(cwd, baseRef)
  if (base === null) return { files: [], baseResolved: false }
  const changed = collectChangedFilesSince(base, cwd)
  const relDir = relative(cwd, target).split(sep).join('/')
  const prefix = relDir === '' ? '' : `${relDir}/`
  // git уже поважає .gitignore; .n-rules.json:ignore застосовуємо явно (як walkDir).
  const ignorePaths = await loadCursorIgnorePaths(cwd)
  const ignorePrefixes = ignorePaths
    .map(p => relative(cwd, resolve(p)).split(sep).join('/'))
    .filter(rel => rel !== '' && !rel.startsWith('..'))
    .map(rel => `${rel}/`)
  const files = changed.filter(f => f.startsWith(prefix)).filter(f => ignorePrefixes.every(ip => !f.startsWith(ip)))
  return { files: files.toSorted((a, b) => a.localeCompare(b)), baseResolved: true }
}

/**
 * Збирає posix-відносні (від `cwd`) шляхи всіх файлів під `--path`-каталогом,
 * поважаючи `.gitignore` і `.n-rules.json:ignore` кореня. Порожній каталог —
 * валідний порожній результат (план виявиться порожнім), не помилка.
 * @param {string} cwd абсолютний корінь прогону (root-guard уже пройдено).
 * @param {string} pathArg значення `--path` (відносний або абсолютний шлях).
 * @returns {Promise<string[]>} відсортовані posix-відносні шляхи від `cwd`.
 */
export async function collectPathScopedFiles(cwd, pathArg) {
  const target = resolveAndAssertPathDir(cwd, pathArg)
  const ignorePaths = await loadCursorIgnorePaths(cwd)
  /** @type {string[]} */
  const out = []
  await walkDir(
    target,
    abs => {
      out.push(relative(cwd, abs).split(sep).join('/'))
    },
    ignorePaths
  )
  return out.toSorted((a, b) => a.localeCompare(b))
}

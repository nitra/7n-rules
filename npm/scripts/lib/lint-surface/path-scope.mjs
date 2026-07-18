/**
 * Резолвер explicit-files списку для `n-rules lint --path <dir>`.
 *
 * На відміну від `--cwd` (підміняє корінь прогону — root-guard, `.n-rules.json`,
 * devDependencies), `--path` лишає корінь незмінним і лише звужує файловий
 * набір: збирає всі файли під заданою піддиректорією й передає їх у
 * `buildPlan` як `explicitFiles`, тим самим шляхом, що вже годує
 * `hook --post-tool-use`/`--stop` (per-file concerns фільтруються по цих
 * файлах; `full`-scope concerns запускаються при збігу glob, але самі
 * все одно проходять whole-repo — так уже поводиться delta-режим).
 */
import { existsSync, statSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'

import { loadCursorIgnorePaths } from '../load-cursor-config.mjs'
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
 * Збирає posix-відносні (від `cwd`) шляхи всіх файлів під `--path`-каталогом,
 * поважаючи `.gitignore` і `.n-rules.json:ignore` кореня. Порожній каталог —
 * валідний порожній результат (план виявиться порожнім), не помилка.
 * @param {string} cwd абсолютний корінь прогону (root-guard уже пройдено).
 * @param {string} pathArg значення `--path` (відносний або абсолютний шлях).
 * @returns {Promise<string[]>} відсортовані posix-відносні шляхи від `cwd`.
 */
export async function collectPathScopedFiles(cwd, pathArg) {
  const target = resolve(cwd, pathArg)
  assertWithinCwd(cwd, target)
  if (!existsSync(target) || !statSync(target).isDirectory()) {
    throw new Error(`--path не є каталогом: ${target}`)
  }
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

/**
 * Спільна утиліта для check-скриптів: збирає всі `package.json` у дереві (крім пропущених
 * каталогів у `walkDir`), сортує за відносним шляхом. Винесена з check-js-bun-db / check-js-mssql,
 * щоб уникнути дублювання (jscpd).
 */
import { relative, sep } from 'node:path'

import { walkDir } from './walkDir.mjs'

/**
 * Знаходить всі `package.json` у репозиторії (крім пропущених директорій у walkDir).
 * @param {string} repoRoot абсолютний шлях до кореня репозиторію
 * @param {string[]} ignorePaths абсолютні шляхи каталогів, повністю виключених з обходу
 * @returns {Promise<string[]>} абсолютні шляхи, відсортовані за відносним шляхом
 */
export async function findAllPackageJsonPaths(repoRoot, ignorePaths) {
  /** @type {string[]} */
  const paths = []
  await walkDir(
    repoRoot,
    absPath => {
      if (absPath.endsWith(`${sep}package.json`)) {
        paths.push(absPath)
      }
    },
    ignorePaths
  )
  paths.sort((a, b) => relative(repoRoot, a).localeCompare(relative(repoRoot, b)))
  return paths
}

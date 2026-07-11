/**
 * Спільна логіка для `test/no-*`-концернів, що сканують `*.test.{mjs,js}`: визначення
 * тестового файлу й обхід дерева з `.n-cursor.json`-ignore. Виносено з дублювання між
 * `no-bun-test-import` і `no-process-chdir` (jscpd).
 */
import { basename, relative } from 'node:path'

import { loadCursorIgnorePaths } from './load-cursor-config.mjs'
import { walkDir } from '../utils/walkDir.mjs'

/**
 * Чи файл — JS-тест (`*.test.mjs` або `*.test.js`).
 * @param {string} absPath абсолютний шлях
 * @returns {boolean} `true` для імен з `.test.{mjs,js}` суфіксом
 */
export function isTestFile(absPath) {
  const name = basename(absPath)
  return name.endsWith('.test.mjs') || name.endsWith('.test.js')
}

/**
 * Збирає всі `*.test.{mjs,js}` у дереві `cwd`, поважаючи `.n-cursor.json`-ignore.
 * @param {string} cwd абсолютний корінь репозиторію
 * @returns {Promise<string[]>} абсолютні шляхи тестових файлів
 */
export async function collectTestFiles(cwd) {
  const ignorePaths = await loadCursorIgnorePaths(cwd)
  /** @type {string[]} */
  const testFiles = []
  await walkDir(
    cwd,
    absPath => {
      if (isTestFile(absPath)) testFiles.push(absPath)
    },
    ignorePaths
  )
  return testFiles
}

/**
 * posix-відносний шлях файлу від `cwd` (уніфіковано для violation-message).
 * @param {string} cwd абсолютний корінь репозиторію
 * @param {string} absPath абсолютний шлях файлу
 * @returns {string} posix-відносний шлях
 */
export function toRelPosix(cwd, absPath) {
  return relative(cwd, absPath).split('\\').join('/')
}

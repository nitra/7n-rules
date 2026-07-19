/** @see ../docs/collect-test-file-offenders.md */
import { readFile } from 'node:fs/promises'
import { basename, relative } from 'node:path'

import { loadCursorIgnorePaths } from '@7n/rules/scripts/lib/load-cursor-config.mjs'
import { walkDir } from '@7n/rules/scripts/utils/walkDir.mjs'

/**
 * Чи файл — JS-тест (`*.test.mjs` / `*.test.js`).
 * @param {string} absPath абсолютний шлях
 * @returns {boolean} `true` для `.test.{mjs,js}` файлів
 */
export function isTestFile(absPath) {
  const name = basename(absPath)
  return name.endsWith('.test.mjs') || name.endsWith('.test.js')
}

/**
 * Обходить репо (поважаючи `.n-rules.json:ignore`), збирає `*.test.{mjs,js}` файли
 * і прогонить кожен через `findOffenders(body)` — спільний скелет для per-file
 * regex/parse-based test-конвенцій (напр. `no-console-store-restore`, `vitest-api-conventions`).
 * @param {string} cwd корінь репозиторію
 * @param {(body: string) => Array<{line: number}>} findOffenders детектор порушень у тілі файлу
 * @returns {Promise<{ testFiles: string[], offenders: Array<{file: string, line: number}> }>} усі тестові файли й знайдені порушення (з relative-шляхом)
 */
export async function collectTestFileOffenders(cwd, findOffenders) {
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

  /** @type {Array<{file: string, line: number}>} */
  const offenders = []
  for (const absPath of testFiles) {
    const body = await readFile(absPath, 'utf8')
    for (const o of findOffenders(body)) {
      offenders.push({ file: relative(cwd, absPath), ...o })
    }
  }

  return { testFiles, offenders }
}

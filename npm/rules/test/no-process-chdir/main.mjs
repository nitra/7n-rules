/** @see ./docs/no-process-chdir.md */
import { readFile } from 'node:fs/promises'
import { basename, relative } from 'node:path'

import { createCheckReporter } from '../../../scripts/lib/check-reporter.mjs'
import { loadCursorIgnorePaths } from '../../../scripts/lib/load-cursor-config.mjs'
import { walkDir } from '../../../scripts/utils/walkDir.mjs'

/** Шукаємо викликний паттерн з відкривною дужкою — не зачепить згадку у docstring. */
const CHDIR_CALL_RE = /process\.chdir\s*\(/u

/**
 * Чи файл — JS-тест (`*.test.mjs` або `*.test.js`).
 * @param {string} absPath абсолютний шлях
 * @returns {boolean} `true` для імен з `.test.{mjs,js}` суфіксом
 */
function isTestFile(absPath) {
  const name = basename(absPath)
  return name.endsWith('.test.mjs') || name.endsWith('.test.js')
}

/**
 * Перевіряє, що жоден `*.test.{mjs,js}` файл не викликає `process.chdir(`.
 * @param {string} [cwdParam] корінь репозиторію
 * @returns {Promise<number>} 0 — чисто, 1 — знайдено `process.chdir(` у тесті
 */
export async function main(cwdParam = process.cwd()) {
  const reporter = createCheckReporter()
  const { pass, fail } = reporter

  const cwd = cwdParam
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
    if (!CHDIR_CALL_RE.test(body)) continue
    const lines = body.split('\n')
    for (const [i, line] of lines.entries()) {
      if (CHDIR_CALL_RE.test(line)) {
        offenders.push({ file: relative(cwd, absPath), line: i + 1 })
      }
    }
  }

  if (offenders.length === 0) {
    pass(`Жоден з ${testFiles.length} тестових файлів не викликає process.chdir() (test.mdc)`)
    return reporter.getExitCode()
  }

  for (const { file, line } of offenders) {
    fail(
      `${file}:${line}: process.chdir() у тесті заборонений — використовуй withTmpDir(async dir => …) + явні join(dir, …) + cwd: dir (test.mdc)`
    )
  }

  return reporter.getExitCode()
}

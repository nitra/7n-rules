/** @see ./docs/no-console-store-restore.md */
import { readFile } from 'node:fs/promises'
import { basename, relative } from 'node:path'

import { createCheckReporter } from '../../../scripts/lib/check-reporter.mjs'
import { loadCursorIgnorePaths } from '../../../scripts/lib/load-cursor-config.mjs'
import { walkDir } from '../../../scripts/utils/walkDir.mjs'

/**
 * Ловить пряме присвоєння `console.<method> = …` у `*.test.{js,mjs}`.
 * `console.log = fn` — process-wide мутація; канон: `vi.spyOn(console, 'log')`.
 * `(?!=)` виключає `==` та `===` (лише одиночний `=`).
 */
const CONSOLE_ASSIGN_RE =
  /\bconsole\.(?:log|error|warn|info|debug|dir|table|trace|group|groupEnd|time|timeEnd)\s*=(?!=)/u

/**
 * Чи файл — JS-тест (`*.test.mjs` / `*.test.js`).
 * @param {string} absPath абсолютний шлях
 * @returns {boolean} `true` для `.test.{mjs,js}` файлів
 */
function isTestFile(absPath) {
  const name = basename(absPath)
  return name.endsWith('.test.mjs') || name.endsWith('.test.js')
}

/**
 * Знаходить рядки з прямим присвоєнням `console.<method> = …`.
 * @param {string} body вміст файлу
 * @returns {Array<{line: number}>} знайдені порушення
 */
function findOffenders(body) {
  const offenders = []
  const lines = body.split('\n')
  for (const [i, line] of lines.entries()) {
    if (CONSOLE_ASSIGN_RE.test(line)) {
      offenders.push({ line: i + 1 })
    }
  }
  return offenders
}

/**
 * Перевіряє, що жоден `*.test.{mjs,js}` файл не перевизначає `console.<method>`
 * через пряме присвоєння. Канон — `vi.spyOn(console, 'log').mockReturnValue()`.
 * @param {string} [cwdParam] корінь репозиторію
 * @returns {Promise<number>} 0 — чисто, 1 — є порушення
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
    for (const o of findOffenders(body)) {
      offenders.push({ file: relative(cwd, absPath), ...o })
    }
  }

  if (offenders.length === 0) {
    pass(`Жоден з ${testFiles.length} тестових файлів не присвоює console.<method> = … (test.mdc)`)
    return reporter.getExitCode()
  }

  for (const { file, line } of offenders) {
    fail(
      `${file}:${line}: пряме присвоєння console.<method> = … заборонено — ` +
        `використовуй vi.spyOn(console, 'method').mockReturnValue() (test.mdc, no-console-store-restore)`
    )
  }

  return reporter.getExitCode()
}

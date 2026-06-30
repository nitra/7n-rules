/** @see ./docs/fix-eslint.md */

/**
 * T0-autofix для `js/eslint` — детермінований прогін лінтерів у fix-режимі
 * (`oxlint --fix` + `eslint --fix`) на файлах, де детектор знайшов порушення.
 * Виправляє лише авто-fixable правила; решта лишається детектору на re-check
 * (далі — LLM-ладдер). Запис permanent (поза rollback).
 *
 * Межа CI: цей модуль — частина fix-фази (`lint` без `--read-only`); сам по собі
 * detector-шлях його не вантажить. У CI (`--read-only`) fix не запускається —
 * узгоджено із забороною `oxlint --fix`/`eslint --fix` у CI (js.mdc / lint_js_yml).
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { ESLint } from 'eslint'

import { filterJsFiles } from './main.mjs'

/**
 * Вміст файлу або null, якщо не читається (видалений/недоступний).
 * @param {string} abs абсолютний шлях
 * @returns {string|null} вміст або null
 */
function readOrNull(abs) {
  try {
    return readFileSync(abs, 'utf8')
  } catch {
    return null
  }
}

/**
 * Прогін `oxlint --fix` + `eslint --fix` по списку js-файлів. Повертає абсолютні
 * шляхи фактично змінених файлів (порівняння до/після).
 * @param {string[]} jsFiles posix-relative js-файли
 * @param {string} cwd корінь проєкту
 * @returns {Promise<string[]>} абсолютні шляхи змінених файлів
 */
async function runLinterFix(jsFiles, cwd) {
  const abs = jsFiles.map(f => resolve(cwd, f))
  const before = new Map(abs.map(a => [a, readOrNull(a)]))

  // oxlint --fix (CLI): авто-fixable oxc-правила.
  spawnSync('bunx', ['oxlint', '--fix', ...jsFiles], { cwd, encoding: 'utf8' })

  // eslint --fix (API): outputFixes пише виправлені файли на диск.
  const eslint = new ESLint({ cwd, fix: true })
  const results = await eslint.lintFiles(abs)
  await ESLint.outputFixes(results)

  /** @type {string[]} */
  const touched = []
  for (const a of abs) {
    if (readOrNull(a) !== before.get(a)) touched.push(a)
  }
  return touched
}

/** @type {import('../../../scripts/lib/lint-surface/types.mjs').T0Pattern[]} */
export const patterns = [
  {
    id: 'js-eslint-autofix',
    test: violations => violations.some(v => v.file),
    apply: async (violations, ctx) => {
      const files = [...new Set(violations.map(v => v.file).filter(Boolean))]
      const jsFiles = filterJsFiles(files)
      if (jsFiles.length === 0) return { touchedFiles: [] }
      const touchedFiles = await runLinterFix(jsFiles, ctx.cwd)
      for (const a of touchedFiles) ctx.recordWrite?.(a)
      return touchedFiles.length > 0
        ? { touchedFiles, message: `oxlint/eslint --fix: ${touchedFiles.length} файл(ів)` }
        : { touchedFiles: [] }
    }
  }
]

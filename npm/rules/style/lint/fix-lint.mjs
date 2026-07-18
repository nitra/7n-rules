/** @see ./docs/fix-lint.md */

/**
 * T0-autofix для `style/lint` — детермінований прогін `stylelint --fix` по css/scss/vue.
 * Детектор емітить агрегований `stylelint-violation` без переліку файлів, тож фіксер
 * самостійно перелічує цільові файли (ctx.files у дельті або tracked css/scss/vue у повному
 * режимі), форматує їх і повертає лише фактично змінені. Запис permanent. Відсутній
 * stylelint → no-op.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { filterStyleFiles, resolveStylelint } from './main.mjs'
import { spawnAsync } from '../../../scripts/utils/spawn-async.mjs'

/**
 * Вміст файлу або null, якщо не читається.
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
 * Перелік цільових style-файлів: у дельті — з ctx.files; у повному режимі — tracked
 * css/scss/vue через `git ls-files`.
 * @param {string} cwd корінь
 * @param {string[]|undefined} ctxFiles файли з контексту (дельта) або undefined (повний режим)
 * @returns {Promise<string[]>} posix-relative шляхи
 */
async function listStyleFiles(cwd, ctxFiles) {
  if (ctxFiles !== undefined) return filterStyleFiles(ctxFiles)
  const r = await spawnAsync('git', ['ls-files', '-z', '--', '*.css', '*.scss', '*.vue'], { cwd })
  if (r.exitCode !== 0) return []
  return (r.stdout ?? '').split('\0').filter(Boolean)
}

/** @type {import('../../../scripts/lib/lint-surface/types.mjs').T0Pattern[]} */
export const patterns = [
  {
    id: 'style-stylelint-fix',
    standalone: true, // §8 Phase 2: apply бере ctx.files (не violations), stylelint --fix сам ре-аналізує
    test: violations => violations.some(v => v.reason === 'stylelint-violation'),
    apply: async (violations, ctx) => {
      const stylelint = resolveStylelint(ctx.cwd)
      if (!stylelint) return { touchedFiles: [] }
      const files = await listStyleFiles(ctx.cwd, ctx.files)
      if (files.length === 0) return { touchedFiles: [] }

      const abs = files.map(f => resolve(ctx.cwd, f))
      const before = new Map(abs.map(a => [a, readOrNull(a)]))
      await spawnAsync(stylelint, ['--fix', ...files], { cwd: ctx.cwd })

      const touchedFiles = abs.filter(a => readOrNull(a) !== before.get(a))
      for (const a of touchedFiles) ctx.recordWrite?.(a)
      return touchedFiles.length > 0
        ? { touchedFiles, message: `stylelint --fix: ${touchedFiles.length} файл(ів)` }
        : { touchedFiles: [] }
    }
  }
]

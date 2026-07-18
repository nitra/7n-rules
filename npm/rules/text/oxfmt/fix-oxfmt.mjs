/** @see ./docs/fix-oxfmt.md */

/**
 * T0-autofix для `text/oxfmt` — детерміноване форматування неформатованих файлів через
 * `oxfmt --write` (конфіг `.oxfmtrc.json`). Виправляє рівно ті файли, які detector позначив
 * (`data.kind === 'oxfmt-unformatted'`); re-detect підтверджує результат. Запис permanent.
 * Тул відсутній у PATH → no-op.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { resolveCmd } from '../../../scripts/utils/resolve-cmd.mjs'
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

/** @type {import('../../../scripts/lib/lint-surface/types.mjs').T0Pattern[]} */
export const patterns = [
  {
    id: 'text-oxfmt-write',
    test: violations => violations.some(v => v.data?.kind === 'oxfmt-unformatted' && v.file),
    apply: async (violations, ctx) => {
      const oxfmt = resolveCmd('oxfmt')
      if (!oxfmt) return { touchedFiles: [] }
      const files = [
        ...new Set(violations.filter(v => v.data?.kind === 'oxfmt-unformatted' && v.file).map(v => v.file))
      ]
      if (files.length === 0) return { touchedFiles: [] }

      const abs = files.map(f => resolve(ctx.cwd, f))
      const before = new Map(abs.map(a => [a, readOrNull(a)]))
      await spawnAsync(oxfmt, ['--write', ...files], { cwd: ctx.cwd })

      const touchedFiles = abs.filter(a => readOrNull(a) !== before.get(a))
      for (const a of touchedFiles) ctx.recordWrite?.(a)
      return touchedFiles.length > 0
        ? { touchedFiles, message: `oxfmt --write: ${touchedFiles.length} файл(ів)` }
        : { touchedFiles: [] }
    }
  }
]

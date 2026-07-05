/** @see ./docs/fix-migrations.md */

/**
 * T0-autofix для `hasura/migrations` — детерміноване видалення заборонених `down.sql`
 * у `hasura/migrations/**` (у проєкті використовується лише `up.sql`, `down.sql` зайвий).
 */
import { unlink } from 'node:fs/promises'
import { join } from 'node:path'

/** @type {import('../../../scripts/lib/lint-surface/types.mjs').T0Pattern[]} */
export const patterns = [
  {
    id: 'hasura-migrations-remove-down-sql',
    test: violations => violations.some(v => v.reason === 'down-sql-forbidden'),
    apply: async (violations, ctx) => {
      const files = [...new Set(violations.filter(v => v.reason === 'down-sql-forbidden' && v.file).map(v => v.file))]

      const touchedFiles = []
      for (const rel of files) {
        const absPath = join(ctx.cwd, rel)
        try {
          await unlink(absPath)
        } catch {
          continue
        }
        ctx.recordWrite?.(absPath)
        touchedFiles.push(absPath)
      }

      return touchedFiles.length > 0
        ? { touchedFiles, message: `down.sql видалено: ${touchedFiles.length} файл(ів)` }
        : { touchedFiles: [] }
    }
  }
]

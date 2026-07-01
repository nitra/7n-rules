/**
 * T0-autofix doc-files/check — детермінований CRC-stamp для `crc-mismatch` доків
 * (джерело змінилось, але дока актуальна → лише оновити CRC у frontmatter, без LLM).
 * `missing`/`degraded`/`orphaned-doc` лишаються worker-у (генерація/очистка).
 *
 * Unified lint surface: structured violations; запускається ПЕРЕД fix-worker-ом.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'

/** @type {import('../../../scripts/lib/lint-surface/types.mjs').T0Pattern[]} */
export const patterns = [
  {
    id: 'doc-files-stamp-crc',
    test: violations => violations.some(v => v.reason === 'crc-mismatch'),
    apply: async (violations, ctx) => {
      const { scanForDocFiles } = await import('../docgen-scan/main.mjs')
      const { crc32, readDocModel, readDocQuality, stampDoc } = await import('../docgen-crc/main.mjs')
      const { cwd } = ctx
      /** @type {string[]} */
      const touchedFiles = []

      const staleFiles = scanForDocFiles(cwd).filter(f => f.stale && f.reason === 'crc-mismatch')
      for (const file of staleFiles) {
        const sourceAbs = join(cwd, file.sourcePath)
        const docAbs = join(cwd, file.docPath)
        if (!existsSync(docAbs)) continue // missing → worker, не T0
        const { score, issues, judgeModel } = readDocQuality(docAbs)
        const quality = score === null ? null : { score, issues, judge: judgeModel ? { model: judgeModel } : undefined }
        const crc = crc32(readFileSync(sourceAbs))
        ctx.recordWrite?.(docAbs)
        mkdirSync(dirname(docAbs), { recursive: true })
        writeFileSync(
          docAbs,
          stampDoc(readFileSync(docAbs, 'utf8'), file.sourcePath, crc, quality, readDocModel(docAbs))
        )
        touchedFiles.push(docAbs)
      }

      return touchedFiles.length > 0
        ? { touchedFiles, message: `stamped CRC: ${touchedFiles.length} доки(ів)` }
        : { touchedFiles: [] }
    }
  }
]

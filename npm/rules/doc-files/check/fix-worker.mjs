/**
 * fix-worker doc-files/check (unified lint surface): генерує застарілі/відсутні файлові
 * доки локальною/хмарною моделлю (docgen-pipeline) і чистить сирітські доки.
 *
 * Один attempt одного rung-а — tier/model беруться з ctx, success визначає canonical
 * re-detect runner-а. Central rollback: pre-image кожної доки реєструється через
 * ctx.recordWrite ДО запису/видалення.
 *
 * @typedef {import('../../../scripts/lib/lint-surface/types.mjs').FixWorkerFn} FixWorkerFn
 */
import { join } from 'node:path'

/** @type {FixWorkerFn} */
export async function fixWorker(violations, ctx) {
  const { cwd } = ctx
  const { scanForDocFiles } = await import('../docgen-scan/main.mjs')
  const { runGenerationBatch, purgeOrphanedDocs } = await import('../docgen-files-batch/main.mjs')

  /** @type {string[]} */
  const touchedFiles = []

  // Re-scan дає повні target-обʼєкти {sourcePath, docPath, reason, …}, що їх потребує
  // runGenerationBatch (violation несе лише file+docPath).
  const stale = scanForDocFiles(cwd).filter(f => f.stale)
  if (stale.length > 0) {
    for (const f of stale) {
      const docAbs = join(cwd, f.docPath)
      ctx.recordWrite?.(docAbs)
      touchedFiles.push(docAbs)
    }
    await runGenerationBatch(stale, cwd, {
      headline: `📄 doc-files: генерація ${stale.length} доки(ів)`,
      model: ctx.model,
      tier: ctx.tier
    })
  }

  // Сирітські доки (source видалено) — записати pre-image для rollback, тоді purge.
  const orphans = violations.filter(v => v.reason === 'orphaned-doc')
  if (orphans.length > 0) {
    for (const v of orphans) if (v.file) ctx.recordWrite?.(join(cwd, v.file))
    purgeOrphanedDocs(cwd)
  }

  return { touchedFiles }
}

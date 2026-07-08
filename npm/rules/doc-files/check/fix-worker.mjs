/**
 * fix-worker doc-files/check (unified lint surface): генерує застарілі/відсутні файлові
 * доки локальною/хмарною моделлю (docgen-pipeline) і чистить сирітські доки.
 *
 * Один attempt одного rung-а — tier/model беруться з ctx, success визначає canonical
 * re-detect runner-а. Доки реєструються durable (`ctx.recordDurableWrite`): кожна
 * записана дока — самодостатній кінцевий стан зі свіжим CRC (degraded теж валідна),
 * тож rollback провального rung-а її не стирає, і великий беклог сходиться
 * крок за кроком за кілька прогонів. Видалення сирітських док лишається під
 * звичайним rollback (ctx.recordWrite).
 * @typedef {import('../../../scripts/lib/lint-surface/types.mjs').FixWorkerFn} FixWorkerFn
 */
import { join } from 'node:path'

/** Частка ctx.timeoutMs, після якої батч не стартує наступний файл (запас до backstop ×1.25). */
const DEADLINE_FRACTION = 0.8

/** @type {FixWorkerFn} */
export async function fixWorker(violations, ctx) {
  const { cwd } = ctx
  const { scanForDocFiles } = await import('../docgen-scan/main.mjs')
  const { runGenerationBatch, purgeOrphanedDocs } = await import('../docgen-files-batch/main.mjs')

  /** @type {string[]} */
  const touchedFiles = []
  const recordDoc = ctx.recordDurableWrite ?? ctx.recordWrite

  // Re-scan дає повні target-обʼєкти {sourcePath, docPath, reason, …}, що їх потребує
  // runGenerationBatch (violation несе лише file+docPath).
  const stale = scanForDocFiles(cwd).filter(f => f.stale)
  if (stale.length > 0) {
    for (const f of stale) {
      const docAbs = join(cwd, f.docPath)
      recordDoc?.(docAbs)
      touchedFiles.push(docAbs)
    }
    // Deadline: батч сам зупиняється до backstop-таймауту рунга (fix timeout ×1.25) —
    // повертає часткову роботу штатно, замість фонового батчу-зомбі поверх наступного rung-а.
    const deadlineAt = ctx.timeoutMs ? Date.now() + Math.round(ctx.timeoutMs * DEADLINE_FRACTION) : null
    await runGenerationBatch(stale, cwd, {
      headline: `📄 doc-files: генерація ${stale.length} доки(ів)`,
      model: ctx.model,
      tier: ctx.tier,
      deadlineAt
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

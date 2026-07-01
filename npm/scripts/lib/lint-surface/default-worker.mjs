/**
 * Дефолтний LLM fix-worker unified lint surface: адаптер `runPiAgentFix` під контракт
 * `fixWorker(violations, ctx) → { touchedFiles, telemetry? }`. Використовується central
 * pipeline-ом, коли у concern-а немає власного `fix-worker.mjs`.
 *
 * Central rollback: pi write-guard міст через `onCapture = ctx.recordWrite` (pre-image
 * у central snapshot ДО запису), тож rollback rung-а відкочує і LLM-правки. Worker —
 * один attempt; success визначає canonical re-detect runner-а, не сам worker.
 * @typedef {import('./types.mjs').FixWorkerFn} FixWorkerFn
 */
import { renderViolations } from './render.mjs'

/** @type {FixWorkerFn} */
export async function fixWorker(violations, ctx) {
  // lazy import — тримає detect-шлях вільним від pi (read-only --no-fix не вантажить pi).
  const { runPiAgentFix } = await import('../../../lib/pi-agent-fix.mjs')
  const violationText = renderViolations(violations)
  const res = await runPiAgentFix(ctx.ruleId, violationText, ctx.cwd, {
    model: ctx.model,
    tier: ctx.tier,
    feedback: ctx.feedback ?? null,
    caller: `fix:${ctx.ruleId}/${ctx.concernId}:${ctx.tier}`,
    recordWrite: ctx.recordWrite
  })
  if (res.error) throw new Error(res.error)
  return { touchedFiles: res.touchedFiles ?? [], telemetry: res.telemetry ?? undefined }
}

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
import { resolve } from 'node:path'

import { renderViolations } from './render.mjs'

/** @type {FixWorkerFn} */
export async function fixWorker(violations, ctx) {
  // lazy import — тримає detect-шлях вільним від pi/oxc (read-only --no-fix не вантажить їх).
  const [{ runAgentFix }, { extractContext }] = await Promise.all([
    import('@7n/llm-lib/agent-fix'),
    import('../../utils/ast-extract.mjs')
  ])
  const violationText = renderViolations(violations)
  // Target-set порушення → явний перелік у промпті (semantic-collateral guard §12,
  // addendum 2026-07-05); verdict-veto runner-а звіряє фактичні правки з тим самим набором.
  const targetFiles = [...new Set(violations.map(v => v.file).filter(Boolean))]
  const res = await runAgentFix(ctx.ruleId, violationText, ctx.cwd, {
    model: ctx.model,
    tier: ctx.tier,
    // Per-tier таймаут rung-а (ADR 260620-0556): без нього withTimeout у runAgentFix
    // не влаштовує гонки і зависла cloud-SSE тримає весь lint (спостережено 1г41хв).
    timeoutMs: ctx.timeoutMs,
    feedback: ctx.feedback ?? null,
    caller: `fix:${ctx.ruleId}/${ctx.concernId}:${ctx.tier}`,
    recordWrite: ctx.recordWrite,
    // Ланцюжок concern-а (fix-драбина) — рунг стає кроком ланцюжка.
    chain: ctx.chain ?? null,
    targetFiles,
    // n-cursor-специфічний AST-екстрактор (oxc) — пакет цього дефолту не має.
    deps: { astContext: p => extractContext(resolve(ctx.cwd, p)) }
  })
  if (res.error) throw new Error(res.error)
  return { touchedFiles: res.touchedFiles ?? [], telemetry: res.telemetry ?? undefined }
}

/**
 * fix-worker для `js/eslint`: окрема агентна сесія НА ФАЙЛ замість одного великого промпту
 * на всі файли concern-а одразу. Дефолтний worker (`default-worker.mjs`) шле ВСІ порушення
 * з УСІХ файлів в один `runAgentFix`-виклик — на реальних lint-прогонах (tauri-components)
 * це давало 100% timeout на всіх 4 rung-ах драбини (local-min→cloud-avg), навіть коли
 * порушень було лише 20-90 у 1-3 файлах: одна сесія жонглює кількома файлами одразу і не
 * встигає в rung-таймаут. Виміряно (2026-07-17, ручний timing-експеримент поза pipeline):
 * одна сесія, scoped на ОДИН найважчий файл (21 порушення), закрила 76% (16/21) за 91с із
 * бюджету 120с (cloud-min) — per-file scoping вкладається, mega-prompt — ні.
 *
 * Rollback-контракт незмінний: `recordWrite` (не durable) на кожен файл — правки наявного
 * стороннього коду. Якщо після worker-а `runRung`-ів canonical re-detect (whole-concern)
 * знайде хоч одне порушення будь-де, увесь rung однаково відкотиться (S1) — той самий
 * контракт, що й у дефолтного worker-а; батчинг підвищує ймовірність, що ЦЕЙ rung дійде
 * до 0 порушень, а не замінює rollback-семантику.
 *
 * Дедлайн (`DEADLINE_FRACTION` від `ctx.timeoutMs`, той самий підхід, що й
 * `doc-files/check/fix-worker.mjs`): цикл не стартує наступний файл, якщо дедлайн
 * настав — worker повертає часткову роботу штатно, замість фонової сесії, що триває
 * поверх backstop ×1.25 runner-а. Кожен файл отримує РЕШТУ бюджету до дедлайну (не
 * фіксований `timeoutMs / files.length`) — перший (часто найважчий) файл отримує
 * найбільше часу, а не штучно урізаний рівний шматок.
 * @typedef {import('../../../scripts/lib/lint-surface/types.mjs').FixWorkerFn} FixWorkerFn
 */
import { resolve } from 'node:path'

import { anchoredEnabled } from '../../../scripts/lib/lint-surface/default-worker.mjs'
import { renderViolations } from '../../../scripts/lib/lint-surface/render.mjs'
import { lint } from './main.mjs'

/** Частка ctx.timeoutMs, після якої цикл не стартує наступний файл (запас до backstop ×1.25). */
const DEADLINE_FRACTION = 0.8

/**
 * Item-scoped (один файл) canonical re-detect для evidence-гейта `runAgentFix` —
 * НЕ те саме, що whole-concern `ctx.verify` з `runRung` (той перевірив би ВСІ файли
 * concern-а й дав би хибний "не готово" навіть коли саме ЦЕЙ файл уже чистий).
 * @param {string} cwd абсолютний корінь проєкту
 * @param {string} ruleId id правила
 * @param {string} concernId id concern-а
 * @param {string} file posix-relative шлях файлу, що перевіряється
 * @returns {Promise<{ ok: boolean, output: string }>} вердикт verify-петлі
 */
async function verifyFile(cwd, ruleId, concernId, file) {
  const { violations: after } = await lint({ cwd, ruleId, concernId, files: [file] })
  const stamped = after.map(v => ({ ...v, ruleId, concernId }))
  return { ok: stamped.length === 0, output: renderViolations(stamped) }
}

/** @type {FixWorkerFn} */
export async function fixWorker(violations, ctx) {
  // lazy import — тримає detect-шлях вільним від pi/oxc (read-only --no-fix не вантажить їх).
  const [{ runAgentFix }, { isLocalModel }, { extractContext }] = await Promise.all([
    import('@7n/llm-lib/agent-fix'),
    import('@7n/llm-lib/model-tiers'),
    import('../../../scripts/utils/ast-extract.mjs')
  ])

  /** @type {Map<string, import('../../../scripts/lib/lint-surface/types.mjs').LintViolation[]>} */
  const byFile = new Map()
  for (const v of violations) {
    if (!v.file) continue
    const arr = byFile.get(v.file)
    if (arr) arr.push(v)
    else byFile.set(v.file, [v])
  }
  const files = byFile.keys().toArray()
  if (files.length === 0) return { touchedFiles: [] }

  const deadlineAt = ctx.timeoutMs ? Date.now() + Math.round(ctx.timeoutMs * DEADLINE_FRACTION) : null
  const anchoredEdits = anchoredEnabled(ctx.model, isLocalModel)

  const touchedFiles = []
  for (const file of files) {
    if (deadlineAt && Date.now() >= deadlineAt) break
    const callTimeoutMs = deadlineAt ? Math.max(1000, deadlineAt - Date.now()) : ctx.timeoutMs

    const res = await runAgentFix(ctx.ruleId, renderViolations(byFile.get(file)), ctx.cwd, {
      model: ctx.model,
      tier: ctx.tier,
      timeoutMs: callTimeoutMs,
      feedback: ctx.feedback ?? null,
      caller: `fix:${ctx.ruleId}/${ctx.concernId}:${ctx.tier}:${file}`,
      recordWrite: ctx.recordWrite,
      chain: ctx.chain ?? null,
      targetFiles: [file],
      verify: () => verifyFile(ctx.cwd, ctx.ruleId, ctx.concernId, file),
      verifyMax: ctx.verifyMax,
      anchoredEdits,
      deps: { astContext: p => extractContext(resolve(ctx.cwd, p)) }
    })

    // Один файл не впорався — не кидаємо, пробуємо решту в межах дедлайну; whole-concern
    // canonical re-detect runner-а (не цей worker) визначить, чи rung закрито.
    if (!res.error) touchedFiles.push(...(res.touchedFiles ?? []))
  }

  return { touchedFiles }
}

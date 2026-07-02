/**
 * fix-worker для `text/cspell-fix` (spec docs/specs/2026-06-29-unified-lint-surface.md §"fix-worker.mjs"):
 * cspell не має нативного `--fix`, класифікує "Unknown word" знахідки через omlx (bounded JSON) і
 * дописує валідні слова у `.cspell.json#words` — та сама логіка, що раніше жила inline в
 * `runCspellText`/`text/check`. Одруки НЕ виправляються авто (апплай небезпечний).
 *
 * Контракт: worker не знає tier ladder і не вирішує success — це робить canonical `lint()` re-check
 * після worker-а (Central Runner Pipeline). Поточна реалізація використовує єдину локальну модель
 * (`N_LOCAL_MIN_MODEL`) незалежно від `ctx.tier`/`ctx.model` — повноцінна tier-aware маршрутизація
 * (cloud-tier fallback для класифікації) лишається за межами цього кроку (§8 Phase 2 у спеці).
 */
import { join } from 'node:path'

import { resolveCmd } from '../../../scripts/utils/resolve-cmd.mjs'
import { runOneShot } from '../../../lib/pi-one-shot.mjs'
import {
  MAX_CLASSIFY_WORDS,
  appendWordsToDict,
  classifyPrompt,
  detectCspell,
  fixModel,
  parseClassify,
  unknownWords
} from './main.mjs'

/**
 * @typedef {import('../../../scripts/lib/lint-surface/types.mjs').LintViolation} LintViolation
 * @typedef {import('../../../scripts/lib/lint-surface/types.mjs').FixContext} FixContext
 */

/**
 * @param {LintViolation[]} violations concern-scoped violations (лише `text/cspell-fix`).
 * @param {FixContext} ctx контекст одного fix-attempt-у.
 * @returns {Promise<{ touchedFiles: string[], telemetry?: object }>} torched files (`.cspell.json`, якщо дописано слова) + телеметрія.
 */
export async function fixWorker(violations, ctx) {
  const model = ctx.model || fixModel()
  if (!model) return { touchedFiles: [] }

  const bin = resolveCmd('npx')
  if (!bin) return { touchedFiles: [] }

  const first = detectCspell(ctx.cwd, bin, ctx.files)
  if (first.code === 0) return { touchedFiles: [] }

  const words = unknownWords(first.out)
  const batch = words.slice(0, MAX_CLASSIFY_WORDS)
  if (batch.length === 0) return { touchedFiles: [] }

  const res = await runOneShot({
    messages: [{ role: 'user', content: classifyPrompt(batch) }],
    modelSpec: model,
    caller: 'cspell-classify',
    cwd: ctx.cwd,
    signal: ctx.signal
  })
  if (res.error) return { touchedFiles: [] }

  const parsed = parseClassify(res.content)
  if (!parsed) return { touchedFiles: [] }

  const valid = parsed.filter(x => x.verdict === 'valid' && typeof x.w === 'string').map(x => x.w)
  const typos = parsed.filter(x => x.verdict === 'typo' && typeof x.w === 'string')
  const added = appendWordsToDict(ctx.cwd, valid)

  const touchedFiles = added > 0 ? [join(ctx.cwd, '.cspell.json')] : []
  for (const a of touchedFiles) ctx.recordWrite?.(a)

  return {
    touchedFiles,
    telemetry: { classified: batch.length, added, typos: typos.length, truncated: words.length > batch.length }
  }
}

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
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveModel } from '@7n/llm-lib/model-tiers'

import { resolveCmd } from '../../../scripts/utils/resolve-cmd.mjs'
import { spawnAsync } from '../../../scripts/utils/spawn-async.mjs'
import { runOneShot } from '@7n/llm-lib/one-shot'

/** Знахідка cspell: `Unknown word (слово)`. */
const UNKNOWN_WORD_RE = /Unknown word \(([^)]+)\)/u
const FILES_CHECKED_RE = /Files checked:\s*(\d+)/u
/** Максимум distinct-слів під класифікацію за прогін (без тихого обрізання — логуємо надлишок). */
export const MAX_CLASSIFY_WORDS = 80

/**
 * Preferred fix-модель з universal fallback від local-min до cloud-max.
 * @returns {string} ідентифікатор моделі або порожній рядок.
 */
export const fixModel = () => resolveModel('min')

/**
 * Запускає `cspell` над `files` (delta) або над `.` (full), захоплюючи вивід. Скоуп файлів, які
 * cspell реально перевіряє, і так визначає сам `.cspell.json` (globs/ignorePaths) — переданий
 * `files` лише звужує аргументи CLI, не дублює цю логіку. Без `verbose` вимикає власний
 * per-file прогрес-репортер cspell (`--no-progress`), щоб не засмічувати `lint --full`; підсумковий
 * рядок (`--no-summary` НЕ передається) лишається — з нього парситься `FILES_CHECKED_RE`.
 * @param {string} cwd корінь
 * @param {string} bin шлях до cspell (npx/локальний)
 * Async (не блокує event loop) — детектор може виконуватись у parallel lane `detectAll()`
 * (ADR 260716-1354).
 * @param {string[]} [files] явний перелік файлів (delta); без нього — `cspell .`
 * @param {boolean} [verbose] показати повний нативний вивід cspell (включно з прогресом)
 * @returns {Promise<{ code:number, out:string }>} код + обʼєднаний stdout/stderr
 */
export async function detectCspell(cwd, bin, files, verbose = false) {
  const targets = files === undefined ? ['.'] : files
  const quietArgs = verbose ? [] : ['--no-progress']
  const r = await spawnAsync(bin, ['cspell', ...quietArgs, ...targets], { cwd, env: process.env })
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
  const code = typeof r.exitCode === 'number' ? r.exitCode : 1
  // cspell повертає !=0 і коли жоден переданий файл не пройшов ignorePaths
  // (`.cspell.json`) — «Files checked: 0» означає «нічого перевіряти», не порушення.
  const checked = FILES_CHECKED_RE.exec(out)
  if (checked && Number(checked[1]) === 0) return { code: 0, out }
  return { code, out }
}

/**
 * Унікальні «Unknown word» зі stdout cspell.
 * @param {string} out вивід cspell
 * @returns {string[]} distinct-слова у порядку першої появи
 */
export function unknownWords(out) {
  const set = new Set()
  for (const line of out.split('\n')) {
    const m = UNKNOWN_WORD_RE.exec(line)
    if (m) set.add(m[1])
  }
  return [...set]
}

/**
 * Промпт класифікації: для укр+тех-репо bias у «valid» (додати валідне слово безпечно,
 * «виправити» валідне — шкода). Вихід bounded — JSON-масив вердиктів.
 * @param {string[]} words distinct-слова
 * @returns {string} prompt
 */
export function classifyPrompt(words) {
  return [
    'You triage cspell "unknown word" findings for a Ukrainian + technical codebase.',
    'For each word decide:',
    '- "valid": correct technical term, identifier, abbreviation, transliteration, jargon, or intentional Ukrainian word → dictionary candidate.',
    '- "typo": a genuine misspelling of a real word.',
    'Default to "valid" when unsure (adding a real word to the dictionary is safe; "fixing" a valid word is harmful).',
    'Return ONLY a JSON array, no markdown fences: [{"w":"<word>","verdict":"valid"|"typo","fix":"<correction or null>"}]',
    'Words:',
    ...words.map(w => `- ${w}`)
  ].join('\n')
}

/**
 * Витягує JSON-масив із відповіді моделі (бере від першої «[» до останньої «]» — зрізає прозу й markdown-обрамлення).
 * @param {string} text відповідь
 * @returns {Array<{w:string, verdict:string, fix:string|null}>|null} вердикти або null
 */
export function parseClassify(text) {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start === -1 || end <= start) return null
  try {
    const arr = JSON.parse(text.slice(start, end + 1))
    return Array.isArray(arr) ? arr : null
  } catch {
    return null
  }
}

/**
 * Дописує слова у `.cspell.json#words` (sorted/dedup) — видно в git diff для рев'ю.
 * @param {string} cwd корінь
 * @param {string[]} words валідні слова
 * @returns {number} к-сть фактично доданих (нових) слів
 */
export function appendWordsToDict(cwd, words) {
  const cfgPath = join(cwd, '.cspell.json')
  if (words.length === 0 || !existsSync(cfgPath)) return 0
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'))
  const set = new Set(cfg.words)
  const before = set.size
  for (const w of words) set.add(w)
  if (set.size === before) return 0
  cfg.words = [...set].toSorted((a, b) => a.localeCompare(b))
  writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`)
  return set.size - before
}

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

  const first = await detectCspell(ctx.cwd, bin, ctx.files)
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

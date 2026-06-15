/**
 * cspell у ланцюжку lint-text із omlx-класифікацією (нова схема — спека
 * docs/specs/2026-06-15-opportunistic-llm-fix-tier.md).
 *
 * cspell не має нативного `--fix`, а емпірично ~90% «Unknown word» на укр+тех-репо —
 * валідні терміни, не одруки (вимір: 1406 знахідок / 292 файли, ~90% словникові
 * кандидати). Тому fix-режим НЕ переписує файли (старий whole-file `llmLintFix`
 * таймаутив/парс-фейлив — bounded-output принцип спеки), а **класифікує** знахідки:
 *   detect → omlx-класифікація distinct-слів (bounded JSON-вихід) → валідні слова
 *   авто-дописуються у `.cspell.json#words` (sorted/dedup, видно в diff) → ймовірні
 *   одруки лишаються списком на рев'ю (НЕ авто-виправляються — апплай небезпечний) →
 *   re-detect. read-only: лише детект (нуль мутацій).
 *
 * Гейт: валідні слова після дописування у словник зникають; нерозкласифіковані та
 * typo лишаються → cspell повертає !=0 → exit 1 (людина доправляє одруки вручну).
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { resolveCmd } from '../../../scripts/utils/resolve-cmd.mjs'
import { callLlm, preflightLocalModel } from '../../../lib/llm.mjs'

/** Слово у рядку cspell: `<file>:<line>:<col> - Unknown word (xxx)`. */
const UNKNOWN_WORD_RE = /Unknown word \(([^)]+)\)/u
/** Максимум distinct-слів під класифікацію за прогін (без тихого обрізання — логуємо надлишок). */
const MAX_CLASSIFY_WORDS = 80

/** Локальна fix-модель (рішення: єдиний knob `N_LOCAL_MIN_MODEL`). */
const fixModel = () => process.env.N_LOCAL_MIN_MODEL || ''

/**
 * Запускає `cspell .` із захопленням виводу.
 * @param {string} cwd корінь
 * @param {string} bin шлях до cspell (npx/локальний)
 * @returns {{ code:number, out:string }} код + обʼєднаний stdout/stderr
 */
function detectCspell(cwd, bin) {
  const r = spawnSync(bin, ['cspell', '.'], { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, env: process.env })
  return { code: typeof r.status === 'number' ? r.status : 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
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
function classifyPrompt(words) {
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
function parseClassify(text) {
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
 * cspell-крок lint-text: класифікація → словник (нова схема).
 * @param {string} [cwd] корінь
 * @param {boolean} [readOnly] true → лише детект (нуль мутацій)
 * @param {boolean} [llmFix] opt-in omlx-класифікація (з `meta.json: llmFix:true`); без нього — лише детект
 * @returns {number} 0 — чисто; 1 — лишились знахідки / помилка середовища
 */
export function runCspellText(cwd = process.cwd(), readOnly = false, llmFix = false) {
  const bin = resolveCmd('npx')
  if (!bin) {
    process.stderr.write('❌ npx не знайдено в PATH (cspell).\n')
    return 1
  }

  const first = detectCspell(cwd, bin)
  if (first.code === 0) return 0
  if (readOnly || !llmFix) {
    process.stdout.write(first.out)
    return first.code
  }

  // Fix-режим: класифікація знахідок (bounded JSON-вихід), валідні → у словник.
  const model = fixModel()
  const problem = preflightLocalModel(model)
  if (problem) {
    process.stdout.write(`⚠️  cspell: класифікацію пропущено (${problem})\n`)
    process.stdout.write(first.out)
    return first.code
  }

  const words = unknownWords(first.out)
  const batch = words.slice(0, MAX_CLASSIFY_WORDS)
  if (words.length > MAX_CLASSIFY_WORDS) {
    process.stdout.write(`ℹ️  cspell: класифікація перших ${MAX_CLASSIFY_WORDS}/${words.length} слів (решта — наступний прогін)\n`)
  }

  let text
  try {
    text = callLlm([{ role: 'user', content: classifyPrompt(batch) }], model, { caller: 'cspell-classify', maxTokens: 4000 })
  } catch (error) {
    process.stdout.write(`⚠️  cspell: omlx-класифікація впала (${error.message}) — без авто-словника\n`)
    process.stdout.write(first.out)
    return first.code
  }

  const parsed = parseClassify(text)
  if (!parsed) {
    process.stdout.write('⚠️  cspell: не вдалося розпарсити класифікацію — без авто-словника\n')
    process.stdout.write(first.out)
    return first.code
  }

  const valid = parsed.filter(x => x.verdict === 'valid' && typeof x.w === 'string').map(x => x.w)
  const typos = parsed.filter(x => x.verdict === 'typo' && typeof x.w === 'string')
  const added = appendWordsToDict(cwd, valid)
  process.stdout.write(`✓ cspell: +${added} валідних слів у .cspell.json (з ${valid.length} класифікованих)\n`)
  if (typos.length > 0) {
    process.stdout.write("⚠️  cspell: ймовірні одруки на рев'ю (НЕ виправлено авто):\n")
    for (const t of typos) {
      const arrow = t.fix ? ` → ${t.fix}` : ''
      process.stdout.write(`  - ${t.w}${arrow}\n`)
    }
  }

  // Re-detect: валідні тепер у словнику → лишаються одруки/нерозкласифіковане → exit 1.
  const second = detectCspell(cwd, bin)
  if (second.code !== 0) process.stdout.write(second.out)
  return second.code
}

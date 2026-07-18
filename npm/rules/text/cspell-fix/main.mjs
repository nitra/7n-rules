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
 *   re-detect. Класифікація виконується у `fix-worker.mjs` (Central Runner Pipeline);
 *   тут — лише read-only детект і shared-хелпери класифікації.
 *
 * Гейт: валідні слова після дописування у словник зникають; нерозкласифіковані та
 * typo лишаються → cspell повертає !=0 → exit 1 (людина доправляє одруки вручну).
 */
import { env } from 'node:process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { resolveCmd } from '../../../scripts/utils/resolve-cmd.mjs'
import { spawnAsync } from '../../../scripts/utils/spawn-async.mjs'
import { createViolationReporter } from '../../../scripts/lib/lint-surface/violation-reporter.mjs'

/** Слово у рядку cspell: `<file>:<line>:<col> - Unknown word (xxx)`. */
const UNKNOWN_WORD_RE = /Unknown word \(([^)]+)\)/u
/** Підсумковий рядок cspell: `CSpell: Files checked: N, Issues found: M in K files.` */
const FILES_CHECKED_RE = /Files checked:\s*(\d+)/u
/** Максимум distinct-слів під класифікацію за прогін (без тихого обрізання — логуємо надлишок). */
export const MAX_CLASSIFY_WORDS = 80

/**
 * Локальна fix-модель (рішення: єдиний knob `N_LOCAL_MIN_MODEL`).
 * @returns {string} ідентифікатор моделі з env або порожній рядок.
 */
export const fixModel = () => env.N_LOCAL_MIN_MODEL || ''

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
 * cspell-крок lint-text: read-only детект (нуль мутацій). LLM-класифікація знахідок
 * і поповнення `.cspell.json#words` живуть у `fix-worker.mjs` (Central Runner Pipeline).
 * Async (не блокує event loop) — детектор може виконуватись у parallel lane `detectAll()`
 * (ADR 260716-1354).
 * @param {string[]} [files] явний перелік файлів (delta); без нього — `cspell .`
 * @param {string} [cwd] корінь
 * @param {boolean} [verbose] показати повний нативний вивід cspell (включно з прогресом)
 * @returns {Promise<number>} 0 — чисто; 1 — лишились знахідки / помилка середовища
 */
export async function runCspellText(files, cwd = process.cwd(), verbose = false) {
  const bin = resolveCmd('npx')
  if (!bin) {
    process.stderr.write('❌ npx не знайдено в PATH (cspell).\n')
    return 1
  }

  const first = await detectCspell(cwd, bin, files, verbose)
  if (first.code === 0) {
    // «Files checked: 0» при явно переданих файлах — легітимно (усі під ignorePaths),
    // але так само виглядає зламане середовище (спостережено 2026-07-12: cspell-gitignore
    // у git-worktree застосовував .gitignore основного репо і мовчки ігнорував УСЕ,
    // поки .cspell.json#gitignoreRoot не обмежив обхід коренем конфіга). Сигналимо
    // в stderr, щоб розрив local/CI не був німим, — без фейлу.
    if (files !== undefined && files.length > 0 && FILES_CHECKED_RE.exec(first.out)?.[1] === '0')
      process.stderr.write(
        `⚠️ cspell: 0 із ${files.length} переданих файлів перевірено — або всі під ignorePaths, або зламаний скоуп (gitignore/worktree).\n`
      )
    return 0
  }
  process.stdout.write(first.out)
  return first.code
}

/**
 * Detector text/cspell-fix: read-only cspell по `ctx.files` (delta) або по всьому репо (full).
 * Скоуп файлів, які реально перевіряються, керується `.cspell.json` (glob/ignorePaths) — тут
 * лише звужуємо аргументи CLI до `ctx.files`, коли вони задані.
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст lint-прогону
 * @returns {Promise<import('../../../scripts/lib/lint-surface/types.mjs').LintResult>} результат детектора
 */
export async function lint(ctx) {
  const reporter = createViolationReporter(ctx)
  const { fail } = reporter
  if (ctx.files !== undefined && ctx.files.length === 0) return reporter.result()

  const code = await runCspellText(ctx.files, ctx.cwd, ctx.verbose === true)
  if (code !== 0) fail('cspell знайшов порушення правопису (text.mdc)', 'cspell')
  return reporter.result()
}

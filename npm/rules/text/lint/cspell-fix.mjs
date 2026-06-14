/**
 * cspell у ланцюжку lint-text із omlx-автофіксом (point 4 спеки).
 *
 * cspell не має нативного `--fix`. У fix-режимі: детект (захоплення виводу) → групування
 * знахідок по файлах → per-file omlx-фікс справжніх одруків (`llmLintFix`) → re-detect.
 * У read-only: лише детект (нуль мутацій). Валідні терміни omlx лишає — їх ловить повторний
 * cspell (далі — у словник `@nitra/cspell-dict`).
 */
import { spawnSync } from 'node:child_process'

import { resolveCmd } from '../../../scripts/utils/resolve-cmd.mjs'
import { llmLintFix } from '../../../scripts/lib/fix/llm-lint-fix.mjs'

/** Рядок cspell: `<file>:<line>:<col> - Unknown word (xxx)`. */
const CSPELL_LINE_RE = /^(.+?):\d+:\d+\s+-\s+Unknown word/u
/** Максимум файлів під omlx-фікс за прогін (без тихого обрізання — логуємо надлишок). */
const MAX_FIX_FILES = 25

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
 * Групує cspell-знахідки за файлом.
 * @param {string} out вивід cspell
 * @returns {Map<string, string[]>} файл → рядки знахідок
 */
export function groupFindingsByFile(out) {
  /** @type {Map<string, string[]>} */
  const byFile = new Map()
  for (const line of out.split('\n')) {
    const m = CSPELL_LINE_RE.exec(line.trim())
    if (!m) continue
    const file = m[1]
    if (!byFile.has(file)) byFile.set(file, [])
    byFile.get(file).push(line.trim())
  }
  return byFile
}

const CSPELL_INSTRUCTION = [
  'Correct genuine spelling typos in the file(s).',
  'Each flagged "Unknown word" is listed below.',
  'ONLY fix obvious misspellings of real words.',
  'If a flagged token is a valid identifier, technical term, abbreviation, proper noun, URL,',
  'or an intentional non-English word, leave it UNCHANGED (it will be added to the dictionary).',
  'Preserve all code, formatting, and unrelated text exactly.'
].join(' ')

/**
 * cspell-крок lint-text з omlx-автофіксом.
 * @param {string} [cwd] корінь
 * @param {boolean} [readOnly] true → лише детект (нуль мутацій)
 * @returns {number} 0 — чисто; 1 — лишились знахідки / помилка середовища
 */
export function runCspellText(cwd = process.cwd(), readOnly = false) {
  const bin = resolveCmd('npx')
  if (!bin) {
    process.stderr.write('❌ npx не знайдено в PATH (cspell).\n')
    return 1
  }

  const first = detectCspell(cwd, bin)
  if (first.code === 0) return 0
  if (readOnly) {
    process.stdout.write(first.out)
    return first.code
  }

  // Fix-режим: omlx по файлах зі справжніми одруками.
  const byFile = groupFindingsByFile(first.out)
  const files = [...byFile.keys()]
  if (files.length === 0) {
    process.stdout.write(first.out)
    return first.code
  }
  const targets = files.slice(0, MAX_FIX_FILES)
  if (files.length > MAX_FIX_FILES) {
    process.stdout.write(`ℹ️  cspell: omlx-фікс перших ${MAX_FIX_FILES}/${files.length} файлів (решта — наступний прогін)\n`)
  }

  for (const file of targets) {
    const res = llmLintFix({
      tool: 'cspell',
      instruction: CSPELL_INSTRUCTION,
      findings: byFile.get(file).join('\n'),
      filePaths: [file],
      projectRoot: cwd
    })
    process.stdout.write(res.ok ? `  ⚡ cspell omlx-фікс: ${file}\n` : `  ⚠️  cspell omlx-фікс пропущено (${file}): ${res.error}\n`)
  }

  // Re-detect: що лишилось (валідні терміни → у словник).
  const second = detectCspell(cwd, bin)
  if (second.code !== 0) process.stdout.write(second.out)
  return second.code
}

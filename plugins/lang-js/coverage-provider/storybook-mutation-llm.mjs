/**
 * LLM-джерело мутантів для Storybook mutation executor-а (storybook-mutation.mjs) —
 * Mutahunter/Meta-ACH-патерн: LLM лише ПРОПОНУЄ context-aware bug-like мутанти
 * (off-by-one, підмінені fallback-значення, переплутані аргументи — те, чого
 * детерміновані оператори виразити не можуть), а вбиває/милує так само лише
 * реальний browser-mode прогін у executor-і. Жодного LLM-суддівства pass/fail.
 *
 * Кожна пропозиція жорстко валідується перед прийняттям: рядок існує і покритий
 * сторі, `original` — точний підрядок цього рядка, а мутований код парситься
 * (`parseAst`) — синтаксично невалідні пропозиції відкидаються (інакше зламаний
 * компайл рахувався б як killed і дуто підвищував score, патерн LLMorpheus).
 *
 * Graceful degradation: будь-яка помилка LLM-виклику (нема API-ключа, мережа)
 * дає `[]` з одноразовим попередженням — детерміновані мутанти працюють далі.
 * Opt-out: env `N_7N_TEST_NO_LLM_MUTANTS=1`.
 */
import { env } from 'node:process'
import { startChain } from '@7n/llm-lib/chain'
import { budgetFor } from '@7n/llm-lib/prompt-budget'

import { callText } from '@7n/rules/rules/test/coverage/lib/llm.mjs'
import { parseAst } from './lib/parse-ast.mjs'
import { extractMutableCode } from './storybook-mutation.mjs'

/** LLM-мутанти сортуються ПІСЛЯ детермінованих тірів 1–5 (власна стеля — не конкурують). */
const LLM_TIER = 6
const MAX_PROPOSALS = 6
const JSON_ARRAY_RE = /\[[\s\S]*\]/

const SYSTEM_PROMPT = `You are a mutation-testing expert. Propose realistic, bug-like mutants for the JavaScript code below — the kind of subtle bugs a developer could actually introduce.

Reply ONLY with a JSON array (no markdown fence):
[{"line": <number>, "original": "<exact substring of that line>", "replacement": "<text>", "category": "<short-kebab-case>", "reason": "<одне речення українською>"}]

Rules:
- line: 1-based line number as shown in the numbered code
- original MUST be an EXACT substring of that line (long enough to locate unambiguously)
- replacement must differ from original and keep the file syntactically valid
- prefer bugs that simple operator swaps cannot express: off-by-one in slice/index bounds, wrong default or fallback value, swapped call arguments, wrong property name, inverted early-return condition, dropped await
- do NOT mutate imports, comments, or purely cosmetic strings
- only mutate lines marked as covered
- at most ${MAX_PROPOSALS} proposals, most bug-likely first`

/**
 * Нумерує рядки коду для промпта (absolute line numbers повного файлу).
 * @param {string} code вміст script-блоку
 * @param {number} startLine 1-based номер першого рядка блоку в повному файлі
 * @returns {string} код із префіксами номерів рядків
 */
function numberLines(code, startLine) {
  return code
    .split('\n')
    .map((l, i) => `${startLine + i}: ${l}`)
    .join('\n')
}

/**
 * Валідує одну LLM-пропозицію і переводить її у shape мутанта executor-а.
 * @param {{line?: unknown, original?: unknown, replacement?: unknown, category?: unknown}} p пропозиція LLM
 * @param {string[]} sourceLines рядки повного файлу
 * @param {number[]} lineOffsets offset початку кожного рядка у повному файлі
 * @param {Set<number>} coveredLines покриті сторі рядки
 * @returns {{line: number, col: number, mutantType: string, original: string, replacement: string, start: number, end: number, text: string, tier: number} | null} мутант або null (невалідна пропозиція)
 */
function validateProposal(p, sourceLines, lineOffsets, coveredLines) {
  if (!p || typeof p !== 'object') return null
  const { line, original, replacement } = p
  if (!Number.isInteger(line) || line < 1 || line > sourceLines.length) return null
  if (!coveredLines.has(line)) return null
  if (typeof original !== 'string' || original.length === 0) return null
  if (typeof replacement !== 'string' || replacement === original) return null

  const lineText = sourceLines[line - 1]
  const col = lineText.indexOf(original)
  if (col === -1) return null

  const start = lineOffsets[line - 1] + col
  return {
    line,
    col,
    mutantType: typeof p.category === 'string' && p.category ? `llm:${p.category}` : 'llm:proposed',
    original,
    replacement,
    start,
    end: start + original.length,
    text: replacement,
    tier: LLM_TIER
  }
}

/**
 * Чи мутований файл лишається синтаксично валідним (у скоупі script-блоку).
 * @param {string} file відносний шлях файлу
 * @param {string} source повний вміст файлу
 * @param {{start: number, end: number, text: string}} mutant мутант для приміряння
 * @returns {boolean} true, якщо parseAst бере мутований script-блок
 */
function staysParseable(file, source, mutant) {
  const mutated = source.slice(0, mutant.start) + mutant.text + source.slice(mutant.end)
  const extracted = extractMutableCode(file, mutated)
  if (!extracted) return false
  try {
    parseAst(extracted.code)
    return true
  } catch {
    return false
  }
}

/**
 * Пропонує LLM-мутанти для одного файлу: один callText-виклик (окремий chain),
 * парс JSON-відповіді, жорстка валідація кожної пропозиції (рядок/підрядок/
 * покриття/синтаксис). Кидає помилки LLM-виклику нагору — graceful-обгортка
 * (warn + []) живе на боці виклику (defaultRunner у js-collector.mjs).
 * @param {object} opts опції
 * @param {string} opts.file відносний шлях файлу
 * @param {string} opts.source повний вміст файлу
 * @param {Set<number>} opts.coveredLines покриті сторі рядки (1-indexed)
 * @param {string} opts.cwd робоча директорія для LLM-session/chain
 * @param {typeof callText} [opts.callTextFn] LLM-колер (ін'єкція для тестів)
 * @param {typeof startChain} [opts.makeChain] фабрика ланцюжка (ін'єкція для тестів)
 * @returns {Promise<Array<object>>} валідні мутанти у shape generateMutants (може бути порожнім)
 */
export async function proposeLlmMutants(opts) {
  const { file, source, coveredLines, cwd, callTextFn = callText, makeChain = startChain } = opts
  if (env.N_7N_TEST_NO_LLM_MUTANTS) return []

  const extracted = extractMutableCode(file, source)
  if (!extracted) return []

  const sourceLines = source.split('\n')
  const lineOffsets = []
  let offset = 0
  for (const l of sourceLines) {
    lineOffsets.push(offset)
    offset += l.length + 1
  }

  // 1-based номер першого рядка script-блоку в повному файлі
  const blockStartLine = source.slice(0, extracted.offset).split('\n').length
  const covered = [...coveredLines].toSorted((a, b) => a - b).join(', ')

  const prompt = [
    SYSTEM_PROMPT,
    '',
    `## File: ${file}`,
    `Covered lines: ${covered}`,
    '',
    '```js',
    numberLines(extracted.code, blockStartLine),
    '```'
  ].join('\n')

  const chain = makeChain({ kind: 'sb-llm-mutants', unit: file, cwd })
  let text
  let failed = null
  try {
    text = await callTextFn(prompt, { cwd, maxTokens: budgetFor('block').maxTokens, chain })
  } catch (error) {
    failed = String(error.message ?? error).slice(0, 200)
    throw error
  } finally {
    chain.end({ outcome: failed ? 'fail' : 'success', extra: failed ? { error: failed } : {} })
  }

  let proposals
  try {
    proposals = JSON.parse(JSON_ARRAY_RE.exec(text)?.[0] ?? '[]')
  } catch {
    return []
  }
  if (!Array.isArray(proposals)) return []

  const mutants = []
  for (const p of proposals.slice(0, MAX_PROPOSALS)) {
    const m = validateProposal(p, sourceLines, lineOffsets, coveredLines)
    if (m && staysParseable(file, source, m)) mutants.push(m)
  }
  return mutants
}

/**
 * LLM-довизначення потреби в тестах для непокритого файлу (fix-шлях концерну
 * `coverage` правила `test`, `npx @7n/rules lint test`).
 *
 * Швидка локальна евристика (`quickClassify`, спільна з делта-гейтом) відсіює
 * очевидні випадки — LLM викликається лише для неоднозначних файлів.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { callText } from '@7n/rules/rules/test/coverage/lib/llm.mjs'
import { quickClassify } from '../lib/quick-classify.mjs'

const MAX_CONTENT_BYTES = 6000

const SYSTEM_PROMPT = `You are a test-need classifier for JS/TS source files.

Given a source file with low test coverage, decide if unit tests are worthwhile.

Reply ONLY with a JSON object (no markdown fence):
{"needsTests": true|false, "reason": "one sentence in Ukrainian"}

needsTests: false when:
- File only contains types, interfaces, constants, or re-exports with no logic
- Thin config or index file that just wires up other modules
- Behavior is fully covered by integration/e2e tests (name them)

needsTests: true when:
- File contains utility functions, parsers, transformers with branches
- Business logic with conditions or non-trivial contracts
- Pure functions that can be unit-tested cheaply`

/** Витягання JSON-обʼєкта з ключем needsTests із відповіді моделі. */
const NEEDS_TESTS_JSON_RE = /\{[\s\S]*?"needsTests"[\s\S]*?\}/

/**
 * Оцінює один файл: спершу локальна евристика, потім LLM для неоднозначних.
 * @param {{file: string, pct: number}} fileInfo файл із рівнем покриття
 * @param {string} dir корінь проєкту
 * @param {Function} callTextFn text-виклик LLM
 * @returns {Promise<{file: string, pct: number, needsTests: boolean, reason: string}>} вердикт для файлу
 */
async function assessOne(fileInfo, dir, callTextFn) {
  const absPath = join(dir, fileInfo.file)
  if (!existsSync(absPath)) return { ...fileInfo, needsTests: false, reason: 'файл недоступний' }

  const rawContent = readFileSync(absPath, 'utf8')

  const quick = quickClassify(rawContent)
  if (quick !== null) return { ...fileInfo, ...quick }

  let content = rawContent
  if (content.length > MAX_CONTENT_BYTES) content = content.slice(0, MAX_CONTENT_BYTES) + '\n...(truncated)'

  const prompt =
    `${SYSTEM_PROMPT}\n\n` +
    `## File: ${fileInfo.file} (current coverage: ${fileInfo.pct.toFixed(1)}%)\n\n` +
    `\`\`\`\n${content}\n\`\`\``

  try {
    const text = await callTextFn(prompt, { cwd: dir })
    const match = text.match(NEEDS_TESTS_JSON_RE)
    const parsed = JSON.parse(match?.[0] ?? '{}')
    return {
      ...fileInfo,
      needsTests: parsed.needsTests !== false,
      reason: typeof parsed.reason === 'string' ? parsed.reason : ''
    }
  } catch {
    return { ...fileInfo, needsTests: true, reason: 'оцінка не вдалась — вважаємо що потрібні тести' }
  }
}

/**
 * Оцінює список непокритих файлів: чи потрібні їм тести.
 * Очевидні випадки (реекспорти, функції з розгалуженнями) вирішуються локально,
 * LLM викликається лише для неоднозначних.
 * @param {Array<{file: string, pct: number}>} files непокриті файли
 * @param {string} dir корінь проєкту
 * @param {{ callText?: Function }} [opts] інʼєкція text-виклику для тестів
 * @returns {Promise<Array<{file: string, pct: number, needsTests: boolean, reason: string}>>} вердикти по файлах
 */
export async function assessNeed(files, dir, opts = {}) {
  const callTextFn = opts.callText ?? callText
  return Promise.all(files.map(f => assessOne(f, dir, callTextFn)))
}

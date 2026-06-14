/**
 * PostToolUse hook для Claude Code: read-only детект конформності **всіх** активованих правил
 * після редагування файлу. Запускається після кожного `Edit` / `Write` / `MultiEdit`.
 *
 * Раніше хук маршрутизував змінений файл у релевантні правила й ганяв повний `fix` (автофікс
 * + LLM) — дорого, тож звужували. Тепер хук — **детект** (нуль мутацій, нуль LLM), тож роутинг
 * зайвий: один виклик `_fix-check` (per-rule `fix.mjs run()` = перевірка) по всіх правилах.
 *
 * Контракт:
 * - stdin Claude Code: JSON із `tool_input.file_path`; якщо файлу немає (напр. Bash) — exit 0 (skip);
 * - інакше пряма `runFixCheck` (детект усіх правил, без subprocess-обгортки), exit-код прозоро:
 *   1 — є порушення конформності (PostToolUse не блокує turn, але код лишаємо інформативним).
 */
import { once } from 'node:events'
import { cwd as processCwd } from 'node:process'

import { runFixCheck } from './lib/fix/run-fix-check.mjs'

/**
 * Зчитує stdin до EOF як utf8 рядок. На TTY — повертає `''` одразу.
 * @returns {Promise<string>} вміст stdin
 */
async function readStdin() {
  if (process.stdin.isTTY) {
    return ''
  }
  process.stdin.setEncoding('utf8')
  const chunks = []
  process.stdin.on('data', chunk => {
    chunks.push(chunk)
  })
  try {
    await once(process.stdin, 'end')
  } catch {
    // 'error' на stdin — повертаємо те, що встигли зібрати
  }
  return chunks.join('')
}

/**
 * Дістає `tool_input.file_path` зі stdin JSON Claude Code. Невалідний JSON
 * або відсутнє поле → `null` (не помилка: дехто з інструментів — напр. Bash — не пише `file_path`).
 * @param {string} stdinJson сирий вміст stdin
 * @returns {string | null} відносний шлях або `null`
 */
export function extractFilePath(stdinJson) {
  if (!stdinJson) {
    return null
  }
  try {
    const obj = JSON.parse(stdinJson)
    const fp = obj?.tool_input?.file_path
    return typeof fp === 'string' && fp !== '' ? fp : null
  } catch {
    return null
  }
}

/**
 * Точка входу. Викликається з `bin/n-cursor.js` коли argv[0] === `post-tool-use-fix`.
 * Параметри доступні для інʼєкції для тестів: `stdinJson` обходить read від `process.stdin`,
 * `runFixCheckFn` — заміна `runFixCheck`.
 * @param {{ stdinJson?: string, runFixCheckFn?: typeof runFixCheck }} [options] параметри для тестів
 * @returns {Promise<number>} exit code (0 — пропущено / конформність ОК; 1 — є порушення)
 */
export async function runPostToolUseFixCli(options = {}) {
  const stdinJson = options.stdinJson ?? (await readStdin())
  const filePath = extractFilePath(stdinJson)
  // Тільки після редагування файлу (Edit/Write/MultiEdit мають file_path); Bash тощо — skip.
  if (filePath === null) {
    return 0
  }
  const check = options.runFixCheckFn ?? runFixCheck
  // Один read-only детект конформності всіх активованих правил (пряма функція, без subprocess).
  try {
    const { failed, rules } = await check([], processCwd())
    if (failed === 0) return 0
    for (const r of rules.filter(x => !x.ok)) {
      if (r.output) process.stderr.write(`${r.output}\n`)
    }
    return 1
  } catch (error) {
    process.stderr.write(`post-tool-use-fix: не вдалося запустити детект конформності — ${error.message}\n`)
    return 1
  }
}

/**
 * PostToolUse hook для Claude Code: read-only детект конформності **всіх** активованих правил
 * після редагування файлу. Запускається після кожного `Edit` / `Write` / `MultiEdit`.
 *
 * Раніше хук маршрутизував змінений файл у релевантні правила й ганяв повний `fix` (автофікс
 * + LLM) — дорого, тож звужували. Тепер хук — **детект** (нуль мутацій, нуль LLM), тож роутинг
 * зайвий: один виклик `_fix-check` (per-rule `check.mjs run()` = перевірка) по всіх правилах.
 *
 * Контракт:
 * - stdin Claude Code: JSON із `tool_input.file_path`; якщо файлу немає (напр. Bash) — exit 0 (skip);
 * - інакше пряма `runConformanceCheck` (детект усіх правил, без subprocess-обгортки), exit-код прозоро:
 *   1 — є порушення конформності (PostToolUse не блокує turn, але код лишаємо інформативним).
 */
import { once } from 'node:events'
import { cwd as processCwd } from 'node:process'

import { detectAll } from './lib/lint-surface/run-detectors.mjs'

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
 * Точка входу. Викликається з `bin/n-rules.js` коли argv[0] === `post-tool-use-check`.
 * Параметри доступні для інʼєкції для тестів: `stdinJson` обходить read від `process.stdin`,
 * `runConformanceCheckFn` — заміна `runConformanceCheck`.
 * @param {{ stdinJson?: string, detectFn?: typeof detectAll }} [options] параметри для тестів
 * @returns {Promise<number>} exit code (0 — пропущено / OK; 1 — є порушення)
 */
export async function runPostToolUseCheckCli(options = {}) {
  const stdinJson = options.stdinJson ?? (await readStdin())
  const filePath = extractFilePath(stdinJson)
  // Тільки після редагування файлу (Edit/Write/MultiEdit мають file_path); Bash тощо — skip.
  if (filePath === null) {
    return 0
  }
  const detect = options.detectFn ?? detectAll
  // Read-only per-file детект (unified lint surface) зміненого файлу; рендер — у runner-і.
  try {
    const { exitCode } = await detect({ files: [filePath], cwd: processCwd(), log: s => process.stderr.write(s) })
    return exitCode === 0 ? 0 : 1
  } catch (error) {
    process.stderr.write(`post-tool-use-check: не вдалося запустити детект — ${error.message}\n`)
    return 1
  }
}

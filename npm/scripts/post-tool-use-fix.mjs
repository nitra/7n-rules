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
 * - інакше spawn `_fix-check` (детект усіх правил), exit-код прозоро пробрасуємо (PostToolUse
 *   не блокує turn, але код лишаємо інформативним: 1 — є порушення конформності).
 */
import { spawn } from 'node:child_process'
import { once } from 'node:events'

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
 * `spawnFn` — заміна `node:child_process.spawn`.
 * @param {{ stdinJson?: string, spawnFn?: typeof spawn }} [options] параметри для тестів
 * @returns {Promise<number>} exit code (0 — пропущено / конформність ОК; інше — є порушення)
 */
export async function runPostToolUseFixCli(options = {}) {
  const stdinJson = options.stdinJson ?? (await readStdin())
  const filePath = extractFilePath(stdinJson)
  // Тільки після редагування файлу (Edit/Write/MultiEdit мають file_path); Bash тощо — skip.
  if (filePath === null) {
    return 0
  }
  const spawnFn = options.spawnFn ?? spawn
  // Один read-only виклик: детект конформності всіх активованих правил, без роутингу.
  const child = spawnFn('npx', ['--no', '@nitra/cursor', '_fix-check'], { stdio: 'inherit' })
  try {
    const [code] = await once(child, 'exit')
    return code ?? 1
  } catch (error) {
    process.stderr.write(`post-tool-use-fix: не вдалося запустити детект конформності — ${error.message}\n`)
    return 1
  }
}

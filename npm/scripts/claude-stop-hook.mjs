/**
 * Stop-hook для Claude Code: запускається hook'ом із `.claude/settings.json` після того,
 * як агент сигналізує завершення ходу. Прозоро прокидає `npx @nitra/cursor check`
 * і повертає його exit code, щоб помилки правил блокували завершення.
 *
 * Захист від нескінченної рекурсії: якщо stdin містить `"stop_hook_active": true`
 * (Claude Code позначає цей прапорець, коли hook сам спричинив повторний Stop),
 * виходимо з кодом 0 без повторного запуску перевірок.
 *
 * Виклик з `bin/n-cursor.js`:
 *   `npx --no @nitra/cursor stop-hook`
 */
import { spawn } from 'node:child_process'

/**
 * Зчитує stdin до EOF як utf8 рядок. Якщо stdin порожній (TTY) — повертає '' одразу.
 * @returns {Promise<string>} вміст stdin
 */
function readStdin() {
  return new Promise(resolve => {
    if (process.stdin.isTTY) {
      resolve('')
      return
    }
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', chunk => {
      data += chunk
    })
    process.stdin.on('end', () => resolve(data))
    process.stdin.on('error', () => resolve(data))
  })
}

/**
 * Чи stdin вказує, що поточний Stop вже виник через попередній Stop hook
 * (Claude Code передає `stop_hook_active: true`). У такому випадку повторний
 * запуск перевірок створив би нескінченний цикл — пропускаємо.
 * @param {string} stdin сирий вміст stdin
 * @returns {boolean} true, якщо рекурсивний виклик
 */
export function isRecursiveStopHookCall(stdin) {
  if (!stdin) {
    return false
  }
  try {
    const obj = JSON.parse(stdin)
    return obj?.stop_hook_active === true
  } catch {
    return false
  }
}

/**
 * Точка входу. Викликається з `bin/n-cursor.js` коли argv[0] === 'stop-hook'.
 * @returns {Promise<number>} exit code (0 — OK / пропуск, 1 — помилки правил)
 */
export async function runStopHookCli() {
  const stdin = await readStdin()
  if (isRecursiveStopHookCall(stdin)) {
    return 0
  }
  return new Promise(resolve => {
    const child = spawn('npx', ['--no', '@nitra/cursor', 'check'], { stdio: 'inherit' })
    child.on('exit', code => resolve(code ?? 1))
    child.on('error', err => {
      process.stderr.write(`stop-hook: не вдалося запустити npx @nitra/cursor check — ${err.message}\n`)
      resolve(1)
    })
  })
}

/**
 * Async (non-blocking) заміна `spawnSync` для важких зовнішніх CLI-викликів (conftest, oxlint тощо).
 *
 * `spawnSync` блокує весь Node event loop цілком — паралельний виклик кількох
 * concern-детекторів навколо `spawnSync` не дає реальної паралельності, лише ілюзію.
 * `spawnAsync` обгортає `child_process.spawn` через `events.once` (без `new Promise`,
 * `promise/avoid-new` заборонений у цьому пакеті), підтримує зовнішній `AbortSignal`
 * і `timeoutMs` (обидва ведуть до `SIGTERM` → ескалація `SIGKILL`, якщо процес не
 * завершився за grace-період), і повертає нормалізований результат без винятку на
 * non-zero exit — це, як і раніше, вирішує caller.
 */
import { spawn } from 'node:child_process'
import { once } from 'node:events'

/**
 * @typedef {object} SpawnAsyncResult
 * @property {string} stdout зібраний stdout (utf8)
 * @property {string} stderr зібраний stderr (utf8)
 * @property {number|null} exitCode код завершення (`null` — процес вбито сигналом)
 * @property {string|null} signal сигнал, яким вбито процес (`null` — завершився сам)
 * @property {boolean} timedOut true, якщо процес вбито через `timeoutMs`
 * @property {boolean} aborted true, якщо процес вбито через зовнішній `AbortSignal`
 */

/** `AbortError` (DOM `AbortController` семантика) для вже-скасованого `signal` до старту спавна. */
class AbortError extends Error {
  /** @param {string} [message] текст помилки */
  constructor(message = 'The operation was aborted') {
    super(message)
    this.name = 'AbortError'
  }
}

/**
 * Запускає зовнішній процес асинхронно (не блокує event loop) і збирає його результат.
 * Ніколи не кидає на non-zero exit — кидає лише на `spawn`-помилку (ENOENT тощо) або
 * якщо `opts.signal` вже `aborted` до виклику.
 * @param {string} cmd бінарник (шлях або ім'я в PATH)
 * @param {string[]} args аргументи запуску
 * @param {object} [opts] опції
 * @param {AbortSignal} [opts.signal] зовнішній сигнал скасування
 * @param {number} [opts.timeoutMs] ліміт у мілісекундах (без ліміту — не задано / ≤0)
 * @param {number} [opts.killGraceMs] пауза між `SIGTERM` і ескалацією до `SIGKILL` (дефолт 5000)
 * @param {string} [opts.cwd] робочий каталог дочірнього процесу
 * @param {Record<string, string>} [opts.env] оточення дочірнього процесу
 * @param {string} [opts.input] дані для запису в stdin дочірнього процесу (`utf8`, аналог
 *   `spawnSync`-опції `input`); stdin закривається (`end`) одразу після запису
 * @returns {Promise<SpawnAsyncResult>} нормалізований результат виконання
 */
export async function spawnAsync(cmd, args, opts = {}) {
  const { signal, timeoutMs, killGraceMs = 5000, input, ...spawnOpts } = opts
  if (signal?.aborted) throw new AbortError()

  const child = spawn(cmd, args, spawnOpts)
  child.stdout?.setEncoding('utf8')
  child.stderr?.setEncoding('utf8')
  if (input !== undefined) child.stdin?.end(input, 'utf8')

  let stdout = ''
  let stderr = ''
  child.stdout?.on('data', chunk => {
    stdout += chunk
  })
  child.stderr?.on('data', chunk => {
    stderr += chunk
  })

  let timedOut = false
  let aborted = false
  let settled = false
  let killTimer = null
  let timeoutTimer = null

  /** SIGTERM негайно, ескалація до SIGKILL якщо процес не завершився за killGraceMs. */
  const killWithEscalation = () => {
    child.kill('SIGTERM')
    killTimer = setTimeout(() => {
      if (!settled) child.kill('SIGKILL')
    }, killGraceMs)
    killTimer.unref?.()
  }
  const onAbort = () => {
    aborted = true
    killWithEscalation()
  }
  if (signal) signal.addEventListener('abort', onAbort)
  if (timeoutMs && timeoutMs > 0) {
    timeoutTimer = setTimeout(() => {
      timedOut = true
      killWithEscalation()
    }, timeoutMs)
    timeoutTimer.unref?.()
  }

  /** @returns {Promise<{code: number|null, killSignal: string|null}>} результат події `close` */
  const waitForClose = async () => {
    const [code, killSignal] = await once(child, 'close')
    return { code, killSignal }
  }
  /** @returns {Promise<never>} ніколи не резолвиться — кидає подію `error` */
  const waitForError = async () => {
    const [error] = await once(child, 'error')
    throw error
  }

  try {
    const { code, killSignal } = await Promise.race([waitForClose(), waitForError()])
    return { stdout, stderr, exitCode: code, signal: killSignal, timedOut, aborted }
  } finally {
    settled = true
    if (killTimer) clearTimeout(killTimer)
    if (timeoutTimer) clearTimeout(timeoutTimer)
    if (signal) signal.removeEventListener('abort', onAbort)
  }
}

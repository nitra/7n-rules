/** @see ./docs/pi-memory-guard.md */

/**
 * Спільна детекція memory-guard rejection локального model-сервера (нема RAM на
 * prefill) для pi-lib consumers (one-shot / agent-skill / agent-fix).
 *
 * Ретраїти нема куди — RAM-стеля фіксована, повторний виклик згорить так само.
 * Тому замість structured-error-повернення й circuit-breaker'а: друк тіла
 * запиту в stdout і Error, аби причина була видна одразу.
 */

/** Matches a local model server (e.g. oMLX) rejecting a prompt for lack of RAM. */
export const MEMORY_ERROR_RE = /memory guard|memory limit|prefill would require/i

/**
 * Якщо `message` — memory-guard rejection: друкує `requestBody` у stdout і
 * кидає Error. Інакше — no-op (виклик безпечний у будь-якому catch).
 * @param {string} message текст помилки від model-сервера
 * @param {string} requestBody prompt/тіло запиту, що спричинило rejection
 * @returns {void}
 * @throws {Error} якщо message схожий на memory-guard rejection
 */
export function failOnMemoryGuard(message, requestBody) {
  if (!MEMORY_ERROR_RE.test(message ?? '')) return
  console.log('--- omlx memory-guard: тіло запиту ---')
  console.log(requestBody)
  console.log(`✗ omlx memory-guard: ${message}`)
  throw new Error(`omlx memory-guard: ${message}`)
}

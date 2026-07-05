/** @see ./docs/with-timeout.md */

/**
 * Спільна гонка з таймаутом для llm-lib раннерів (one-shot / agent-skill / agent-fix).
 *
 * Виносить ідентичний abort-aware timeout-танець, що тричі дублювався: таймер-гілка
 * чекає `sleep(ms)` під `AbortController`, на спрацювання кличе опційний `onTimeout`
 * (напр. `session.abort`) і реджектить `${label} timeout ${ms}ms`. У finally abort
 * скасовує sleep, а його AbortError свідомо ковтається (щоб не спливти unhandled
 * після того, як race уже виграв основний promise).
 */

import { setTimeout as sleep } from 'node:timers/promises'

/**
 * Гонка `promise` з таймаутом `ms`. `ms ≤ 0` (або falsy) → повертає `promise` без гонки.
 * @param {Promise<unknown>} promise проміс, який чекаємо.
 * @param {number} ms ліміт у мілісекундах (≤ 0 → без таймауту).
 * @param {{ onTimeout?: (() => void), label?: string }} [opts] `onTimeout` — колбек на таймаут (напр. abort); `label` — префікс timeout-повідомлення.
 * @returns {Promise<unknown>} результат `promise` або reject із timeout-помилкою.
 */
export async function withTimeout(promise, ms, { onTimeout, label = 'operation' } = {}) {
  if (!ms || ms <= 0) return promise
  const controller = new AbortController()
  // Таймер-гілка чекає sleep і кидає timeout-помилку. У finally abort скасовує sleep;
  // його AbortError свідомо ковтаємо (isTimeout), щоб не спливти unhandled після
  // того, як race уже виграв основний promise.
  let isTimeout = false
  const timeout = (async () => {
    await sleep(ms, null, { signal: controller.signal })
    isTimeout = true
    onTimeout?.()
    throw new Error(`${label} timeout ${ms}ms`)
  })()
  try {
    return await Promise.race([Promise.resolve(promise), timeout])
  } finally {
    controller.abort()
    if (!isTimeout) {
      try {
        await timeout
      } catch {
        // очікувано: AbortError скасованого sleep-таймера — не помилка виклику
      }
    }
  }
}

/**
 * Повторює асинхронну операцію з експоненційним backoff, поки та не
 * завершиться успішно або не вичерпається ліміт спроб.
 * @param {() => Promise<any>} fn операція для повтору
 * @param {{ attempts?: number, baseDelayMs?: number }} [opts] ліміт спроб і базова затримка
 * @returns {Promise<any>} результат першої успішної спроби
 * @throws {Error} останню помилку, якщо всі спроби провалились
 */
export async function retry(fn, opts = {}) {
  const attempts = opts.attempts ?? 3
  const baseDelayMs = opts.baseDelayMs ?? 100
  let lastError
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      if (i < attempts - 1) {
        await new Promise(resolve => setTimeout(resolve, baseDelayMs * 2 ** i))
      }
    }
  }
  throw lastError
}

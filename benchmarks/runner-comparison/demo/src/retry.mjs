import { setTimeout as sleep } from 'node:timers/promises'

/**
 * Retry an operation with exponential backoff.
 * @param {(attempt: number) => unknown | Promise<unknown>} fn operation to execute
 * @param {{maxAttempts?: number, baseDelay?: number, factor?: number}} opts retry options
 * @returns {Promise<unknown>} operation result
 */
export async function retry(fn, opts = {}) {
  const maxAttempts = opts.maxAttempts ?? 3
  const baseDelay = opts.baseDelay ?? 10
  const factor = opts.factor ?? 2
  let attempt = 0
  let lastErr = new Error('Retry failed')
  while (attempt < maxAttempts) {
    try {
      return await fn(attempt)
    } catch (error) {
      lastErr = error instanceof Error ? error : new Error(String(error))
      attempt += 1
      if (attempt >= maxAttempts) break
      const delay = baseDelay * factor ** (attempt - 1)
      await sleep(delay)
    }
  }
  throw new Error(lastErr.message, { cause: lastErr })
}

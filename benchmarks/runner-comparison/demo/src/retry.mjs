export async function retry(fn, opts = {}) {
  const maxAttempts = opts.maxAttempts ?? 3
  const baseDelay = opts.baseDelay ?? 10
  const factor = opts.factor ?? 2
  let attempt = 0
  let lastErr
  while (attempt < maxAttempts) {
    try {
      return await fn(attempt)
    } catch (err) {
      lastErr = err
      attempt += 1
      if (attempt >= maxAttempts) break
      const delay = baseDelay * Math.pow(factor, attempt - 1)
      await new Promise((r) => setTimeout(r, delay))
    }
  }
  throw lastErr
}

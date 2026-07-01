/**
 * Drop-in заміна `createCheckReporter` для міграції check-concern-ів у detector-и.
 *
 * Старий reporter друкував pass/fail і накопичував exit code. Detector НЕ друкує —
 * цей reporter накопичує `LintViolation[]`. Тіло concern-а майже не змінюється:
 *   - `createCheckReporter()` → `createViolationReporter(ctx)`
 *   - `return reporter.getExitCode()` → `return reporter.result()`
 *
 * `fail(msg)` за замовчуванням дає `reason = ctx.concernId`. Для кількох типів порушень
 * у одному concern-і — `fail(msg, 'specific-reason')` або `fail(msg, { reason, file, data })`.
 * @typedef {import('./types.mjs').LintContext} LintContext
 * @typedef {import('./types.mjs').LintViolation} LintViolation
 * @typedef {import('./types.mjs').LintResult} LintResult
 */

/**
 * @param {LintContext} ctx
 * @returns {{
 *   pass: (...args: unknown[]) => void,
 *   fail: (msg: string, opts?: string | { reason?: string, file?: string, severity?: 'error'|'warn', data?: object }) => void,
 *   result: () => LintResult
 * }}
 */
export function createViolationReporter(ctx) {
  /** @type {LintViolation[]} */
  const violations = []
  const defaultReason = ctx?.concernId ?? 'violation'
  return {
    // detector не друкує — pass стає no-op (успіхи рендерить runner відсутністю violations)
    pass() {},
    fail(msg, opts) {
      const o = typeof opts === 'string' ? { reason: opts } : (opts ?? {})
      /** @type {any} */
      const v = { reason: o.reason ?? defaultReason, message: msg }
      if (o.file) v.file = o.file
      if (o.severity) v.severity = o.severity
      if (o.data) v.data = o.data
      violations.push(v)
    },
    result() {
      return { violations }
    }
  }
}

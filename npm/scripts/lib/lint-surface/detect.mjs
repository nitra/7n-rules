/**
 * Detect-крок unified lint surface: запуск одного concern-detector-а і нормалізація
 * його `LintResult`. Detector — read-only; тут немає LLM, autofix чи мутацій дерева.
 *
 * @typedef {import('./types.mjs').LintContext} LintContext
 * @typedef {import('./types.mjs').LintResult} LintResult
 * @typedef {import('./types.mjs').LintViolation} LintViolation
 * @typedef {import('./types.mjs').LintDiagnostic} LintDiagnostic
 * @typedef {import('../concern-meta.mjs').ConcernMeta} ConcernMeta
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Сигнал, що detector кинув виняток / повернув невалідний результат → exit 2.
 */
export class DetectorError extends Error {
  /**
   * @param {string} ruleId
   * @param {string} concernId
   * @param {string} detail
   */
  constructor(ruleId, concernId, detail) {
    super(`detector ${ruleId}/${concernId}: ${detail}`)
    this.name = 'DetectorError'
    this.ruleId = ruleId
    this.concernId = concernId
  }
}

/**
 * Нормалізує одне порушення: домішує ruleId/concernId з ctx, валідує file-path.
 * @param {unknown} raw
 * @param {LintContext} ctx
 * @returns {LintViolation}
 */
function normalizeViolation(raw, ctx) {
  if (typeof raw !== 'object' || raw === null) {
    throw new DetectorError(ctx.ruleId, ctx.concernId, "violation не є об'єктом")
  }
  const v = /** @type {Record<string, unknown>} */ (raw)
  if (typeof v.reason !== 'string' || v.reason.length === 0) {
    throw new DetectorError(ctx.ruleId, ctx.concernId, "violation.reason обов'язковий (непорожній string)")
  }
  if (typeof v.message !== 'string' || v.message.length === 0) {
    throw new DetectorError(ctx.ruleId, ctx.concernId, "violation.message обов'язковий (непорожній string)")
  }
  let file
  if (v.file !== undefined) {
    if (typeof v.file !== 'string') {
      throw new DetectorError(ctx.ruleId, ctx.concernId, 'violation.file має бути string')
    }
    if (v.file.startsWith('/') || v.file.split('/').includes('..')) {
      throw new DetectorError(ctx.ruleId, ctx.concernId, `violation.file має бути posix-relative без "..": ${v.file}`)
    }
    file = v.file
  }
  const severity = v.severity === 'warn' ? 'warn' : 'error'
  /** @type {LintViolation} */
  const out = {
    ruleId: ctx.ruleId,
    concernId: ctx.concernId,
    reason: v.reason,
    message: v.message,
    severity
  }
  if (file !== undefined) out.file = file
  if (v.data !== undefined && typeof v.data === 'object' && v.data !== null) {
    out.data = /** @type {Record<string, unknown>} */ (v.data)
  }
  return out
}

/**
 * Нормалізує сирий результат detector-а.
 * @param {unknown} raw
 * @param {LintContext} ctx
 * @returns {LintResult}
 */
function normalizeResult(raw, ctx) {
  if (typeof raw !== 'object' || raw === null || !Array.isArray(/** @type {any} */ (raw).violations)) {
    throw new DetectorError(ctx.ruleId, ctx.concernId, 'lint() має повернути { violations: [...] }')
  }
  const r = /** @type {{ violations: unknown[], diagnostics?: unknown[] }} */ (raw)
  const violations = r.violations.map(v => normalizeViolation(v, ctx))
  /** @type {LintDiagnostic[]} */
  let diagnostics = []
  if (Array.isArray(r.diagnostics)) {
    diagnostics = r.diagnostics
      .filter(d => d && typeof d === 'object' && typeof (/** @type {any} */ (d).message) === 'string')
      .map(d => {
        const dd = /** @type {{ level?: unknown, message: string }} */ (d)
        return { level: dd.level === 'warn' ? 'warn' : 'info', message: dd.message }
      })
  }
  return diagnostics.length > 0 ? { violations, diagnostics } : { violations }
}

/**
 * Запускає detector одного concern-а. Завантажує `main.mjs`, викликає `lint(ctx)`,
 * нормалізує результат. Кидає `DetectorError` при будь-якій аномалії (→ exit 2).
 * @param {ConcernMeta} concern
 * @param {LintContext} ctx
 * @returns {Promise<LintResult>}
 */
export async function runConcernDetector(concern, ctx) {
  const mainPath = join(concern.dir, 'main.mjs')
  if (!existsSync(mainPath)) {
    throw new DetectorError(ctx.ruleId, ctx.concernId, 'немає main.mjs')
  }
  let mod
  try {
    // file:// URL — інакше відносний шлях трактується як bare package specifier
    // eslint-disable-next-line no-unsanitized/method
    mod = await import(pathToFileURL(mainPath).href)
  } catch (err) {
    throw new DetectorError(ctx.ruleId, ctx.concernId, `import впав: ${err.message}`)
  }
  if (typeof mod.lint !== 'function') {
    throw new DetectorError(ctx.ruleId, ctx.concernId, 'main.mjs не експортує lint(ctx)')
  }
  let raw
  try {
    raw = await mod.lint(ctx)
  } catch (err) {
    throw new DetectorError(ctx.ruleId, ctx.concernId, `lint() кинув: ${err.message}`)
  }
  return normalizeResult(raw, ctx)
}

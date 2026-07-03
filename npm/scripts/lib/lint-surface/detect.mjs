/**
 * Detect-крок unified lint surface: запуск одного concern-detector-а і нормалізація
 * його `LintResult`. Detector — read-only; тут немає LLM, autofix чи мутацій дерева.
 * @typedef {import('./types.mjs').LintContext} LintContext
 * @typedef {import('./types.mjs').LintResult} LintResult
 * @typedef {import('./types.mjs').LintViolation} LintViolation
 * @typedef {import('./types.mjs').LintDiagnostic} LintDiagnostic
 * @typedef {import('../concern-meta.mjs').ConcernMeta} ConcernMeta
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { hasResolvableFiles, isGeneratedFile } from './codegen-opa-wrapper.mjs'
import { evaluatePolicyConcern } from './policy-lint-adapter.mjs'

/**
 * Сигнал, що detector кинув виняток / повернув невалідний результат → exit 2.
 */
export class DetectorError extends Error {
  /**
   * @param {string} ruleId id правила, у контексті якого стався збій
   * @param {string} concernId id concern-а, у контексті якого стався збій
   * @param {string} detail деталізація причини збою для повідомлення
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
 * @param {unknown} raw сире порушення від detector-а
 * @param {LintContext} ctx контекст лінту (джерело ruleId/concernId)
 * @returns {LintViolation} нормалізоване порушення
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
 * @param {unknown} raw сирий результат виклику lint()
 * @param {LintContext} ctx контекст лінту (джерело ruleId/concernId)
 * @returns {LintResult} нормалізований результат із violations (і diagnostics)
 */
function normalizeResult(raw, ctx) {
  if (
    typeof raw !== 'object' ||
    raw === null ||
    !Array.isArray(/** @type {Record<string, unknown>} */ (raw).violations)
  ) {
    throw new DetectorError(ctx.ruleId, ctx.concernId, 'lint() має повернути { violations: [...] }')
  }
  const r = /** @type {{ violations: unknown[], diagnostics?: unknown[] }} */ (raw)
  const violations = r.violations.map(v => normalizeViolation(v, ctx))
  /** @type {LintDiagnostic[]} */
  let diagnostics = []
  if (Array.isArray(r.diagnostics)) {
    diagnostics = r.diagnostics
      .filter(
        d => d && typeof d === 'object' && typeof (/** @type {Record<string, unknown>} */ (d).message) === 'string'
      )
      .map(d => {
        const dd = /** @type {{ level?: unknown, message: string }} */ (d)
        return { level: dd.level === 'warn' ? 'warn' : 'info', message: dd.message }
      })
  }
  return diagnostics.length > 0 ? { violations, diagnostics } : { violations }
}

/**
 * Чи має concern ручний (не-`@generated`) `main.mjs`, що перекриває policy-adapter.
 * @param {string} mainPath абсолютний шлях до `main.mjs` concern-а.
 * @returns {boolean} true, якщо файл існує і не є codegen-артефактом.
 */
function hasHandWrittenMain(mainPath) {
  if (!existsSync(mainPath)) return false
  return !isGeneratedFile(readFileSync(mainPath, 'utf8'))
}

/**
 * Запускає detector одного concern-а і нормалізує результат. Кидає `DetectorError`
 * при будь-якій аномалії (→ exit 2).
 *
 * Чисті policy-concern-и (rego/template, без ручного `main.mjs`) оцінюються напряму
 * через `evaluatePolicyConcern` з даних `concern.json` — генерований `main.mjs`
 * для них не потрібен. Ручний (не-`@generated`) `main.mjs` — escape-hatch, він
 * завжди має пріоритет. Concern-и без policy й без main.mjs — помилка конфігурації.
 * @param {ConcernMeta} concern метадані concern-а, чий detector запускаємо
 * @param {LintContext} ctx контекст лінту, що передається у lint()
 * @returns {Promise<LintResult>} нормалізований результат detector-а
 */
export async function runConcernDetector(concern, ctx) {
  const mainPath = join(concern.dir, 'main.mjs')

  if (!hasHandWrittenMain(mainPath) && concern.policy && hasResolvableFiles(concern.policy.files)) {
    let raw
    try {
      raw = await evaluatePolicyConcern(ctx, {
        engine: concern.policy.engine,
        policyDir: concern.dir,
        files: concern.policy.files,
        missingMessage: concern.policy.missingMessage
      })
    } catch (error) {
      throw new DetectorError(ctx.ruleId, ctx.concernId, `policy-adapter кинув: ${error.message}`)
    }
    return normalizeResult(raw, ctx)
  }

  if (!existsSync(mainPath)) {
    throw new DetectorError(ctx.ruleId, ctx.concernId, 'немає main.mjs')
  }
  let mod
  try {
    // file:// URL — інакше відносний шлях трактується як bare package specifier
    // eslint-disable-next-line no-unsanitized/method
    mod = await import(pathToFileURL(mainPath).href)
  } catch (error) {
    throw new DetectorError(ctx.ruleId, ctx.concernId, `import впав: ${error.message}`)
  }
  if (typeof mod.lint !== 'function') {
    throw new DetectorError(ctx.ruleId, ctx.concernId, 'main.mjs не експортує lint(ctx)')
  }
  let raw
  try {
    raw = await mod.lint(ctx)
  } catch (error) {
    throw new DetectorError(ctx.ruleId, ctx.concernId, `lint() кинув: ${error.message}`)
  }
  return normalizeResult(raw, ctx)
}

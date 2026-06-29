/**
 * Єдиний renderer unified lint surface. Detector-и НЕ друкують основний violation-report —
 * вони повертають `LintResult`, а runner рендерить тут. Це гарантує однаковий вигляд
 * для всіх concern-ів і єдину точку форматування.
 *
 * @typedef {import('./types.mjs').LintViolation} LintViolation
 * @typedef {import('./types.mjs').LintDiagnostic} LintDiagnostic
 */

/**
 * @param {LintViolation} v
 * @returns {string}
 */
function formatViolation(v) {
  const mark = v.severity === 'warn' ? '⚠' : '❌'
  const loc = v.file ? ` ${v.file}` : ''
  return `  ${mark} ${v.ruleId}/${v.concernId}${loc} (${v.reason}): ${v.message}`
}

/**
 * Рендерить порушення згруповані за concern-ом. Повертає текст (не друкує сам).
 * @param {LintViolation[]} violations
 * @returns {string}
 */
export function renderViolations(violations) {
  if (violations.length === 0) return ''
  /** @type {Map<string, LintViolation[]>} */
  const byConcern = new Map()
  for (const v of violations) {
    const key = `${v.ruleId}/${v.concernId}`
    const arr = byConcern.get(key)
    if (arr) arr.push(v)
    else byConcern.set(key, [v])
  }
  const blocks = []
  for (const [key, vs] of byConcern) {
    blocks.push(`${key} — ${vs.length} порушення:`)
    for (const v of vs) blocks.push(formatViolation(v))
  }
  return blocks.join('\n') + '\n'
}

/**
 * Рендерить diagnostics (тех. інфа) — лише у verbose.
 * @param {LintDiagnostic[]} diagnostics
 * @returns {string}
 */
export function renderDiagnostics(diagnostics) {
  if (diagnostics.length === 0) return ''
  return diagnostics.map(d => `  ${d.level === 'warn' ? '⚠' : 'ℹ'} ${d.message}`).join('\n') + '\n'
}

/**
 * Похідна exit-code семантика від фінального набору порушень.
 * 0 = немає; 1 = є; 2 — окремо для DetectorError (тут не обробляється).
 * @param {LintViolation[]} violations
 * @returns {0|1}
 */
export function exitCodeFor(violations) {
  return violations.length > 0 ? 1 : 0
}

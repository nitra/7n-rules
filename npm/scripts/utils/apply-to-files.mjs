/**
 * Спільний helper для T0-фіксерів (`fix-*.mjs`): застосовує текстовий трансформер до
 * унікальних файлів зі списку violations і пише зміни. Раніше дублювався окремо в
 * `rust/toolchain_cache`, `tauri/linux_deps`, `ga/workflows` (jscpd-клон).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * @param {import('../lib/lint-surface/types.mjs').LintViolation[]} violations порушення (джерело переліку файлів)
 * @param {import('../lib/lint-surface/types.mjs').LintContext} ctx контекст лінту (cwd, recordWrite)
 * @param {(file: string) => (content: string) => string|null} transformerFor
 *   фабрика трансформера для конкретного relative-file (дає доступ до per-file даних)
 * @returns {string[]} абсолютні шляхи змінених файлів
 */
export function applyToFiles(violations, ctx, transformerFor) {
  const files = [...new Set(violations.map(v => v.file).filter(Boolean))]
  /** @type {string[]} */
  const touchedFiles = []
  for (const rel of files) {
    const abs = join(ctx.cwd, rel)
    let content
    try {
      content = readFileSync(abs, 'utf8')
    } catch {
      continue
    }
    const next = transformerFor(rel)(content)
    if (next && next !== content) {
      ctx.recordWrite?.(abs)
      writeFileSync(abs, next)
      touchedFiles.push(abs)
    }
  }
  return touchedFiles
}

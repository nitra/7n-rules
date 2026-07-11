/**
 * Спільний хелпер T0-фіксерів: застосувати текстовий трансформер до унікальних файлів
 * із violations і записати зміни через ctx.recordWrite (rollback-механізм лінт-пайплайна).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Застосовує трансформер до унікальних файлів із violations і пише зміни.
 * @param {import('./types.mjs').LintViolation[]} violations порушення (джерело переліку файлів)
 * @param {import('./types.mjs').LintContext} ctx контекст лінту (cwd, recordWrite)
 * @param {(content: string) => string|null} transformer текстовий трансформер
 * @returns {string[]} абсолютні шляхи змінених файлів
 */
export function applyToFiles(violations, ctx, transformer) {
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
    const next = transformer(content)
    if (next && next !== content) {
      ctx.recordWrite?.(abs)
      writeFileSync(abs, next)
      touchedFiles.push(abs)
    }
  }
  return touchedFiles
}

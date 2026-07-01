/**
 * lint-поверхня js/jscpd_duplicates: read-only detector дублікатів коду (`jscpd`).
 * Кожен клон → одне порушення (anchored на `firstFile`), із посиланням на `secondFile`
 * у `data`. JSON-звіт пишеться у системний tmp (поза репо) — дерево не мутується.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * @typedef {{ name: string, start: number, end: number }} JscpdFileRef
 * @typedef {{ firstFile: JscpdFileRef, secondFile: JscpdFileRef, lines: number, format: string }} JscpdClone
 */

/**
 * Один клон → LintViolation.
 * @param {JscpdClone} clone дубльований фрагмент
 * @returns {import('../../../scripts/lib/lint-surface/types.mjs').LintViolation} нормалізоване порушення
 */
function cloneToViolation(clone) {
  const a = clone.firstFile
  const b = clone.secondFile
  const aLoc = `${a.name}:${a.start}-${a.end}`
  const bLoc = `${b.name}:${b.start}-${b.end}`
  return /** @type {any} */ ({
    reason: 'duplicate-clone',
    message: `jscpd: дубльований фрагмент (${clone.lines} рядків, ${clone.format}) ${aLoc} ↔ ${bLoc}`,
    file: a.name,
    data: {
      line: a.start,
      lines: clone.lines,
      format: clone.format,
      first: { file: a.name, start: a.start, end: a.end },
      second: { file: b.name, start: b.start, end: b.end }
    }
  })
}

/**
 * Detector js/jscpd_duplicates: дублікати коду через `jscpd` (read-only).
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінту
 * @returns {import('../../../scripts/lib/lint-surface/types.mjs').LintResult} перелік порушень
 */
export function lint(ctx) {
  const cwd = ctx.cwd
  const outDir = mkdtempSync(join(tmpdir(), 'jscpd-'))
  try {
    const r = spawnSync('bunx', ['jscpd', '.', '--reporters', 'json', '--output', outDir, '--silent'], {
      cwd,
      encoding: 'utf8'
    })
    let report
    try {
      report = JSON.parse(readFileSync(join(outDir, 'jscpd-report.json'), 'utf8'))
    } catch {
      // jscpd не зміг сформувати звіт (інструмент відсутній / краш) — пропускаємо
      const detail = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().slice(0, 500)
      const suffix = detail ? `: ${detail}` : ''
      return {
        violations: [],
        diagnostics: [{ level: 'warn', message: `jscpd: не вдалося прочитати JSON-звіт${suffix}` }]
      }
    }
    const clones = Array.isArray(report.duplicates) ? report.duplicates : []
    return { violations: clones.map(clone => cloneToViolation(clone)) }
  } finally {
    rmSync(outDir, { recursive: true, force: true })
  }
}

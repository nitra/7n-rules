/** @see ./docs/lint-findings.md */
import { isAbsolute, relative } from 'node:path'

import { isIntroducedLine } from '@7n/rules/scripts/lib/diff-added-lines.mjs'

/**
 * @param {string} jsonText вивід `oxlint --format=json`
 * @returns {{ file: string, line: number, rule: string, message: string, tool: string }[] | null} findings,
 *   або `null` якщо json непарсабельний (краш/обрізаний вивід інструмента — НЕ «чисто»)
 */
export function parseOxlint(jsonText) {
  let data
  try {
    data = JSON.parse(jsonText)
  } catch {
    return null
  }
  const diags = Array.isArray(data?.diagnostics) ? data.diagnostics : []
  return diags
    .filter(d => d?.filename)
    .map(d => ({
      file: d.filename,
      line: d.labels?.[0]?.span?.line ?? 0,
      rule: d.code ?? '',
      message: d.message ?? '',
      tool: 'oxlint'
    }))
}

/**
 * @param {string} jsonText вивід `eslint --format=json`
 * @returns {{ file: string, line: number, rule: string, message: string, tool: string }[] | null} findings,
 *   або `null` якщо json непарсабельний (краш/обрізаний вивід інструмента — НЕ «чисто»)
 */
export function parseEslint(jsonText) {
  let data
  try {
    data = JSON.parse(jsonText)
  } catch {
    return null
  }
  const results = Array.isArray(data) ? data : []
  const out = []
  for (const r of results) {
    for (const m of r?.messages ?? []) {
      out.push({
        file: r.filePath,
        line: m.line ?? 0,
        rule: m.ruleId ?? '(syntax)',
        message: m.message ?? '',
        tool: 'eslint'
      })
    }
  }
  return out.filter(f => f.file)
}

/**
 * Конвертує результати ESLint programmatic API у нормалізовані findings.
 * @param {import('eslint').ESLint.LintResult[]} results результати `eslint.lintFiles()`
 * @returns {{ file: string, line: number, rule: string, message: string, tool: string }[]} findings
 */
export function eslintResultsToFindings(results) {
  const out = []
  for (const r of results) {
    for (const m of r.messages) {
      out.push({
        file: r.filePath,
        line: m.line ?? 0,
        rule: m.ruleId ?? '(syntax)',
        message: m.message ?? '',
        tool: 'eslint'
      })
    }
  }
  return out.filter(f => f.file)
}

/**
 * Розділяє findings на introduced / pre-existing за доданими рядками.
 * @param {{ file: string, line: number }[]} findings нормалізовані findings
 * @param {Map<string, Set<number> | string>} addedLines з `addedLinesByFile`
 * @param {string} [cwd] корінь (для нормалізації абсолютних шляхів у relative)
 * @returns {{ introduced: object[], preExisting: object[] }} класифікація
 */
export function classifyFindings(findings, addedLines, cwd = process.cwd()) {
  const introduced = []
  const preExisting = []
  for (const f of findings) {
    const rel = isAbsolute(f.file) ? relative(cwd, f.file) : f.file
    if (isIntroducedLine(addedLines, rel, f.line)) introduced.push(f)
    else preExisting.push(f)
  }
  return { introduced, preExisting }
}

/**
 * Рядок одного finding: `<rel>:<line>  <rule>  <message>`.
 * @param {{ file: string, line: number, rule: string, message: string }} f finding
 * @param {string} cwd корінь
 * @returns {string} рядок
 */
function formatFinding(f, cwd) {
  const rel = isAbsolute(f.file) ? relative(cwd, f.file) : f.file
  return `     ${rel}:${f.line}  ${f.rule}  ${f.message}`
}

/**
 * Згрупований звіт: 🆕 introduced (виправ) + 🗄 pre-existing (борг файлу).
 * @param {{ introduced: object[], preExisting: object[] }} classified результат `classifyFindings`
 * @param {string} [cwd] корінь
 * @returns {string} текст звіту
 */
export function renderFindings({ introduced, preExisting }, cwd = process.cwd()) {
  const lines = []
  if (introduced.length > 0) {
    lines.push(`  🆕 introduced (${introduced.length}) — внесено цією зміною, виправ:`)
    for (const f of introduced) lines.push(formatFinding(f, cwd))
  }
  if (preExisting.length > 0) {
    lines.push(`  🗄 pre-existing (${preExisting.length}) — борг файлу, не з цієї зміни:`)
    for (const f of preExisting) lines.push(formatFinding(f, cwd))
  }
  return lines.join('\n')
}

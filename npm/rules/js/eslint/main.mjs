/**
 * lint-поверхня js/eslint: read-only detector (oxlint + eslint). Fix (oxlint --fix /
 * eslint --fix) — окремий T0 `fix-eslint.mjs` (детермінований), не в detector-і.
 */
import { resolve, relative } from 'node:path'
import { spawnSync } from 'node:child_process'

import { ESLint } from 'eslint'

import { addedLinesByFile } from '../../../scripts/lib/diff-added-lines.mjs'
import { classifyFindings, eslintResultsToFindings, parseOxlint } from '../lint-findings/main.mjs'

const JS_EXT_RE = /\.(?:mjs|cjs|js|jsx|ts|tsx|vue)$/u
const JSON_MAX_BUFFER = 64 * 1024 * 1024

/**
 * @param {string[]} files список шляхів
 * @returns {string[]} лише JS-подібні файли
 */
export function filterJsFiles(files) {
  return files.filter(f => JS_EXT_RE.test(f))
}

/**
 * @param {string[]} args аргументи запуску oxlint
 * @param {string} cwd робочий каталог
 * @returns {{ status: number, stdout: string, stderr: string }} код завершення, stdout і stderr процесу
 */
function runOxlintJson(args, cwd) {
  const r = spawnSync('bunx', args, { cwd, encoding: 'utf8', maxBuffer: JSON_MAX_BUFFER })
  return { status: typeof r.status === 'number' ? r.status : 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

/**
 * Finding → LintViolation.
 * @param {{ file: string, line: number, rule: string, message: string, tool: string }} f знахідка лінтера
 * @param {string} cwd робочий каталог
 * @param {'error'|'warn'} severity рівень порушення
 * @returns {import('../../../scripts/lib/lint-surface/types.mjs').LintViolation} нормалізоване порушення
 */
function toViolation(f, cwd, severity) {
  return /** @type {import('../../../scripts/lib/lint-surface/types.mjs').LintViolation} */ ({
    reason: f.rule || `${f.tool}-error`,
    message: `${f.message} (${f.tool})`,
    file: relative(cwd, f.file).split('\\').join('/'),
    severity,
    data: { line: f.line, tool: f.tool }
  })
}

/**
 * Збирає findings (oxlint json + eslint read-only) по заданих файлах або всьому проєкту.
 * @param {string[]|null} js null → весь проєкт
 * @param {string} cwd робочий каталог
 * @returns {Promise<Array<{ file: string, line: number, rule: string, message: string, tool: string }>>} зібрані знахідки oxlint+eslint
 */
async function collectFindings(js, cwd) {
  // warnIgnored:false — файли з delta, що матчать ignore-патерни конфігу, не є порушеннями
  const eslint = new ESLint({ cwd, warnIgnored: false })
  const esResults = await eslint.lintFiles(js === null ? [cwd] : js.map(f => resolve(cwd, f)))
  const es = eslintResultsToFindings(esResults)

  const oxArgs = js === null ? ['oxlint', '--format=json'] : ['oxlint', '--format=json', ...js]
  const oxRes = runOxlintJson(oxArgs, cwd)
  const ox = parseOxlint(oxRes.stdout)
  if (ox === null && oxRes.status !== 0) {
    // Хвости stdout/stderr — інакше на CI причина крашу (OOM, конфіг, версія) невидима.
    const tail = [oxRes.stderr, oxRes.stdout]
      .map(t => t.trim().slice(-500))
      .filter(t => t !== '')
      .join('\n--- stdout: ')
    const suffix = tail === '' ? '' : `\n${tail}`
    throw new Error(`oxlint завершився з помилкою (exit ${oxRes.status}, не lint-порушення) — json не розпарсено${suffix}`)
  }
  return [...(ox ?? []), ...es]
}

/**
 * Detector js/eslint: per-file (classify introduced/pre-existing) або full-project.
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінту
 * @returns {Promise<import('../../../scripts/lib/lint-surface/types.mjs').LintResult>} перелік порушень
 */
export async function lint(ctx) {
  const { cwd, files } = ctx

  if (files === undefined) {
    const findings = await collectFindings(null, cwd)
    return { violations: findings.map(f => toViolation(f, cwd, 'error')) }
  }

  const js = filterJsFiles(files)
  if (js.length === 0) return { violations: [] }

  const findings = await collectFindings(js, cwd)
  if (findings.length === 0) return { violations: [] }

  // introduced (на доданих рядках) → error; pre-existing → warn.
  const classified = classifyFindings(findings, addedLinesByFile(js, cwd), cwd)
  return {
    violations: [
      ...classified.introduced.map(f => toViolation(f, cwd, 'error')),
      ...classified.preExisting.map(f => toViolation(f, cwd, 'warn'))
    ]
  }
}

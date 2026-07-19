/**
 * lint-поверхня js/eslint: read-only detector (oxlint + eslint). Fix (oxlint --fix /
 * eslint --fix) — окремий T0 `fix-eslint.mjs` (детермінований), не в detector-і.
 */
import { resolve, relative } from 'node:path'

import { ESLint } from 'eslint'

import { addedLinesByFile } from '@7n/rules/scripts/lib/diff-added-lines.mjs'
import { spawnAsync } from '@7n/rules/scripts/utils/spawn-async.mjs'
import { WORKTREE_CHECKOUT_GLOBS } from '@7n/rules/scripts/utils/walkDir.mjs'
import { classifyFindings, eslintResultsToFindings, parseOxlint } from '../lint-findings/main.mjs'

const JS_EXT_RE = /\.(?:mjs|cjs|js|jsx|ts|tsx|vue)$/u

/**
 * @param {string[]} files список шляхів
 * @returns {string[]} лише JS-подібні файли
 */
export function filterJsFiles(files) {
  return files.filter(f => JS_EXT_RE.test(f))
}

/**
 * Async (не блокує event loop) — детектор може виконуватись у parallel lane `detectAll()`
 * (ADR 260716-1354).
 * @param {string[]} args аргументи запуску oxlint
 * @param {string} cwd робочий каталог
 * @returns {Promise<{ status: number, stdout: string, stderr: string }>} код завершення, stdout і stderr процесу
 */
async function runOxlintJson(args, cwd) {
  const r = await spawnAsync('bunx', args, { cwd })
  return { status: typeof r.exitCode === 'number' ? r.exitCode : 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

/**
 * Finding → LintViolation.
 * @param {{ file: string, line: number, rule: string, message: string, tool: string }} f знахідка лінтера
 * @param {string} cwd робочий каталог
 * @param {'error'|'warn'} severity рівень порушення
 * @returns {import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintViolation} нормалізоване порушення
 */
function toViolation(f, cwd, severity) {
  return /** @type {import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintViolation} */ ({
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
  // warnIgnored:false — файли з delta, що матчать ignore-патерни конфігу, не є порушеннями.
  // overrideConfig лише з ignores → global ignores: worktree-чекаути (.worktrees/,
  // .claude/worktrees/) — копії репо, споживацький eslint-конфіг їх не виключає.
  const eslint = new ESLint({ cwd, warnIgnored: false, overrideConfig: { ignores: WORKTREE_CHECKOUT_GLOBS } })
  const esResults = await eslint.lintFiles(js === null ? [cwd] : js.map(f => resolve(cwd, f)))
  const es = eslintResultsToFindings(esResults)

  const worktreeIgnoreArgs = WORKTREE_CHECKOUT_GLOBS.map(g => `--ignore-pattern=${g}`)
  const oxArgs =
    js === null
      ? ['oxlint', '--format=json', ...worktreeIgnoreArgs]
      : ['oxlint', '--format=json', ...worktreeIgnoreArgs, ...js]
  const oxRes = await runOxlintJson(oxArgs, cwd)
  const ox = parseOxlint(oxRes.stdout)
  if (ox === null && oxRes.status !== 0) {
    // Хвости stdout/stderr — інакше на CI причина крашу (OOM, конфіг, версія) невидима.
    const tail = [oxRes.stderr, oxRes.stdout]
      .map(t => t.trim().slice(-500))
      .filter(t => t !== '')
      .join('\n--- stdout: ')
    const suffix = tail === '' ? '' : `\n${tail}`
    throw new Error(
      `oxlint завершився з помилкою (exit ${oxRes.status}, не lint-порушення) — json не розпарсено${suffix}`
    )
  }
  return [...(ox ?? []), ...es]
}

/**
 * Detector js/eslint: per-file (classify introduced/pre-existing) або full-project.
 * @param {import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінту
 * @returns {Promise<import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintResult>} перелік порушень
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

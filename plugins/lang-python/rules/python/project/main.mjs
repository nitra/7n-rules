/**
 * lint-поверхня python/project: read-only detector (`uv lock --check` + `uv sync --frozen` +
 * `pip-licenses`), перейменовано з колишнього bundled `python/check` (spec
 * docs/specs/2026-07-02-text-check-per-file-split-design.md §5-A). `full`, без `lint.glob` —
 * lockfile-аудит і ліцензійна перевірка project-wide за природою, не входять у delta-план
 * (§5): спрацьовують лише через `n-rules lint --full` або scoped `n-rules lint python`.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { createViolationReporter } from '@7n/rules/scripts/lib/lint-surface/violation-reporter.mjs'
import { resolveCmd } from '@7n/rules/scripts/utils/resolve-cmd.mjs'
import { spawnAsync } from '@7n/rules/scripts/utils/spawn-async.mjs'
import { getBronzeAndAbove, isSpdxAllowed } from '@7n/rules/scripts/lib/blue-oak.mjs'

/**
 * Async (не блокує event loop) — детектор може виконуватись у parallel lane `detectAll()`
 * (ADR 260716-1354).
 * @param {string} label назва кроку.
 * @param {string} cmd команда для запуску.
 * @param {string[]} args аргументи команди.
 * @param {string} cwd робочий каталог.
 * @param {(msg: string, reason: string) => void} fail колбек реєстрації порушення.
 * @param {string} reason машиночитна причина порушення.
 * @returns {Promise<boolean>} true якщо OK
 */
async function runTool(label, cmd, args, cwd, fail, reason) {
  const r = await spawnAsync(cmd, args, { cwd })
  if (r.exitCode === 0) return true
  const code = typeof r.exitCode === 'number' ? r.exitCode : 1
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().slice(0, 2000)
  const outSuffix = out ? `\n${out}` : ''
  fail(`lint-python: ${label} — помилка (код ${code}, python.mdc)${outSuffix}`, reason)
  return false
}

/**
 * Async (не блокує event loop) — детектор може виконуватись у parallel lane `detectAll()`
 * (ADR 260716-1354).
 * @param {string} uv шлях до бінарника uv.
 * @param {string} tool ім'я інструменту в uv-середовищі.
 * @returns {Promise<boolean>} true якщо інструмент доступний
 */
async function uvToolAvailable(uv, tool) {
  const r = await spawnAsync(uv, ['run', '--frozen', tool, '--version'])
  return r.exitCode === 0
}

/**
 * Перевірка ліцензій залежностей через pip-licenses (read-only).
 * Async (не блокує event loop) — детектор може виконуватись у parallel lane `detectAll()`
 * (ADR 260716-1354).
 * @param {string} uv шлях до бінарника uv.
 * @param {string} cwd робочий каталог.
 * @param {(msg: string, reason: string) => void} fail колбек реєстрації порушення.
 * @returns {Promise<boolean>} true якщо OK / пропущено
 */
async function checkPipLicenses(uv, cwd, fail) {
  if (!(await uvToolAvailable(uv, 'pip-licenses'))) return true // недоступний → пропущено
  const r = await spawnAsync(uv, ['run', '--frozen', 'pip-licenses', '--from=mixed', '--format=spdx-json'], {
    cwd
  })
  if (r.exitCode !== 0) {
    fail('lint-python: pip-licenses — помилка виконання', 'pip-licenses-error')
    return false
  }
  const allowed = getBronzeAndAbove()
  let doc
  try {
    doc = JSON.parse(r.stdout)
  } catch {
    doc = null
  }
  const packages = doc?.packages ?? []
  const violations = packages.filter(pkg => {
    const lic = pkg.licenseDeclared ?? pkg.licenseConcluded ?? 'NOASSERTION'
    return !isSpdxAllowed(lic, allowed)
  })
  if (violations.length > 0) {
    const list = violations
      .map(
        pkg =>
          `  ✗ ${pkg.name}@${pkg.versionInfo ?? '?'}: ${pkg.licenseDeclared ?? pkg.licenseConcluded ?? 'NOASSERTION'}`
      )
      .join('\n')
    fail(
      `lint-python: pip-licenses — ${violations.length} пакет(ів) поза Blue Oak Bronze+ (python.mdc)\n${list}`,
      'license-violation'
    )
    return false
  }
  return true
}

/**
 * Detector python/project (read-only).
 * Async (не блокує event loop) — детектор може виконуватись у parallel lane `detectAll()`
 * (ADR 260716-1354).
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінту.
 * @returns {Promise<import('../../../scripts/lib/lint-surface/types.mjs').LintResult>} результат із порушеннями
 */
export async function lint(ctx) {
  const reporter = createViolationReporter(ctx)
  const { fail } = reporter
  const cwd = ctx.cwd

  if (!existsSync(join(cwd, 'pyproject.toml'))) return reporter.result()

  const uv = resolveCmd('uv')
  if (!uv) {
    fail('lint-python: `uv` не знайдено в PATH (потрібен при наявному pyproject.toml, python.mdc)', 'uv-missing')
    return reporter.result()
  }

  if (!(await runTool('uv lock --check', uv, ['lock', '--check'], cwd, fail, 'uv-lock-violation'))) {
    return reporter.result()
  }
  if (!(await runTool('uv sync --frozen', uv, ['sync', '--frozen'], cwd, fail, 'uv-sync-violation'))) {
    return reporter.result()
  }

  await checkPipLicenses(uv, cwd, fail)

  return reporter.result()
}

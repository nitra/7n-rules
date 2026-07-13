/**
 * lint-поверхня python/project: read-only detector (`uv lock --check` + `uv sync --frozen` +
 * `pip-licenses`), перейменовано з колишнього bundled `python/check` (spec
 * docs/specs/2026-07-02-text-check-per-file-split-design.md §5-A). `full`, без `lint.glob` —
 * lockfile-аудит і ліцензійна перевірка project-wide за природою, не входять у delta-план
 * (§5): спрацьовують лише через `n-rules lint --full` або scoped `n-rules lint python`.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { createViolationReporter } from '../../../scripts/lib/lint-surface/violation-reporter.mjs'
import { resolveCmd } from '../../../scripts/utils/resolve-cmd.mjs'
import { getBronzeAndAbove, isSpdxAllowed } from '../../../scripts/lib/blue-oak.mjs'

/**
 * @param {string} label назва кроку.
 * @param {string} cmd команда для запуску.
 * @param {string[]} args аргументи команди.
 * @param {string} cwd робочий каталог.
 * @param {(msg: string, reason: string) => void} fail колбек реєстрації порушення.
 * @param {string} reason машиночитна причина порушення.
 * @returns {boolean} true якщо OK
 */
function runTool(label, cmd, args, cwd, fail, reason) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', shell: false })
  if (r.status === 0) return true
  const code = typeof r.status === 'number' ? r.status : 1
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().slice(0, 2000)
  const outSuffix = out ? `\n${out}` : ''
  fail(`lint-python: ${label} — помилка (код ${code}, python.mdc)${outSuffix}`, reason)
  return false
}

/**
 * @param {string} uv шлях до бінарника uv.
 * @param {string} tool ім'я інструменту в uv-середовищі.
 * @returns {boolean} true якщо інструмент доступний
 */
function uvToolAvailable(uv, tool) {
  const r = spawnSync(uv, ['run', '--frozen', tool, '--version'], { stdio: 'ignore', shell: false })
  return r.status === 0
}

/**
 * Перевірка ліцензій залежностей через pip-licenses (read-only).
 * @param {string} uv шлях до бінарника uv.
 * @param {string} cwd робочий каталог.
 * @param {(msg: string, reason: string) => void} fail колбек реєстрації порушення.
 * @returns {boolean} true якщо OK / пропущено
 */
function checkPipLicenses(uv, cwd, fail) {
  if (!uvToolAvailable(uv, 'pip-licenses')) return true // недоступний → пропущено
  const r = spawnSync(uv, ['run', '--frozen', 'pip-licenses', '--from=mixed', '--format=spdx-json'], {
    cwd,
    encoding: 'utf8',
    shell: false
  })
  if (r.status !== 0) {
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
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінту.
 * @returns {import('../../../scripts/lib/lint-surface/types.mjs').LintResult} результат із порушеннями
 */
export function lint(ctx) {
  const reporter = createViolationReporter(ctx)
  const { fail } = reporter
  const cwd = ctx.cwd

  if (!existsSync(join(cwd, 'pyproject.toml'))) return reporter.result()

  const uv = resolveCmd('uv')
  if (!uv) {
    fail('lint-python: `uv` не знайдено в PATH (потрібен при наявному pyproject.toml, python.mdc)', 'uv-missing')
    return reporter.result()
  }

  if (!runTool('uv lock --check', uv, ['lock', '--check'], cwd, fail, 'uv-lock-violation')) return reporter.result()
  if (!runTool('uv sync --frozen', uv, ['sync', '--frozen'], cwd, fail, 'uv-sync-violation')) return reporter.result()

  checkPipLicenses(uv, cwd, fail)

  return reporter.result()
}

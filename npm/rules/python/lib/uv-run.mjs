/**
 * Спільний preflight обох python-детекторів (`mypy`, `ruff`) — обидва per-file: приймають
 * `ctx.files`, інакше `.` (весь проєкт), обидва йдуть через `uv run --frozen`. Виділено зі
 * спільного дубльованого коду (jscpd) обох `main.mjs`.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { resolveCmd } from '../../../scripts/utils/resolve-cmd.mjs'
import { spawnAsync } from '../../../scripts/utils/spawn-async.mjs'

/** Розширення `.py` — фільтр delta-списку файлів у `lint(ctx)`. */
export const PY_EXT_RE = /\.py$/u

/**
 * Async (не блокує event loop) — детектор може виконуватись у parallel lane `detectAll()`
 * (ADR 260716-1354).
 * @param {string} uv шлях до бінарника uv.
 * @param {string} tool ім'я інструменту в uv-середовищі.
 * @returns {Promise<boolean>} true якщо інструмент доступний
 */
export async function uvToolAvailable(uv, tool) {
  const r = await spawnAsync(uv, ['run', '--frozen', tool, '--version'])
  return r.exitCode === 0
}

/**
 * Спільний preflight: pyproject.toml, delta/full-цілі, резолв `uv`, доступність `tool` у
 * uv-середовищі. Викликач рано виходить (`reporter.result()`), коли повертається `null` —
 * `fail()` для випадку відсутнього `uv` уже викликаний усередині.
 * Async (не блокує event loop) — детектор може виконуватись у parallel lane `detectAll()`
 * (ADR 260716-1354).
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінту.
 * @param {(msg: string, opts: object) => void} fail колбек реєстрації порушення.
 * @param {string} tool ім'я інструменту (`mypy`|`ruff`) для перевірки доступності.
 * @returns {Promise<{uv: string, targets: string[]}|null>} preflight-результат, або null (рано вийти).
 */
export async function preparePythonRun(ctx, fail, tool) {
  if (!existsSync(join(ctx.cwd, 'pyproject.toml'))) return null

  const targets = ctx.files === undefined ? ['.'] : ctx.files.filter(f => PY_EXT_RE.test(f))
  if (targets.length === 0) return null

  const uv = resolveCmd('uv')
  if (!uv) {
    fail('lint-python: `uv` не знайдено в PATH (потрібен при наявному pyproject.toml, python.mdc)', 'uv-missing')
    return null
  }
  if (!(await uvToolAvailable(uv, tool))) return null // tool недоступний у uv-середовищі → пропущено

  return { uv, targets }
}

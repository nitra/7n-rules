/**
 * Запуск `lint-python` за правилом python.mdc на базі [uv](https://docs.astral.sh/uv/).
 *
 * Якщо `pyproject.toml` у корені відсутній — вихід 0 без запуску інструментів.
 * Якщо `pyproject.toml` є, але `uv` не знайдено в PATH — це помилка (uv — єдиний
 * пакет-менеджер, без Poetry).
 *
 * Обовʼязкові кроки (uv):
 *  - `uv lock --check` — lock-файл актуальний щодо `pyproject.toml`;
 *  - `uv sync --frozen` — середовище зібране строго з `uv.lock`.
 *
 * Опційні лінтери запускаються лише якщо доступні через `uv run` (інакше крок
 * пропускається з повідомленням, як optional vendor-tools у php.mdc). `ruff`
 * запускається в auto-fix-режимі (мутує робоче дерево, як `markdownlint-cli2 --fix`
 * у lint-text / `clippy --fix` у lint-rust):
 *  - `uv run ruff check --fix .`
 *  - `uv run ruff format .`
 *  - `uv run mypy .`
 *
 * Канон патерну `lint-*` (серіалізація через `runStandardLint`, без прямого `withLock`) —
 * `.cursor/rules/scripts.mdc`, секція «Серіалізація важких CLI-команд».
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { isRunAsCli } from '../../../scripts/cli-entry.mjs'
import { createCheckReporter } from '../../../scripts/lib/check-reporter.mjs'
import { resolveCmd } from '../../../scripts/utils/resolve-cmd.mjs'
import { runStandardLint } from '../../../scripts/lib/run-standard-lint.mjs'

/**
 * Запускає CLI-крок і репортить результат.
 * @param {string} label назва кроку для повідомлень
 * @param {string} cmd абсолютний шлях до CLI
 * @param {string[]} args аргументи
 * @param {(msg: string) => void} pass callback pass
 * @param {(msg: string) => void} fail callback fail
 * @returns {boolean} true якщо крок успішний
 */
function runTool(label, cmd, args, pass, fail) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: false })
  if (r.status === 0) {
    pass(`lint-python: ${label} — OK`)
    return true
  }
  const code = typeof r.status === 'number' ? r.status : 1
  fail(`lint-python: ${label} — помилка (код ${code}, python.mdc)`)
  return false
}

/**
 * Чи доступний інструмент усередині uv-середовища (`uv run --frozen <tool> --version`).
 * @param {string} uv абсолютний шлях до `uv`
 * @param {string} tool назва бінарника (`ruff`, `mypy`)
 * @returns {boolean} true якщо інструмент відповідає на `--version`
 */
function uvToolAvailable(uv, tool) {
  const r = spawnSync(uv, ['run', '--frozen', tool, '--version'], { stdio: 'ignore', shell: false })
  return r.status === 0
}

/**
 * Внутрішні кроки `lint-python` без локу.
 * @param {string} [cwd] корінь репозиторію
 * @returns {number} 0 — OK, 1 — є помилки
 */
export function runLintPythonSteps(cwd = process.cwd()) {
  const reporter = createCheckReporter()
  const { pass, fail } = reporter

  if (!existsSync(join(cwd, 'pyproject.toml'))) {
    pass('lint-python: немає pyproject.toml у корені — кроки Python пропущено')
    return reporter.getExitCode()
  }

  const uv = resolveCmd('uv')
  if (!uv) {
    fail('lint-python: `uv` не знайдено в PATH (потрібен при наявному pyproject.toml, python.mdc)')
    return reporter.getExitCode()
  }

  if (!runTool('uv lock --check', uv, ['lock', '--check'], pass, fail)) return reporter.getExitCode()
  if (!runTool('uv sync --frozen', uv, ['sync', '--frozen'], pass, fail)) return reporter.getExitCode()

  /**
   * Запускає лінтер через `uv run`, якщо він доступний у середовищі.
   * @param {string} tool назва бінарника
   * @param {string} label назва кроку
   * @param {string[]} args аргументи інструмента
   * @returns {boolean} true, якщо крок успішний або пропущений
   */
  function runOptionalUvTool(tool, label, args) {
    if (!uvToolAvailable(uv, tool)) {
      pass(`lint-python: ${tool} недоступний у uv-середовищі — крок пропущено`)
      return true
    }
    return runTool(label, uv, ['run', '--frozen', tool, ...args], pass, fail)
  }

  if (!runOptionalUvTool('ruff', 'ruff check --fix', ['check', '--fix', '.'])) return reporter.getExitCode()
  if (!runOptionalUvTool('ruff', 'ruff format', ['format', '.'])) return reporter.getExitCode()
  if (!runOptionalUvTool('mypy', 'mypy', ['.'])) return reporter.getExitCode()

  return reporter.getExitCode()
}

/**
 * Публічна CLI-форма: серіалізує через `withLock('lint-python')` + дедуп за станом git-дерева.
 * @returns {Promise<number>} код виходу
 */
export const runLintPython = () => runStandardLint(import.meta.dirname, runLintPythonSteps)

if (isRunAsCli(import.meta.url)) {
  process.exitCode = await runLintPython()
}

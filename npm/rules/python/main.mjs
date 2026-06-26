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

import { isRunAsCli } from '../../scripts/cli-entry.mjs'
import { createCheckReporter } from '../../scripts/lib/check-reporter.mjs'
import { resolveCmd } from '../../scripts/utils/resolve-cmd.mjs'
import { runStandardLint } from '../../scripts/lib/run-standard-lint.mjs'
import { runRuleCli } from '../../scripts/lib/run-rule-cli.mjs'
import { runStandardRule } from '../../scripts/lib/run-standard-rule.mjs'
import { getBronzeAndAbove, isSpdxAllowed } from '../../scripts/lib/blue-oak.mjs'

/**
 * Єдиний entrypoint правила (ADR 2026-06-21). `run()` — check-поверхня (applies → JS-concerns
 * → policy → mdc-refs); `lint()` нижче — lint-поверхня (uv/ruff/mypy), імпл інлайн тут.
 * @param {import('../../scripts/lib/run-standard-rule.mjs').RuleContext} [ctx] контекст прогону
 * @returns {Promise<number>} 0 — OK, 1 — порушення
 */
export function run(ctx) {
  return runStandardRule(import.meta.dirname, ctx)
}

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
 * @param {{ readOnly?: boolean }} [opts] readOnly → `ruff` без `--fix`, `ruff format --check` (нуль мутацій, CI/детект)
 * @returns {number} 0 — OK, 1 — є помилки
 */
export function runLintPythonSteps(cwd = process.cwd(), opts = {}) {
  const readOnly = opts.readOnly === true
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

  /**
   * Перевірка ліцензій Python-залежностей через pip-licenses + Blue Oak Bronze+.
   * Opt-in: пропускається якщо pip-licenses не встановлений у uv-середовищі.
   * @param {string} uvPath абсолютний шлях до uv
   * @param {string} cwdPath корінь проєкту
   * @param {(msg: string) => void} passF
   * @param {(msg: string) => void} failF
   * @returns {boolean} true якщо OK або пропущено; false якщо порушення
   */
  function checkPipLicenses(uvPath, cwdPath, passF, failF) {
    if (!uvToolAvailable(uvPath, 'pip-licenses')) {
      passF('lint-python: pip-licenses недоступний у uv-середовищі — перевірку ліцензій пропущено')
      return true
    }
    const r = spawnSync(uvPath, ['run', '--frozen', 'pip-licenses', '--from=mixed', '--format=spdx-json'], {
      cwd: cwdPath,
      stdio: ['ignore', 'pipe', 'inherit'],
      shell: false
    })
    if (r.status !== 0) {
      failF('lint-python: pip-licenses — помилка виконання')
      return false
    }
    const allowed = getBronzeAndAbove()
    let doc
    try {
      doc = JSON.parse(r.stdout.toString('utf8'))
    } catch {
      doc = null
    }
    const packages = doc?.packages ?? []
    const violations = packages.filter(pkg => {
      const lic = pkg.licenseDeclared ?? pkg.licenseConcluded ?? 'NOASSERTION'
      return !isSpdxAllowed(lic, allowed)
    })
    if (violations.length > 0) {
      for (const pkg of violations) {
        const lic = pkg.licenseDeclared ?? pkg.licenseConcluded ?? 'NOASSERTION'
        process.stdout.write(`  ✗ ${pkg.name}@${pkg.versionInfo ?? '?'}: ${lic}\n`)
      }
      failF(`lint-python: pip-licenses — ${violations.length} пакет(ів) поза Blue Oak Bronze+ (python.mdc)`)
      return false
    }
    passF(`lint-python: pip-licenses — ліцензії OK (Blue Oak Bronze+, ${packages.length} пакетів)`)
    return true
  }

  const ruffCheck = readOnly ? ['check', '.'] : ['check', '--fix', '.']
  const ruffFormat = readOnly ? ['format', '--check', '.'] : ['format', '.']
  if (!runOptionalUvTool('ruff', readOnly ? 'ruff check' : 'ruff check --fix', ruffCheck)) return reporter.getExitCode()
  if (!runOptionalUvTool('ruff', readOnly ? 'ruff format --check' : 'ruff format', ruffFormat))
    return reporter.getExitCode()
  if (!runOptionalUvTool('mypy', 'mypy', ['.'])) return reporter.getExitCode()
  if (!checkPipLicenses(uv, cwd, pass, fail)) return reporter.getExitCode()

  return reporter.getExitCode()
}

/**
 * Публічна CLI-форма: серіалізує через `withLock('lint-python')` + дедуп за станом git-дерева.
 * @param {{ readOnly?: boolean }} [opts] readOnly → детект без мутацій (проброс у кроки)
 * @returns {Promise<number>} код виходу
 */
export const runLintPython = (opts = {}) =>
  runStandardLint(import.meta.dirname, () => runLintPythonSteps(process.cwd(), opts))

/**
 * Оркестраторний адаптер `n-cursor lint python`: делегує у `runLintPython`.
 * @param {string[] | undefined} _files ігнорується (whole-project аналіз)
 * @param {string} [_cwd] корінь (CLI бере process.cwd())
 * @param {{ readOnly?: boolean }} [opts] readOnly → ruff без `--fix`, format `--check`
 * @returns {Promise<number>} exit code
 */
export function lint(_files, _cwd, opts = {}) {
  return runLintPython({ readOnly: opts.readOnly === true })
}

if (isRunAsCli(import.meta.url)) {
  // Standalone: bun rules/python/main.mjs — повний еквівалент `npx @nitra/cursor check python`.
  process.exitCode = await runRuleCli(import.meta.dirname)
}

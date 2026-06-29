/**
 * lint-поверхня python: uv/ruff/mypy/pip-licenses.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { createCheckReporter } from '../../../scripts/lib/check-reporter.mjs'
import { resolveCmd } from '../../../scripts/utils/resolve-cmd.mjs'
import { runStandardLint } from '../../../scripts/lib/run-standard-lint.mjs'
import { getBronzeAndAbove, isSpdxAllowed } from '../../../scripts/lib/blue-oak.mjs'

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

function uvToolAvailable(uv, tool) {
  const r = spawnSync(uv, ['run', '--frozen', tool, '--version'], { stdio: 'ignore', shell: false })
  return r.status === 0
}

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

  function runOptionalUvTool(tool, label, args) {
    if (!uvToolAvailable(uv, tool)) {
      pass(`lint-python: ${tool} недоступний у uv-середовищі — крок пропущено`)
      return true
    }
    return runTool(label, uv, ['run', '--frozen', tool, ...args], pass, fail)
  }

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

export const runLintPython = (opts = {}) =>
  runStandardLint(import.meta.dirname, () => runLintPythonSteps(process.cwd(), opts))

/**
 * lint-поверхня python.
 * @param {string[] | undefined} _files ігнорується
 * @param {string} [_cwd]
 * @param {{ readOnly?: boolean }} [opts]
 * @returns {Promise<number>}
 */
export function lint(_files, _cwd, opts = {}) {
  return runLintPython({ readOnly: opts.readOnly === true })
}

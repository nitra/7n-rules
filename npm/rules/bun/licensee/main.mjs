import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

import { createCheckReporter } from '../../../scripts/lib/check-reporter.mjs'
import { runStandardLint } from '../../../scripts/lib/run-standard-lint.mjs'
import { resolveCmd } from '../../../scripts/utils/resolve-cmd.mjs'

/** Дефолтний allowlist: Blue Oak bronze — дозволяє MIT/Apache/BSD/ISC, блокує GPL/AGPL/LGPL. */
const DEFAULT_LICENSEE_CONFIG = JSON.stringify({ licenses: { blueOak: 'bronze' }, corrections: true }, null, 2) + '\n'

/**
 * Перевірка ліцензій npm-залежностей через `licensee`.
 * @param {string} [cwd] корінь проєкту
 * @param {{ readOnly?: boolean }} [opts]
 * @returns {number} 0 — OK, 1 — порушення
 */
function runLicenseeSteps(cwd = process.cwd(), opts = {}) {
  const readOnly = opts.readOnly === true
  const reporter = createCheckReporter()
  const { pass, fail } = reporter

  const configPath = join(cwd, '.licensee.json')
  if (!existsSync(configPath)) {
    if (readOnly) {
      fail(
        'lint-bun: licensee — немає .licensee.json; запустіть `npx @nitra/cursor fix bun` локально для генерації (bun.mdc)'
      )
      return reporter.getExitCode()
    }
    writeFileSync(configPath, DEFAULT_LICENSEE_CONFIG, 'utf8')
    pass('lint-bun: licensee — створено .licensee.json з дефолтним allowlist (blueOak: bronze)')
  }

  const bun = resolveCmd('bun')
  if (!bun) {
    fail('lint-bun: `bun` не знайдено в PATH (bun.mdc)')
    return reporter.getExitCode()
  }

  const r = spawnSync(bun, ['x', 'licensee', '--production', '--quiet'], { cwd, stdio: 'inherit', shell: false })
  if (r.status === 0) {
    pass('lint-bun: licensee — ліцензії OK')
  } else {
    const code = typeof r.status === 'number' ? r.status : 1
    fail(`lint-bun: licensee — порушення ліцензій (код ${code}, bun.mdc)`)
  }
  return reporter.getExitCode()
}

/**
 * lint-поверхня bun: licensee-перевірка ліцензій npm-залежностей.
 * @param {string[] | undefined} _files ігнорується (whole-repo)
 * @param {string} [cwd] корінь
 * @param {{ readOnly?: boolean }} [opts]
 * @returns {Promise<number>} exit code
 */
export function lint(_files, cwd = process.cwd(), opts = {}) {
  return runStandardLint(import.meta.dirname, () => runLicenseeSteps(cwd, opts))
}

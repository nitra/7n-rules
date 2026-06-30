/**
 * lint-поверхня bun/licensee: read-only detector ліцензій npm-залежностей (`licensee`).
 * Генерація дефолтного `.licensee.json` — окремий T0-fix (`fix-licensee.mjs`), не в detector-і.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

import { createViolationReporter } from '../../../scripts/lib/lint-surface/violation-reporter.mjs'
import { resolveCmd } from '../../../scripts/utils/resolve-cmd.mjs'

/**
 * Detector bun/licensee: ліцензії npm-залежностей через `licensee` (read-only).
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx
 * @returns {import('../../../scripts/lib/lint-surface/types.mjs').LintResult}
 */
export function lint(ctx) {
  const reporter = createViolationReporter(ctx)
  const { fail } = reporter
  const cwd = ctx.cwd

  const configPath = join(cwd, '.licensee.json')
  if (!existsSync(configPath)) {
    fail(
      'lint-bun: licensee — немає .licensee.json; запустіть `npx @nitra/cursor lint bun` локально для генерації (bun.mdc)',
      'licensee-config-missing'
    )
    return reporter.result()
  }

  const bun = resolveCmd('bun')
  if (!bun) {
    fail('lint-bun: `bun` не знайдено в PATH (bun.mdc)', 'bun-missing')
    return reporter.result()
  }

  const r = spawnSync(bun, ['x', 'licensee', '--production', '--quiet'], { cwd, encoding: 'utf8', shell: false })
  if (r.status !== 0) {
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().slice(0, 2000)
    fail(
      `lint-bun: licensee — порушення ліцензій (код ${r.status}, bun.mdc)${out ? `\n${out}` : ''}`,
      'license-violation'
    )
  }
  return reporter.result()
}

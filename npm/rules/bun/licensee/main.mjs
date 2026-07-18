/**
 * lint-поверхня bun/licensee: read-only detector ліцензій npm-залежностей (`licensee`).
 * Генерація дефолтного `.licensee.json` — окремий T0-fix (`fix-licensee.mjs`), не в detector-і.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { createViolationReporter } from '../../../scripts/lib/lint-surface/violation-reporter.mjs'
import { resolveCmd } from '../../../scripts/utils/resolve-cmd.mjs'
import { spawnAsync } from '../../../scripts/utils/spawn-async.mjs'

/**
 * Detector bun/licensee: ліцензії npm-залежностей через `licensee` (read-only).
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст lint-прогону
 * @returns {Promise<import('../../../scripts/lib/lint-surface/types.mjs').LintResult>} результат detector-а
 */
export async function lint(ctx) {
  const reporter = createViolationReporter(ctx)
  const { fail } = reporter
  const cwd = ctx.cwd

  const configPath = join(cwd, '.licensee.json')
  if (!existsSync(configPath)) {
    fail(
      'lint-bun: licensee — немає .licensee.json; запустіть `npx @7n/rules lint bun` локально для генерації (bun.mdc)',
      'licensee-config-missing'
    )
    return reporter.result()
  }

  const bun = resolveCmd('bun')
  if (!bun) {
    fail('lint-bun: `bun` не знайдено в PATH (bun.mdc)', 'bun-missing')
    return reporter.result()
  }

  // Без --quiet: `licensee` пише реальні NOT APPROVED записи (name/version/license) у
  // stdout через print() — деталь замість голого "код 1". Crash/die() усередині
  // самого тула (invalid config, внутрішній виняток на кшталт "Cannot read properties
  // of undefined (reading 'localeCompare')" — спостережено з @npmcli/arborist на
  // bun-based node_modules) завжди йде у stderr через die(); легітимний звіт про
  // порушення — лише у stdout. Канал розрізняє crash від реального порушення.
  const r = await spawnAsync(bun, ['x', 'licensee', '--production', '--errors-only'], { cwd, shell: false })
  if (r.exitCode !== 0) {
    const stderr = (r.stderr ?? '').trim().slice(0, 2000)
    if (stderr) {
      fail(
        `lint-bun: licensee — інструмент завершився з помилкою, це НЕ підтверджене ліцензійне порушення ` +
          `(код ${r.exitCode}, bun.mdc). Ймовірна причина — несумісність @npmcli/arborist (яким licensee читає ` +
          `node_modules) з деревом, зібраним bun install. Перевір вручну: \`bunx licensee --production\`.\n${stderr}`,
        'licensee-crashed'
      )
    } else {
      const stdout = (r.stdout ?? '').trim().slice(0, 2000)
      const detail = stdout ? `\n${stdout}` : ''
      fail(`lint-bun: licensee — порушення ліцензій (код ${r.exitCode}, bun.mdc)${detail}`, 'license-violation')
    }
  }
  return reporter.result()
}

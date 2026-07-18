/**
 * T0-autofix для `bun/licensee` — детермінована генерація `.licensee.json` через
 * `licensee --init` (canon-команда самого тула, та сама, що detector радить запустити
 * вручну). Реальні `license-violation` (файл є, але залежності не проходять) — НЕ
 * T0-фікс: потребують людського рішення про ліцензійну політику, не regen.
 */
import { join } from 'node:path'

import { resolveCmd } from '../../../scripts/utils/resolve-cmd.mjs'
import { spawnAsync } from '../../../scripts/utils/spawn-async.mjs'

/** @type {import('../../../scripts/lib/lint-surface/types.mjs').T0Pattern[]} */
export const patterns = [
  {
    id: 'bun-licensee-config-init',
    test: violations => violations.some(v => v.reason === 'licensee-config-missing'),
    apply: async (violations, ctx) => {
      const bun = resolveCmd('bun')
      if (!bun) return { touchedFiles: [] }

      await spawnAsync(bun, ['x', 'licensee', '--init', '--production', '--quiet'], {
        cwd: ctx.cwd,
        shell: false
      })

      const configPath = join(ctx.cwd, '.licensee.json')
      ctx.recordWrite?.(configPath)
      return { touchedFiles: [configPath], message: 'licensee --init: .licensee.json' }
    }
  }
]

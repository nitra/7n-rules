/**
 * T0-autofix для `ci4/marksman_config` — копіює canonical baseline `.marksman.toml` без LLM.
 */
import { copyFile } from 'node:fs/promises'
import { join } from 'node:path'

import { MARKSMAN_BASELINE_PATH, MARKSMAN_TARGET_FILENAME } from './main.mjs'

/** @type {import('../../../scripts/lib/lint-surface/types.mjs').T0Pattern[]} */
export const patterns = [
  {
    id: 'ci4-marksman-config-missing',
    test: violations => violations.some(v => v.data?.kind === 'marksman-config-missing'),
    apply: async (_violations, ctx) => {
      const target = join(ctx.cwd, MARKSMAN_TARGET_FILENAME)
      ctx.recordWrite?.(target)
      await copyFile(MARKSMAN_BASELINE_PATH, target)
      return {
        touchedFiles: [target],
        message: `${MARKSMAN_TARGET_FILENAME} створено з canonical baseline (ci4.mdc)`
      }
    }
  }
]

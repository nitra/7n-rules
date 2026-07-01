/**
 * T0-autofix для `test/stryker_config` — детерміноване створення canonical
 * stryker/vitest baseline-ів, vue-plugin-файла, augment існуючого Vue-config-а та
 * дозапис тест-патернів у `.gitignore`. Логіку перенесено з detector-а (read-only
 * contract: detector лише ЗВІТУЄ потрібні зміни, запис — тут).
 *
 * Unified lint surface: structured violations (test(violations)/apply(violations,ctx)).
 * Дії резолвимо повторним запуском чистого планувальника `planStrykerActions(cwd)`
 * (той самий код, що й detector) → idempotent: already-applied не повертаються.
 */
import { copyFile, readFile, writeFile } from 'node:fs/promises'

import { ensureGitignoreEntries } from '../../../scripts/utils/ensure-gitignore-entries.mjs'

import {
  GITIGNORE_MISSING,
  GITIGNORE_SECTION_LABEL,
  STRYKER_CONFIG_MISSING,
  STRYKER_VUE_AUGMENT,
  planStrykerActions
} from './main.mjs'

const TRIGGER_REASONS = new Set([STRYKER_CONFIG_MISSING, STRYKER_VUE_AUGMENT, GITIGNORE_MISSING])

/**
 * Виконує одну BaselineAction: copy as-is або string-replace baseline-тексту.
 * @param {import('./main.mjs').StrykerPlan['baselineActions'][number]} a
 * @returns {Promise<void>}
 */
async function writeBaseline(a) {
  if (a.transform) {
    const src = await readFile(a.baselinePath, 'utf8')
    const { replacement } = a.transform
    await writeFile(
      a.target,
      src.replace(new RegExp(a.transform.re, 'u'), () => replacement),
      'utf8'
    )
  } else {
    await copyFile(a.baselinePath, a.target)
  }
}

/** @type {import('../../../scripts/lib/lint-surface/types.mjs').T0Pattern[]} */
export const patterns = [
  {
    id: 'test-stryker-config-create',
    test: violations => violations.some(v => TRIGGER_REASONS.has(v.reason)),
    apply: async (violations, ctx) => {
      const cwd = ctx.cwd
      const plan = await planStrykerActions(cwd)
      if (plan.fatal) return { touchedFiles: [] }

      const touchedFiles = []
      for (const a of plan.baselineActions) {
        ctx.recordWrite?.(a.target)
        await writeBaseline(a)
        touchedFiles.push(a.target)
      }
      for (const w of plan.augmentWrites) {
        ctx.recordWrite?.(w.target)
        await writeFile(w.target, w.content, 'utf8')
        touchedFiles.push(w.target)
      }
      if (plan.gitignoreMissing.length > 0) {
        const gitignorePath = `${cwd}/.gitignore`
        ctx.recordWrite?.(gitignorePath)
        const { added } = await ensureGitignoreEntries(cwd, plan.gitignoreMissing, GITIGNORE_SECTION_LABEL)
        if (added.length > 0) touchedFiles.push(gitignorePath)
      }

      if (touchedFiles.length === 0) return { touchedFiles: [] }
      return { touchedFiles, message: `stryker/vitest config + .gitignore: ${touchedFiles.join(', ')}` }
    }
  }
]

/** @see ./docs/fix-check.md */

/**
 * T0-autofix для `js/check` — детермінований scaffold/merge `eslint.config.js`.
 * Раніше ці порушення йшли у LLM-ладдер, який переписував конфіг цілком і
 * вгадував воркспейс-типи (інцидент: у vue-монорепо записано
 * `getConfig({ node: ['npm'] })` — eslint перестав обробляти .vue файли).
 * Тепер джерело правди — `planEslintConfigFix` (детекція типів із workspaces
 * root package.json + vue-залежність/.vue-файли), а наявний конфіг оновлюється точковим merge
 * хірургічно, без повного перезапису.
 *
 * Решта порушень js/check (engines, workflows, oxlintrc) — поза цим T0,
 * стандартний шлях (ladder/manual).
 */
import { writeFile } from 'node:fs/promises'

import {
  ESLINT_CONFIG_IGNORES,
  ESLINT_CONFIG_MISSING,
  ESLINT_CONFIG_VUE_WORKSPACE,
  planEslintConfigFix
} from './eslint-config.mjs'

const TRIGGER_REASONS = new Set([ESLINT_CONFIG_MISSING, ESLINT_CONFIG_IGNORES, ESLINT_CONFIG_VUE_WORKSPACE])

/** @type {import('../../../scripts/lib/lint-surface/types.mjs').T0Pattern[]} */
export const patterns = [
  {
    id: 'js-check-eslint-config',
    test: violations => violations.some(v => TRIGGER_REASONS.has(v.reason)),
    apply: async (violations, ctx) => {
      const plan = await planEslintConfigFix(ctx.cwd)
      if (plan === null) return { touchedFiles: [] }
      ctx.recordWrite?.(plan.path)
      await writeFile(plan.path, plan.content, 'utf8')
      return { touchedFiles: [plan.path], message: plan.message }
    }
  }
]

/**
 * Standalone CLI runner для одного правила. Викликається з `rules/<id>/fix.mjs`
 * у блоці `if (import.meta.main)` — це робить `bun rules/<id>/fix.mjs` повним
 * еквівалентом `npx \@nitra/cursor fix <id>`: друкує summary, повертає aggregated exit-code.
 *
 * **Без whitelist-гейту.** Гейтинг активних правил — єдине джерело: `resolveCheckRuleIds`
 * (`scripts/lib/fix/run-fix-check.mjs`) за `.n-cursor.json`. Прямий `bun rules/<id>/fix.mjs` —
 * свідомий запуск саме цього правила (debug / override), тож виконується беззастережно;
 * усі автоматичні шляхи (lint-конформність, orchestrator, t0, hook) уже спавнять лише активні.
 *
 * Library-mode виклик з CLI orchestration — інше: див. `runStandardRule` + `fix.mjs::run(ctx)`.
 */
import { basename } from 'node:path'

import { runStandardRule } from './run-standard-rule.mjs'
import { getOrCreateWalkCache } from '../utils/walk-cache.mjs'

// Re-export для зворотної сумісності: уся `rules/<id>/fix.mjs` уже імпортує `isRunAsCli`
// саме звідси. Канонічна реалізація — у `scripts/cli-entry.mjs`. Caller передає
// `import.meta.url`: `if (isRunAsCli(import.meta.url)) …`.
export { isRunAsCli } from '../cli-entry.mjs'

const PACKAGE_NAME = '@nitra/cursor'

/**
 * @param {string} ruleDir абсолютний шлях до `rules/<id>/`
 * @returns {Promise<number>} 0 — OK; 1 — порушення
 */
export async function runRuleCli(ruleDir) {
  const ruleId = basename(ruleDir)

  console.log(`\n🔍 ${PACKAGE_NAME} fix ${ruleId} — перевірка правила\n`)

  const walkCache = getOrCreateWalkCache()
  const exitCode = await runStandardRule(ruleDir, { walkCache })
  const ok = exitCode === 0
  console.log(`\n✨ Результат: ${ok ? 1 : 0}/1 правил без зауважень\n`)
  return exitCode
}

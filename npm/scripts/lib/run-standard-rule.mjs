/**
 * Public API per-rule orchestration. Викликається з `rules/<id>/fix.mjs`.
 *
 * Інкапсулює: `discoverOneRule` → `runRule(applies → JS → policy → mdc-refs)`.
 * Локальна логіка в правилах заборонена; розширення поведінки — через `ctx`-опції.
 *
 * Серіалізація: загортає виконання у `withLock('fix-<ruleId>')` — паралельні запуски
 * того самого правила (через `npx @nitra/cursor fix`, прямий `bun rules/<id>/fix.mjs`
 * чи `run(ctx)`-композицію) дедупляться за станом git-дерева; різні правила можуть
 * виконуватись паралельно. Точка інтеграції — тут, щоб не дублювати лок у кожному
 * `fix.mjs`.
 */
import { basename, dirname } from 'node:path'

import { discoverOneRule } from './discover-checkable-rules.mjs'
import { runRule } from './run-rule.mjs'
import { getOrCreateWalkCache } from '../utils/walk-cache.mjs'
import { withLock } from '../utils/with-lock.mjs'

/**
 * @typedef {object} RuleContext
 * @property {Map<string, Promise<string[]>>} [walkCache] FS-walk cache між concerns одного прогону
 *
 * Зарезервовано на майбутнє (поки не реалізовано — додається, коли з'явиться потреба):
 *   - `skipMdcRefs`, `skipApplies`, `onlyConcerns`.
 * Розширення поведінки правила робиться лише через нові поля тут, не через локальну
 * логіку в `rules/<id>/fix.mjs`.
 */

/**
 * @param {string} ruleDir абсолютний шлях до `rules/<id>/`
 * @param {RuleContext} [ctx] контекст прогону (walkCache тощо)
 * @returns {Promise<number>} 0 OK, 1 violations
 */
export function runStandardRule(ruleDir, ctx = {}) {
  const ruleId = basename(ruleDir)
  const bundledRulesDir = dirname(ruleDir)
  return withLock(`fix-${ruleId}`, async () => {
    const rule = await discoverOneRule(ruleDir, ruleId)
    const walkCache = ctx.walkCache ?? getOrCreateWalkCache()
    return runRule(rule, bundledRulesDir, walkCache)
  })
}

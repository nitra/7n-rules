/**
 * Спільна точка входу для канонічних `lint-<rule>` підкоманд `@nitra/cursor`.
 *
 * Дзеркально до `runStandardRule` для `fix-<id>`: усі `lint-*` проходять через одну функцію,
 * щоб майбутні крос-cutting концерни (телеметрія, env-toggle вимкнення локу для дебагу,
 * dry-run-режим, common preflight-логування тощо) додавались **в одному** місці, а не
 * патчилися в кожному `rules/<rule>/lint/lint.mjs`.
 *
 * Зараз робить рівно одне: серіалізує + дедуплікує запуски через `withLock('lint-<ruleId>')`.
 * `ruleId` виводиться зі шляху: `import.meta.dirname` у `rules/<id>/lint/lint.mjs` → `<id>`.
 *
 * Інтеграція з боку правила:
 *
 * ```js
 * import { runStandardLint } from '../../../scripts/utils/run-standard-lint.mjs'
 *
 * async function runLintFooSteps() { ... }
 *
 * export const runLintFooCli = () => runStandardLint(import.meta.dirname, runLintFooSteps)
 * ```
 */
import { basename, dirname } from 'node:path'

import { withLock } from './with-lock.mjs'

/**
 * @param {string} lintDir абсолютний шлях до `rules/<id>/lint/` (передавай `import.meta.dirname`)
 * @param {() => number | Promise<number>} stepsFn реальна робота лінту; повертає код виходу
 * @param {{ttl?:number, staleThreshold?:number, waitTimeout?:number, pollInterval?:number, cacheDir?:string, getFingerprint?:() => string | null}} [opts] прокидаються у `withLock`
 * @returns {Promise<number>} код виходу
 */
export function runStandardLint(lintDir, stepsFn, opts) {
  const ruleId = basename(dirname(lintDir))
  return withLock(`lint-${ruleId}`, stepsFn, opts)
}

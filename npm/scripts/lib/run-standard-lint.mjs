/**
 * Спільна точка входу для канонічних `lint-<rule>` підкоманд `@nitra/cursor`.
 *
 * Дзеркально до `runStandardRule` для `fix-<id>`: усі `lint-*` проходять через одну функцію,
 * щоб майбутні крос-cutting концерни (телеметрія, env-toggle вимкнення локу для дебагу,
 * dry-run-режим, common preflight-логування тощо) додавались **в одному** місці, а не
 * патчилися в кожному `rules/<rule>/lint/lint.mjs`.
 *
 * Зараз робить рівно одне: серіалізує + дедуплікує запуски через `withLock('lint-<ruleId>')`.
 * `ruleId` виводиться зі шляху незалежно від глибини виклику: `rules/<id>` (з `main.mjs`),
 * `rules/<id>/js` або `rules/<id>/lint` → `<id>` (сегмент одразу після `rules/`).
 *
 * Інтеграція з боку правила:
 *
 * ```js
 * import { runStandardLint } from '../../scripts/lib/run-standard-lint.mjs'
 *
 * async function runLintFooSteps() { ... }
 *
 * export function lint(_files) { return runStandardLint(import.meta.dirname, runLintFooSteps) }
 * ```
 */
import { basename } from 'node:path'

import { withLock } from '../utils/with-lock.mjs'

const RE_PATH_SEP = /[/\\]/u

/**
 * Виводить `<id>` зі шляху каталогу правила незалежно від глибини: сегмент одразу після
 * останнього `rules/`. Fallback — `basename(dir)`, якщо `rules/` у шляху немає.
 * @param {string} dir абсолютний шлях каталогу (`rules/<id>`, `rules/<id>/js`, …)
 * @returns {string} rule-id
 */
function ruleIdFromDir(dir) {
  const parts = dir.split(RE_PATH_SEP)
  const i = parts.lastIndexOf('rules')
  return i !== -1 && parts[i + 1] ? parts[i + 1] : basename(dir)
}

/**
 * @param {string} lintDir абсолютний шлях до каталогу правила (передавай `import.meta.dirname`)
 * @param {() => number | Promise<number>} stepsFn реальна робота лінту; повертає код виходу
 * @param {{ttl?:number, staleThreshold?:number, waitTimeout?:number, pollInterval?:number, cacheDir?:string, getFingerprint?:() => string | null}} [opts] прокидаються у `withLock`
 * @returns {Promise<number>} код виходу
 */
export function runStandardLint(lintDir, stepsFn, opts) {
  const ruleId = ruleIdFromDir(lintDir)
  return withLock(`lint-${ruleId}`, stepsFn, opts)
}

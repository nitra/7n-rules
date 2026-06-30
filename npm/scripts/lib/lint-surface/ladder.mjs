/**
 * Pure tier-ladder helpers для central fix-pipeline. Декопльовано від старого
 * orchestrator.mjs (який видаляється на cutover). Логіка ескалації — спека
 * 2026-06-19-fix-escalation-cascade + 2026-06-29-unified-lint-surface §Tier Ladder.
 */
import { env } from 'node:process'

const LOCAL_TIMEOUT_MS = Number(env.N_LOCAL_FIX_TIMEOUT_MS) || 300_000
const CLOUD_TIMEOUT_MS = Number(env.N_CLOUD_FIX_TIMEOUT_MS) || 300_000

/** Дефолтний кеп на виклики cloud-avg за прогін (щоб ladder на N concern-ів не спалив avg). */
export const DEFAULT_MAX_AVG = 3

/** Реальний транспорт-збій провайдера (мережа/сокет) — НЕ агентний backstop-timeout. */
const TRANSPORT_RE = /etimedout|timed out|econnrefused|connection refused/i

/** Systemic — повтор тієї ж моделі марний (нема git, fail-closed guard, відсутня модель, auth). */
const SYSTEMIC_RE = /не git-репо|fail-closed|write-guard|модель не знайдена|registry:|session:|немає ключа|api key/i

/**
 * @typedef {object} Rung
 * @property {'local-min'|'local-min-retry'|'cloud-min'|'cloud-avg'} tier
 * @property {string} model
 * @property {boolean} feedback використати feedback попереднього rung-а
 * @property {boolean} local
 * @property {boolean} isAvg під avg-кепом
 * @property {number} timeoutMs
 */

/**
 * Будує ladder за наявними тирами; rung-и з порожнім model відсіюються.
 * @param {{ localMin: string, cloudMin: string, cloudAvg: string }} models
 * @returns {Rung[]}
 */
export function buildLadder({ localMin, cloudMin, cloudAvg }) {
  return [
    { tier: 'local-min', model: localMin, feedback: false, local: true, isAvg: false, timeoutMs: LOCAL_TIMEOUT_MS },
    {
      tier: 'local-min-retry',
      model: localMin,
      feedback: true,
      local: true,
      isAvg: false,
      timeoutMs: LOCAL_TIMEOUT_MS
    },
    { tier: 'cloud-min', model: cloudMin, feedback: true, local: false, isAvg: false, timeoutMs: CLOUD_TIMEOUT_MS },
    { tier: 'cloud-avg', model: cloudAvg, feedback: true, local: false, isAvg: true, timeoutMs: CLOUD_TIMEOUT_MS }
  ].filter(r => r.model)
}

/**
 * Класифікує помилку worker-а: systemic | transport | quality.
 * Агентний backstop-timeout → quality (ladder падає на сильніший rung, не обрив).
 * @param {string|null|undefined} error
 * @returns {'systemic'|'transport'|'quality'|null}
 */
export function classifyFixError(error) {
  if (!error) return null
  if (/^fix timeout /i.test(error)) return 'quality'
  if (SYSTEMIC_RE.test(error)) return 'systemic'
  if (TRANSPORT_RE.test(error)) return 'transport'
  return 'quality'
}

/**
 * Рішення після провального rung-а: обірвати ladder / пропустити модель.
 * @param {Rung} rung
 * @param {string|null|undefined} error
 * @returns {'break'|'skip-model'|null}
 */
export function decideAfterFailure(rung, error) {
  if (!error) return null
  const kind = classifyFixError(error)
  if (kind === 'systemic') return rung.local ? 'skip-model' : 'break'
  if (!rung.local && kind === 'transport') return 'break'
  return null
}

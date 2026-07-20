/**
 * Pure tier-ladder helpers для central fix-pipeline. Декопльовано від старого
 * orchestrator.mjs (який видаляється на cutover). Логіка ескалації — спека
 * 2026-06-19-fix-escalation-cascade + 2026-06-29-unified-lint-surface §Tier Ladder.
 */
import { env } from 'node:process'

// Per-tier дефолти — ADR 260620-0556 (fail-fast escalation): локальний 4b-рунг
// об'єктивно не закінчить важкий промпт за хвилини (curl 28), хмарний SSE без
// таймауту здатен висіти годинами на ESTABLISHED TCP — драбина має рухатись далі.
//
// Override без зміни коду — env `N_LOCAL_FIX_TIMEOUT_MS` / `N_CLOUD_FIX_TIMEOUT_MS` /
// `N_CLOUD_AVG_FIX_TIMEOUT_MS`: мілісекунди на ОДИН rung відповідного класу
// (local-min/local-min-retry, cloud-min, cloud-avg). Значення потрапляє worker-у як
// `ctx.timeoutMs` (внутрішній abort LLM-виклику; batch-worker-и, як doc-files, ріжуть
// під нього беклог м'яким дедлайном), а runner додатково тримає backstop ×1.25 навколо
// всього worker-виклику. Робочий важіль для повільної локальної моделі чи великої черги
// batch-концерну: підняти локальний таймаут понад вартість одного файлу. Невалідне
// значення (NaN/0/порожньо) → дефолт.
//
// cloud-avg має ОКРЕМИЙ (більший за cloud-min) дефолт: реальний прогін
// (2026-07-18, /ai run/yoga2, chainId 6f6b4fdca71aa0c5) показав, що cloud-avg
// регулярно доводить concern до 1 залишкового порушення в межах спільного з
// cloud-min бюджету, але verify (canonical re-detect) не встигає підтвердитись —
// і весь прогрес відкочується, бо після cloud-avg немає наступного rung-а для
// повторної спроби. cloud-avg — останній шанс ladder-а (і під DEFAULT_MAX_AVG-кепом),
// тож дорожчий за нього бюджет виправдано менш економний, ніж cloud-min.
const LOCAL_TIMEOUT_MS = Number(env.N_LOCAL_FIX_TIMEOUT_MS) || 45_000
const CLOUD_TIMEOUT_MS = Number(env.N_CLOUD_FIX_TIMEOUT_MS) || 120_000
const CLOUD_AVG_TIMEOUT_MS = Number(env.N_CLOUD_AVG_FIX_TIMEOUT_MS) || 180_000

/** Дефолтний кеп на виклики cloud-avg за прогін (щоб ladder на N concern-ів не спалив avg). */
export const DEFAULT_MAX_AVG = 3

/** Реальний транспорт-збій провайдера (мережа/сокет) — НЕ агентний backstop-timeout. */
const TRANSPORT_RE = /etimedout|timed out|econnrefused|connection refused/i

/** Systemic — повтор тієї ж моделі марний (нема git, fail-closed guard, відсутня модель, auth). */
const SYSTEMIC_RE = /не git-репо|fail-closed|write-guard|модель не знайдена|registry:|session:|немає ключа|api key/i

/** Агентний backstop-timeout worker-а — класифікуємо як quality (ladder ескалює, не обриває). */
const FIX_TIMEOUT_RE = /^fix timeout /i

/**
 * @typedef {object} Rung
 * @property {'local-min'|'local-min-retry'|'cloud-min'|'cloud-avg'} tier назва тиру сходинки.
 * @property {string} model ідентифікатор моделі для цього rung-а.
 * @property {boolean} feedback використати feedback попереднього rung-а.
 * @property {boolean} local чи це локальний (не cloud) rung.
 * @property {boolean} isAvg під avg-кепом.
 * @property {number} timeoutMs таймаут виклику rung-а в мс.
 */

/**
 * Будує ladder за наявними тирами; rung-и з порожнім model відсіюються.
 * @param {{ localMin: string, cloudMin: string, cloudAvg: string }} models моделі по тирах.
 * @returns {Rung[]} відфільтрований список rung-ів для ескалації.
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
    { tier: 'cloud-avg', model: cloudAvg, feedback: true, local: false, isAvg: true, timeoutMs: CLOUD_AVG_TIMEOUT_MS }
  ].filter(r => r.model)
}

/**
 * Класифікує помилку worker-а: systemic | transport | quality.
 * Агентний backstop-timeout → quality (ladder падає на сильніший rung, не обрив).
 * @param {string|null|undefined} error текст помилки worker-а.
 * @returns {'systemic'|'transport'|'quality'|null} категорія помилки або null якщо помилки нема.
 */
export function classifyFixError(error) {
  if (!error) return null
  if (FIX_TIMEOUT_RE.test(error)) return 'quality'
  if (SYSTEMIC_RE.test(error)) return 'systemic'
  if (TRANSPORT_RE.test(error)) return 'transport'
  return 'quality'
}

/**
 * Рішення після провального rung-а: обірвати ladder / пропустити модель.
 * @param {Rung} rung rung, що провалився.
 * @param {string|null|undefined} error текст помилки worker-а.
 * @returns {'break'|'skip-model'|null} рішення про ескалацію або null для продовження.
 */
export function decideAfterFailure(rung, error) {
  if (!error) return null
  const kind = classifyFixError(error)
  if (kind === 'systemic') return rung.local ? 'skip-model' : 'break'
  if (!rung.local && kind === 'transport') return 'break'
  return null
}

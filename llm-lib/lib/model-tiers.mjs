/** @see ./docs/model-tiers.md */

/**
 * Тир-конфіг моделей для LLM-шару (@7n/llm-lib) і його consumers.
 *
 * Тири — політика споживача (які env-моделі = який тир); резолвінг у Model-обʼєкт
 * substrate-у живе окремо в [internal/registry] — цей модуль substrate-free і
 * повністю pure, юніт-тестується без pi.
 *
 * Формат значень env — `"provider/model-id"` (pi-формат), напр.:
 *   N_LOCAL_MIN_MODEL=omlx/gemma-4-e4b-it-OptiQ-4bit
 *   N_CLOUD_MIN_MODEL=openai/gpt-5.4-mini
 *   N_CLOUD_AVG_MODEL=openai/gpt-5.4
 */

import { env } from 'node:process'

// ── Тири (env-політика) ──────────────────────────────────────────────────────

/** Швидкий локальний inference. Напр.: omlx/gemma-4-e4b-it-OptiQ-4bit */
export const LOCAL_MIN = env.N_LOCAL_MIN_MODEL ?? ''
/** Середній локальний. */
export const LOCAL_AVG = env.N_LOCAL_AVG_MODEL ?? ''
/** Максимальний локальний. */
export const LOCAL_MAX = env.N_LOCAL_MAX_MODEL ?? ''
/** Мінімальний хмарний (потрібен ключ у pi auth). Напр.: openai/gpt-5.4-mini */
export const CLOUD_MIN = env.N_CLOUD_MIN_MODEL ?? ''
/** Середній хмарний. Напр.: openai/gpt-5.4 */
export const CLOUD_AVG = env.N_CLOUD_AVG_MODEL ?? ''
/** Максимальний хмарний. Напр.: openai/gpt-5.5 */
export const CLOUD_MAX = env.N_CLOUD_MAX_MODEL ?? ''

/**
 * Каскадне розв'язання абстрактного тиру в `"provider/model-id"`:
 *   'min' → LOCAL_MIN → LOCAL_AVG → LOCAL_MAX → CLOUD_MIN
 *   'avg' → LOCAL_AVG → LOCAL_MAX → CLOUD_AVG
 *   'max' → LOCAL_MAX → CLOUD_MAX
 * @param {'min'|'avg'|'max'} tier тир
 * @returns {string} `"provider/model-id"` або `''` (дефолт провайдера substrate)
 * @throws {TypeError} якщо tier невідомий
 */
export function resolveModel(tier) {
  if (tier === 'min') return LOCAL_MIN || LOCAL_AVG || LOCAL_MAX || CLOUD_MIN
  if (tier === 'avg') return LOCAL_AVG || LOCAL_MAX || CLOUD_AVG
  if (tier === 'max') return LOCAL_MAX || CLOUD_MAX
  throw new TypeError(`resolveModel: unknown tier "${tier}". Use 'min', 'avg', or 'max'.`)
}

// ── Escalation-rung → thinkingLevel ──────────────────────────────────────────

/**
 * `thinkingLevel` за rung-тиром fix-драбини: слабка локальна — `low`,
 * cloud-min — `medium`, cloud-avg — `high`, cloud-max (experiment-only tier,
 * не в production ladder) — `xhigh`.
 * @param {string} tier rung-тир (`local-min` | `local-min-retry` | `cloud-min` | `cloud-avg` | `cloud-max`)
 * @returns {'off'|'minimal'|'low'|'medium'|'high'|'xhigh'} дискретний рівень
 */
export function thinkingLevelForTier(tier) {
  if (tier === 'cloud-max') return 'xhigh'
  if (tier === 'cloud-avg') return 'high'
  if (tier === 'cloud-min') return 'medium'
  return 'low' // local-min, local-min-retry
}

// ── Парсинг spec ─────────────────────────────────────────────────────────────

/**
 * Розбирає `"provider/model-id"` у пару. Перший `/` — роздільник (model-id може
 * містити власні `/`). Порожній провайдер чи id → `null` (malformed).
 * @param {string} spec `"provider/model-id"`
 * @returns {{ provider: string, id: string } | null} пара або null
 */
export function parseModelId(spec) {
  if (typeof spec !== 'string') return null
  const i = spec.indexOf('/')
  if (i < 1 || i === spec.length - 1) return null
  return { provider: spec.slice(0, i), id: spec.slice(i + 1) }
}

/**
 * Форматує pi `Model`-об'єкт (`{provider, id}`) назад у `"provider/model-id"`.
 * Інверсія {@link parseModelId} — застосовується до фактично резолвленої
 * pi-моделі (`session.model`), коли consumer лишив `modelSpec` порожнім і pi
 * сам вибрав дефолт (локальний чи хмарний).
 * @param {{provider: string, id: string}|null|undefined} model pi Model-об'єкт
 * @returns {string|null} `"provider/model-id"` або `null`, якщо модель відсутня
 */
export function formatModelSpec(model) {
  if (!model || !model.provider || !model.id) return null
  return `${model.provider}/${model.id}`
}

// ── Класифікація local vs cloud ──────────────────────────────────────────────

/** Провайдери, що вважаються локальними. Override: `N_LLM_LOCAL_PROVIDERS` (кома-список). */
const LOCAL_PROVIDERS = new Set(
  (env.N_LLM_LOCAL_PROVIDERS ?? 'omlx')
    .split(',')
    .map(p => p.trim())
    .filter(Boolean)
)

/**
 * Чи model-spec вказує на локальну модель: збіг з одним із LOCAL_* тирів
 * АБО провайдер з `N_LLM_LOCAL_PROVIDERS` (дефолт `omlx`). Використовується
 * для local/cloud-агрегатів ланцюжків і рішення про chain-заголовки.
 * @param {string} spec `"provider/model-id"`
 * @returns {boolean} true — локальна модель
 */
export function isLocalModel(spec) {
  if (typeof spec !== 'string' || !spec) return false
  if (spec === LOCAL_MIN || spec === LOCAL_AVG || spec === LOCAL_MAX) return true
  const parsed = parseModelId(spec)
  return parsed ? LOCAL_PROVIDERS.has(parsed.provider) : false
}

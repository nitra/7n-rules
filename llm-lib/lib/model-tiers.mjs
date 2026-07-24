/** @see ./docs/model-tiers.md */

/**
 * Тир-конфіг моделей для LLM-шару (@7n/llm-lib) і його consumers.
 *
 * Каскадне розв'язання тиру ({@link resolveModel}) — задача T5, рішення Е
 * (ОНОВЛЕНЕ 2026-07-24): канон живе в Rust-крейті `llm_lib::tiers`
 * (`llm-lib/crates/llm-lib/src/tiers.rs`), тут — тонка napi-делегація
 * (`internal/native.mjs`), жодного власного каскаду. Інші утиліти модуля
 * (парсинг spec, класифікація local/cloud, thinkingLevel) не мають
 * Rust-відповідника — лишаються pure JS, substrate-free.
 *
 * Формат значень env — `"provider/model-id"` (pi-формат), напр.:
 *   N_LOCAL_MIN_MODEL=omlx/gemma-4-e4b-it-OptiQ-4bit
 *   N_CLOUD_MIN_MODEL=openai/gpt-5.4-mini
 *   N_CLOUD_AVG_MODEL=openai/gpt-5.4
 */

import { env } from 'node:process'
import { loadNative } from './internal/native.mjs'

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

/** Валідні тири — та сама множина, що й `parse_tier` у napi-крейті. */
const KNOWN_TIERS = new Set(['min', 'avg', 'max'])

/**
 * Каскадне розв'язання абстрактного тиру в `"provider/model-id"` —
 * napi-делегація в `llm_lib::resolve_model` (задача T5, рішення Е): та сама
 * логіка, що й Rust-каскад у `tiers.rs`:
 *   'min' → LOCAL_MIN → LOCAL_AVG → LOCAL_MAX → CLOUD_MIN
 *   'avg' → LOCAL_AVG → LOCAL_MAX → CLOUD_AVG
 *   'max' → LOCAL_MAX → CLOUD_MAX
 * Тир валідується тут (не в Rust) — щоб зберегти контракт `TypeError` для
 * невідомого тиру без потреби мапити помилку з napi-боку.
 * @param {'min'|'avg'|'max'} tier тир
 * @param {{ native?: { resolveModel: (tier: string) => string | null } }} [deps] інжект `native` для тестів
 * @returns {string} `"provider/model-id"` або `''` (дефолт провайдера substrate)
 * @throws {TypeError} якщо tier невідомий
 */
export function resolveModel(tier, deps = {}) {
  if (!KNOWN_TIERS.has(tier)) {
    throw new TypeError(`resolveModel: unknown tier "${tier}". Use 'min', 'avg', or 'max'.`)
  }
  const native = deps.native ?? loadNative()
  return native.resolveModel(tier) ?? ''
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

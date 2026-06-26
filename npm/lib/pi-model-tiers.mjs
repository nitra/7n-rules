/** @see ./docs/pi-model-tiers.md */

/**
 * Тир-конфіг моделей для pi-embed fix-engine і shared LLM consumers.
 *
 * Замінює `models.mjs` після міграції на pi-SDK: тири лишаються політикою n-cursor
 * (які env-моделі = який тир), але резолвінг тепер через pi `ModelRegistry.find`,
 * а не ручний routing на omlx/pi-CLI.
 *
 * Формат значень env — `"provider/model-id"` (pi-формат), напр.:
 *   N_LOCAL_MIN_MODEL=omlx/gemma-4-e4b-it-OptiQ-4bit
 *   N_CLOUD_MIN_MODEL=openai/gpt-5.4-mini
 *   N_CLOUD_AVG_MODEL=openai/gpt-5.4
 *
 * Pi вантажиться ВИКЛЮЧНО у `getRegistry()` (lazy dynamic import) — модуль сам по собі
 * pi-free, тому pure-функції (`parseModelId`, `resolveModelSpec`, `thinkingLevelForTier`,
 * `resolveModel`) юніт-тестуються без pi (registry інжектується).
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
 * Каскадне розв'язання абстрактного тиру в `"provider/model-id"` (контракт із
 * `models.mjs`, збережений для shared one-shot consumers):
 *   'min' → LOCAL_MIN → LOCAL_AVG → LOCAL_MAX → CLOUD_MIN
 *   'avg' → LOCAL_AVG → LOCAL_MAX → CLOUD_AVG
 *   'max' → LOCAL_MAX → CLOUD_MAX
 * @param {'min'|'avg'|'max'} tier тир
 * @returns {string} `"provider/model-id"` або `''` (pi-дефолт провайдера)
 * @throws {TypeError} якщо tier невідомий
 */
export function resolveModel(tier) {
  if (tier === 'min') return LOCAL_MIN || LOCAL_AVG || LOCAL_MAX || CLOUD_MIN
  if (tier === 'avg') return LOCAL_AVG || LOCAL_MAX || CLOUD_AVG
  if (tier === 'max') return LOCAL_MAX || CLOUD_MAX
  throw new TypeError(`resolveModel: unknown tier "${tier}". Use 'min', 'avg', or 'max'.`)
}

// ── Escalation-rung → pi thinkingLevel (§3) ──────────────────────────────────

/**
 * pi `thinkingLevel` за rung-тиром fix-драбини: слабка локальна — `low`,
 * cloud-min — `medium`, cloud-avg (найдорожча, найскладніше) — `high`. Замінює
 * ручний числовий `thinkingBudget`-плюмбінг старого omlx-каналу.
 * @param {string} tier rung-тир (`local-min` | `local-min-retry` | `cloud-min` | `cloud-avg`)
 * @returns {'off'|'minimal'|'low'|'medium'|'high'|'xhigh'} дискретний рівень
 */
export function thinkingLevelForTier(tier) {
  if (tier === 'cloud-avg') return 'high'
  if (tier === 'cloud-min') return 'medium'
  return 'low' // local-min, local-min-retry
}

// ── Парсинг і резолвінг через pi ─────────────────────────────────────────────

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
 * Резолвить `"provider/model-id"` у pi Model-обʼєкт через інжектований registry.
 * `createAgentSession` чекає саме Model-обʼєкт (НЕ рядок) — див. Спайк 2.
 * @param {{ find: (provider: string, id: string) => object|null|undefined }} registry pi ModelRegistry
 * @param {string} spec `"provider/model-id"`
 * @returns {object|null} pi Model або null (malformed/не знайдено)
 */
export function resolveModelSpec(registry, spec) {
  const parsed = parseModelId(spec)
  if (!parsed) return null
  return registry.find(parsed.provider, parsed.id) ?? null
}

/**
 * Lazy singleton pi `ModelRegistry` (вантажить `~/.pi/agent/models.json` + `auth.json`).
 * **Єдина** точка, де модуль торкається pi — dynamic import тримає `--read-only`
 * шлях pi-free (тверда межа CI). Кешується на процес.
 * @returns {Promise<object>} pi ModelRegistry
 */
let _registry = null
export async function getRegistry() {
  if (_registry) return _registry
  const { ModelRegistry, AuthStorage } = await import('@earendil-works/pi-coding-agent')
  _registry = ModelRegistry.create(AuthStorage.create())
  return _registry
}

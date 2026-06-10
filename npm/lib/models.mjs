/**
 * Глобальна класифікація моделей для pi.
 *
 * Формат значень: "provider/model-id" (pi --model формат).
 * Налаштовується один раз у середовищі; кожен скіл посилається на потрібний тир.
 *
 * Приклад ~/.bashrc або .env:
 *   N_LOCAL_MIN_MODEL=omlx/mlx-community--gemma-4-e2b-it-4bit
 *   N_CLOUD_MIN_MODEL=openai/gpt-5.4-mini
 *   N_CLOUD_AVG_MODEL=openai/gpt-5.4
 *   N_CLOUD_MAX_MODEL=openai/gpt-5.5
 *
 * Значення '' означає "pi дефолтний провайдер" (залежить від ~/.pi конфігу).
 *
 * ## Бекенд за префіксом model-id
 *
 * model-id з префіксом `omlx/...` маршрутизується прямим HTTP до локального
 * omlx-сервера (`npm/lib/omlx.mjs`), минаючи pi; решта (`openai/...`,
 * `ollama/...`, '') — через pi CLI. Тому локальні тири варто задавати у форматі
 * `omlx/<model>`, аби local-inference йшов напряму, а pi лишався шаром для хмари
 * (див. ADR 260610-1349).
 *
 * ## Каскад local → cloud (контракт)
 *
 * Використовуйте resolveModel(tier) замість прямих констант — система прозоро
 * відпрацює навіть без локальних моделей:
 *
 *   resolveModel('min') → LOCAL_MIN → LOCAL_AVG → LOCAL_MAX → CLOUD_MIN
 *   resolveModel('avg') → LOCAL_AVG → LOCAL_MAX → CLOUD_AVG
 *   resolveModel('max') → LOCAL_MAX → CLOUD_MAX
 *
 * Якщо жоден тир не задано — повертає '' (pi-дефолт провайдера).
 * Прямі константи (LOCAL_MIN тощо) залишені для випадків, де потрібен
 * явний контроль (напр., ollama HTTP, explicit retry до хмари).
 */

import { env } from 'node:process'

// ── Локальні (offline, без API-ключа) ────────────────────────────────────────

/** Швидкий локальний inference. Напр.: ollama/gemma3:4b */
export const LOCAL_MIN = env.N_LOCAL_MIN_MODEL ?? ''

/** Середній локальний. Напр.: ollama/gemma4:26b-moe */
export const LOCAL_AVG = env.N_LOCAL_AVG_MODEL ?? ''

/** Максимальний локальний. Напр.: ollama/llama4-maverick */
export const LOCAL_MAX = env.N_LOCAL_MAX_MODEL ?? ''

// ── Хмарні (потрібен API-ключ у pi) ─────────────────────────────────────────

/** Мінімальний хмарний. Напр.: openai/gpt-5.4-mini, google/gemini-2.5-flash, anthropic/claude-haiku-4-5 */
export const CLOUD_MIN = env.N_CLOUD_MIN_MODEL ?? ''

/** Середній хмарний. Напр.: openai/gpt-5.4, google/gemini-2.5-pro, anthropic/claude-sonnet-4-6 */
export const CLOUD_AVG = env.N_CLOUD_AVG_MODEL ?? ''

/** Максимальний хмарний. Напр.: openai/gpt-5.5, anthropic/claude-opus-4-8 */
export const CLOUD_MAX = env.N_CLOUD_MAX_MODEL ?? ''

// ── Каскадне розв'язання ─────────────────────────────────────────────────────

/**
 * Повертає перший непорожній model-id для запитаного тиру,
 * каскадно перевіряючи локальні тири, а тоді хмарний еквівалент.
 * @param {'min'|'avg'|'max'} tier тир запитуваної моделі
 * @returns {string} provider/model-id або '' для pi-дефолту
 * @throws {TypeError} якщо tier невідомий
 */
export function resolveModel(tier) {
  if (tier === 'min') return LOCAL_MIN || LOCAL_AVG || LOCAL_MAX || CLOUD_MIN
  if (tier === 'avg') return LOCAL_AVG || LOCAL_MAX || CLOUD_AVG
  if (tier === 'max') return LOCAL_MAX || CLOUD_MAX
  throw new TypeError(`resolveModel: unknown tier "${tier}". Use 'min', 'avg', or 'max'.`)
}

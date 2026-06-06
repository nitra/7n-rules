/**
 * Глобальна класифікація моделей для pi.
 *
 * Формат значень: "provider/model-id" (pi --model формат).
 * Налаштовується один раз у середовищі; кожен скіл посилається на потрібний тир.
 *
 * Приклад ~/.bashrc або .env:
 *   N_LOCAL_MIN_MODEL=ollama/gemma3:4b
 *   N_CLOUD_MIN_MODEL=openai/gpt-5.4-mini
 *   N_CLOUD_AVG_MODEL=openai/gpt-5.4
 *   N_CLOUD_MAX_MODEL=openai/gpt-5.5
 *
 * Значення '' означає "pi дефолтний провайдер" (залежить від ~/.pi конфігу).
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

/**
 * Per-call стеля відповіді (`max_completion_tokens`) для pi-сесій n-cursor.
 *
 * SDK `@earendil-works/pi-coding-agent` не має публічного per-call
 * параметра (`session.prompt(text, options)` не прокидає options у loop
 * config), але `options.maxTokens` у `streamFn` перекриває дефолт моделі —
 * перевірено на дроті через myllm-проксі (та сама техніка, що в
 * `7n-test` ADR 0002). Без обмеження кожен агентний/one-shot виклик
 * успадковує стелю моделі з `~/.pi/agent/models.json` (32768 для
 * локальної gemma) незалежно від реальної потреби відповіді.
 */
import { env } from 'node:process'

/** Дефолтна стеля відповіді для агентних/one-shot викликів n-cursor. */
export const DEFAULT_MAX_TOKENS = Number(env.N_PI_MAX_TOKENS) || 8192

/**
 * Обгортає `session.agent.streamFn`, домішуючи `maxTokens` в options
 * кожного LLM-виклику сесії. Безпечний no-op для сесій без `agent`
 * (напр. інжектовані фейки в тестах).
 * @param {object} session pi AgentSession
 * @param {number} [maxTokens] стеля відповіді; за замовчуванням `DEFAULT_MAX_TOKENS`
 * @returns {object} та сама session (для чейнінгу `return applyMaxTokens(session)`)
 */
export function applyMaxTokens(session, maxTokens = DEFAULT_MAX_TOKENS) {
  const orig = session?.agent?.streamFn
  if (typeof orig !== 'function' || !maxTokens) return session
  session.agent.streamFn = (model, context, options) => orig(model, context, { ...options, maxTokens })
  return session
}

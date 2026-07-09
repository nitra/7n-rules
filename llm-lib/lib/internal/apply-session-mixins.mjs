/** @see ./docs/apply-session-mixins.md */

/**
 * Спільний хвіст фабрики сесії (chain-headers → compression → max-tokens),
 * однаковий у всіх раннерів (`one-shot`/`agent-fix`/`agent-skill`) — виділено
 * зі спільного дубльованого коду (jscpd). INTERNAL — приймає/повертає pi
 * AgentSession, тому не входить у публічний API пакета.
 */
import { applyChainHeaders } from './chain-headers.mjs'
import { applyCompression } from './apply-compression.mjs'
import { applyMaxTokens } from './max-tokens.mjs'

/**
 * Домішує конвеєр streamFn-mixin-ів у новостворену сесію: заголовки ланцюжка,
 * компресія контексту, стеля токенів відповіді.
 * @param {object} session pi AgentSession
 * @param {object|null} [chain] chain handle — домішує X-Chain-* заголовки (лише локальні моделі)
 * @param {number} [maxTokens] per-call стеля відповіді (undefined → дефолт пакета, 0 → без стелі)
 * @returns {object} та сама session (для чейнінгу return)
 */
export function applySessionMixins(session, chain, maxTokens) {
  applyChainHeaders(session, chain)
  applyCompression(session)
  return maxTokens === undefined ? applyMaxTokens(session) : applyMaxTokens(session, maxTokens)
}

/** @see ./docs/apply-compression.md */

/**
 * Домішування компресії контексту в pi-сесію. INTERNAL — приймає pi
 * AgentSession, тому не входить у публічний API пакета.
 *
 * Той самий streamFn-mixin, що й [max-tokens]/[chain-headers]: обгортає
 * `session.agent.streamFn`, стискаючи `context` через [compress-context]
 * ПЕРЕД викликом оригінального streamFn — safety-net проти
 * `prefill_memory_exceeded` для важких агентних сесій, тепер на клієнті
 * (раніше — у myllm-проксі `compress.rs`), тож працює й напряму до omlx,
 * без залежності від запущеного myllm.
 *
 * Вимикається `N_LLM_COMPRESS=0` (дефолт — увімкнено; це safety-net, не
 * оптимізація, вимикати варто лише для дебагу різниці до/після).
 */
import { env } from 'node:process'
import { compressContext } from './compress-context.mjs'

/**
 * Чи компресія увімкнена (дефолт так). Override: `N_LLM_COMPRESS=0`.
 * @returns {boolean} true — компресія увімкнена.
 */
function compressionEnabled() {
  return env.N_LLM_COMPRESS !== '0'
}

/**
 * Обгортає `session.agent.streamFn`, стискаючи `context` кожного LLM-виклику
 * сесії. Безпечний no-op для сесій без `agent` (інжектовані фейки в тестах)
 * або коли компресію вимкнено.
 * @param {object} session pi AgentSession
 * @returns {object} та сама session (для чейнінгу)
 */
export function applyCompression(session) {
  const orig = session?.agent?.streamFn
  if (typeof orig !== 'function' || !compressionEnabled()) return session
  session.agent.streamFn = (model, context, options) => orig(model, compressContext(context), options)
  return session
}

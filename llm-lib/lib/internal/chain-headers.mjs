/** @see ./docs/chain-headers.md */

/**
 * Домішування chain-кореляційних заголовків у pi-сесію. INTERNAL — приймає
 * pi AgentSession, тому не входить у публічний API пакета.
 *
 * Той самий streamFn-mixin, що й [max-tokens]: pi `StreamOptions.headers`
 * мерджаться останніми поверх дефолтів провайдера (перевірено у
 * pi-ai openai-completions і pi-coding-agent sdk 0.80.2), тож заголовки
 * X-Chain-* долітають до локального проксі (myllm) з кожним HTTP-викликом.
 * `chain.headers()` читається НА МОМЕНТ виклику (свіжий X-Chain-Step).
 *
 * Заголовки додаються лише коли колер вирішив, що модель локальна
 * (isLocalModel у раннері) — хмарним провайдерам кастомні заголовки
 * не потрібні і можуть відхилятись строгими API.
 */

/**
 * Обгортає `session.agent.streamFn`, домішуючи chain-заголовки в options
 * кожного LLM-виклику сесії. Безпечний no-op без chain або для сесій без
 * `agent` (інжектовані фейки в тестах).
 * @param {object} session pi AgentSession
 * @param {{ headers: () => Record<string, string> }|null|undefined} chain chain handle (або нічого)
 * @returns {object} та сама session (для чейнінгу)
 */
export function applyChainHeaders(session, chain) {
  const orig = session?.agent?.streamFn
  if (typeof orig !== 'function' || !chain) return session
  session.agent.streamFn = (model, context, options) =>
    orig(model, context, { ...options, headers: { ...options?.headers, ...chain.headers() } })
  return session
}

/**
 * ACP (Agent Client Protocol, Zed) — доступ до `cursor`/`codex` через
 * особисту підписку (вже залогінений локально CLI), не API-ключ.
 *
 * Тонкий JS-клієнт до Rust-крейта `llm_cascade::acp` через napi FFI
 * in-process (`llm-lib/crates/llm-cascade-napi`) — жодного власного
 * ACP JSON-RPC/`ClientSideConnection` тут; уся протокольна логіка (спавн
 * агента, `session/prompt`, автоапрув `session/request_permission`) живе
 * в Rust, разом з watchdog-поведінкою на мертвий/незапущений дочірній процес.
 *
 * `claude` тут немає — Rust-крейт моделює лише `cursor`/`codex`
 * (`AcpAgentKind`); deprecated `claude`-раннер лишається окремим
 * JS-шимом у `@7n/rules` (`npm/scripts/lib/acp-runner.mjs`).
 */
import { loadNative } from './internal/native.mjs'

/**
 * Один виклик через ACP-агента з особистою підпискою.
 * @param {'cursor' | 'codex'} kind провайдер
 * @param {string} prompt промпт
 * @param {string} cwd робочий каталог сесії агента (каталог проєкту-викликача)
 * @param {{ native?: { oneShotAcp: (kind: string, prompt: string, cwd: string) => Promise<string> } }} [deps] інжект для тестів
 * @returns {Promise<string>} повний текст відповіді до кінця ходу
 */
export function runAcpAgent(kind, prompt, cwd, deps = {}) {
  const native = deps.native ?? loadNative()
  return native.oneShotAcp(kind, prompt, cwd)
}

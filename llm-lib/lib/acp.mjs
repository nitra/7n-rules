/**
 * ACP (Agent Client Protocol, Zed) — доступ до `cursor`/`codex`/`pi` через
 * особисту підписку (вже залогінений локально CLI), не API-ключ.
 *
 * Тонкий JS-клієнт до Rust-крейта `llm_lib::acp` через napi FFI
 * in-process (`llm-lib/crates/llm-lib-napi`) — жодного власного
 * ACP JSON-RPC/`ClientSideConnection` тут; уся протокольна логіка (спавн
 * агента, `session/prompt`, автоапрув `session/request_permission`,
 * тір→env/args/post-session-config резолвінг) живе в Rust, разом з
 * watchdog-поведінкою на мертвий/незапущений дочірній процес.
 *
 * `claude` тут немає — Rust-крейт моделює лише `cursor`/`codex`/`pi`
 * (`AcpAgentKind`); deprecated `claude`-раннер лишається окремим
 * JS-шимом у `@7n/rules` (`npm/scripts/lib/acp-runner.mjs`).
 */
import { loadNative } from './internal/native.mjs'

/**
 * Один виклик через ACP-агента з особистою підпискою. `tier` (задача T5,
 * рішення И) — опційний абстрактний тир (`min`/`avg`/`max`): якщо заданий,
 * Rust сам резолвить tier→env/args/post-session-config з пресету агента
 * (`one_shot_acp_with_tier`) — жодного JS-хелпера "пресет→env" тут немає.
 * Без `tier` — стара поведінка (модель = персональний конфіг CLI на машині).
 * @param {'cursor' | 'codex' | 'pi'} kind провайдер
 * @param {string} prompt промпт
 * @param {string} cwd робочий каталог сесії агента (каталог проєкту-викликача)
 * @param {{
 *   tier?: 'min' | 'avg' | 'max',
 *   native?: { oneShotAcp: (kind: string, prompt: string, cwd: string, tier?: string) => Promise<string> }
 * }} [options] тир + інжект `native` для тестів (той самий 4-й аргумент, що й раніше — сумісність зі старим `{ native }`-викликом збережена)
 * @returns {Promise<string>} повний текст відповіді до кінця ходу
 */
export function runAcpAgent(kind, prompt, cwd, { tier, native } = {}) {
  const nativeImpl = native ?? loadNative()
  return nativeImpl.oneShotAcp(kind, prompt, cwd, tier)
}

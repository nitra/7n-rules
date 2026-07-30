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
 * (`AcpAgentKind`); `claude` тут навмисно не підтримується.
 */
import { loadNative } from './internal/native.mjs'

/**
 * Один виклик через ACP-агента з особистою підпискою. `tier` (задача T5,
 * рішення И) — опційний абстрактний тир (`min`/`avg`/`max`): якщо заданий,
 * Rust сам резолвить tier→env/args/post-session-config з пресету агента
 * (`one_shot_acp_with_tier`) — жодного JS-хелпера "пресет→env" тут немає.
 * Без `tier` виклик заборонений, крім явного `mode:'interactive'` для персонального CLI-конфіга.
 * @param {'cursor' | 'codex' | 'pi'} kind провайдер
 * @param {string} prompt промпт
 * @param {string} cwd робочий каталог сесії агента (каталог проєкту-викликача)
 * @param {{
 *   tier?: 'min' | 'avg' | 'max', mode?: 'interactive', denyCommandFragments?: string[],
 *   native?: {
 *     oneShotAcp: (kind: string, prompt: string, cwd: string, tier?: string) => Promise<string>,
 *     oneShotAcpGuarded?: (kind: string, prompt: string, cwd: string, tier: string, denyCommandFragments: string[]) => Promise<string>
 *   }
 * }} [options] тир + інжект `native` для тестів (той самий 4-й аргумент, що й раніше — сумісність зі старим `{ native }`-викликом збережена)
 * @returns {Promise<string>} повний текст відповіді до кінця ходу; fail-closed
 *   контракт: Promise завжди завершується — термінальний хід повертає текст
 *   навіть якщо агент не закриває stdio/сесію, а transport failure
 *   (idle-timeout/помилка ACP) — reject зі структурованою причиною з Rust
 */
export function runAcpAgent(kind, prompt, cwd, { tier, mode, native, denyCommandFragments = [] } = {}) {
  if (!tier && mode !== 'interactive') throw new TypeError('runAcpAgent: передай tier або явно mode:"interactive"')
  if (tier && mode) throw new TypeError('runAcpAgent: tier і mode взаємовиключні')
  const nativeImpl = native ?? loadNative()
  if (denyCommandFragments.length > 0) {
    if (!tier) throw new TypeError('runAcpAgent: denyCommandFragments потребує tier')
    if (typeof nativeImpl.oneShotAcpGuarded !== 'function') {
      throw new TypeError('runAcpAgent: native не підтримує denyCommandFragments')
    }
    return nativeImpl.oneShotAcpGuarded(kind, prompt, cwd, tier, denyCommandFragments)
  }
  return nativeImpl.oneShotAcp(kind, prompt, cwd, tier)
}

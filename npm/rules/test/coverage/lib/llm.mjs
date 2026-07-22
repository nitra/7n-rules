/**
 * Тонкий адаптер `@7n/test` над `@7n/llm-lib` (Ф3 спеки llm-lib-extraction):
 * зберігає звичний контракт `callText`/`callAgent` для внутрішніх колерів,
 * але транспорт/registry/trace повністю живуть у пакеті.
 *
 * Політика fail-fast успадковується від пакета: жодних retry/backoff на
 * connection- чи memory-помилках (колишні knobs N_PI_RETRY_ATTEMPTS,
 * N_PI_MEMORY_RETRY_ATTEMPTS тощо видалено разом із withRetry).
 * Єдина локальна політика — одноразове
 * подвоєння `maxTokens` на обрізаній відповіді (`stopReason: 'length'`):
 * це семантичний повтор без пауз, а не очікування зайнятого сервера.
 */
import { env } from 'node:process'
import { runOneShot } from '@7n/llm-lib/one-shot'
import { runAgentSkill } from '@7n/llm-lib/agent-skill'

/**
 * Стеля відповіді моделі для подвоєння на `stopReason: 'length'` — межа
 * `maxTokens` реєстру для локальної моделі (див. `~/.pi/agent/models.json`).
 */
const MAX_TOKENS_CEILING = 32_768

/**
 * Таймаут агентного виклику (паритет зі старим spawnSync pi CLI). Override:
 * `N_CURSOR_AGENT_TIMEOUT_MS` — для великих проєктів, де навіть один batch
 * (див. `coverage-fix.mjs#fixSurvivedMutants`) потребує більше часу.
 */
const AGENT_TIMEOUT_MS = Number(env.N_CURSOR_AGENT_TIMEOUT_MS) || 900_000

/**
 * Одноразовий text-виклик (без tools). Кидає Error на будь-якій помилці
 * виклику (колери класифікують memory-guard через `MEMORY_ERROR_RE`).
 * @param {string} prompt текст запиту для моделі
 * @param {object} [opts] додаткові параметри виклику
 * @param {string} [opts.cwd] робоча директорія для session
 * @param {string} [opts.model] provider/model-id (напр. "openai/gpt-5.5"); без значення — default pi
 * @param {number} [opts.maxTokens] стеля відповіді для цього виклику; на
 *   `stopReason: 'length'` виклик повторюється один раз із подвоєною стелею
 * @param {object} [opts.chain] chain handle (`@7n/llm-lib/chain`) — виклик стає кроком ланцюжка
 * @param {object} [opts.deps] інжекти для тестів (прокидаються у runOneShot)
 * @returns {Promise<string>} текстова відповідь моделі
 */
export async function callText(prompt, opts = {}) {
  let maxTokens = opts.maxTokens
  let lengthRetried = Boolean(opts._lengthRetried)

  while (true) {
    const r = await runOneShot({
      messages: [{ role: 'user', content: prompt }],
      modelSpec: opts.model ?? '',
      maxTokens,
      timeoutMs: 0,
      cwd: opts.cwd,
      caller: '7n-test:text',
      chain: opts.chain ?? null,
      deps: opts.deps
    })
    if (r.error) throw new Error(r.error)

    // Обрізана генерація зі зниженою стелею — не палимо retry-цикли колера
    // на «invalid block», а один раз повторюємо з подвоєною стелею.
    if (r.stopReason === 'length' && maxTokens && maxTokens < MAX_TOKENS_CEILING && !lengthRetried) {
      const doubled = Math.min(maxTokens * 2, MAX_TOKENS_CEILING)
      console.log(`  ⚠ відповідь обрізана (stopReason: length) — повтор із maxTokens ${maxTokens} → ${doubled}`)
      maxTokens = doubled
      lengthRetried = true
      continue
    }

    return r.content
  }
}

/**
 * Агентний виклик із повним tool-set (read/write/edit/bash/grep/find/ls):
 * агент пише файли напряму, текст стрімиться у stdout. Кидає Error на
 * помилці виклику. Заміна колишнього `spawnSync('pi', ['-p', ...])`.
 * @param {string} prompt текст завдання для агента
 * @param {string} cwd робоча директорія, куди агент може писати файли
 * @param {object} [opts] додаткові параметри
 * @param {string} [opts.model] provider/model-id або '' для pi-дефолту
 * @param {object} [opts.chain] chain handle (`@7n/llm-lib/chain`) — виклик стає кроком ланцюжка
 * @param {object} [opts.deps] інжекти для тестів (прокидаються у runAgentSkill)
 * @returns {Promise<void>} проміс завершується після виконання агента
 */
export async function callAgent(prompt, cwd, opts = {}) {
  const r = await runAgentSkill(prompt, {
    skillId: '7n-test',
    modelSpec: opts.model ?? '',
    cwd,
    timeoutMs: AGENT_TIMEOUT_MS,
    maxTokens: 0, // без стелі: агент пише цілі тест-файли (паритет зі старим CLI-шляхом)
    caller: 'agent:7n-test',
    chain: opts.chain ?? null,
    deps: opts.deps
  })
  if (r.error) throw new Error(r.error)
}

export { MEMORY_ERROR_RE } from '@7n/llm-lib/one-shot'

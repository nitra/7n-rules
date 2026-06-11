/**
 * Спільний транспорт до локального omlx-сервера (OpenAI-сумісний MLX,
 * `http://localhost:8000/v1/chat/completions`). Text-only: жодних `tools`/
 * `tool_calls` — сервер їх не підтримує (див. ADR
 * `260610-1349-агентна-пастка-js-owned-loop-через-omlx-замість-pi-tool-loop`).
 *
 * Маршрутизація між omlx і pi — за конвенцією префікса в model-id:
 *   `omlx/<model>` → прямий HTTP до omlx (локальний inference, без pi)
 *   будь-що інше    → pi CLI (хмарні провайдери або pi-дефолт)
 *
 * Так `resolveModel(tier)` лишається незмінним: достатньо виставити локальний
 * тир у форматі `N_LOCAL_MIN_MODEL=omlx/mlx-community--gemma-4-e2b-it-4bit`, і
 * виклик сам піде напряму в omlx замість pi.
 *
 * Auth: якщо в omlx увімкнено API-ключ, він резолвиться через
 * `resolveOmlxApiKey` (opts → `N_CURSOR_OMLX_KEY` → `~/.omlx/settings.json`)
 * і шлеться як `Authorization: Bearer …`.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { env } from 'node:process'

/** Дефолтний endpoint omlx (override — `N_CURSOR_OMLX_URL`). */
export const DEFAULT_OMLX_URL = 'http://127.0.0.1:8000/v1/chat/completions'

/**
 * API-ключ для omlx-сервера, коли в ньому ввімкнено auth
 * (`~/.omlx/settings.json` → `auth.skip_api_key_verification: false`).
 * Порядок: явний `apiKey` → env `N_CURSOR_OMLX_KEY` → `auth.api_key` із
 * локального `~/.omlx/settings.json` (zero-config для власної машини; читання
 * fail-safe) → `null` (заголовок не шлеться).
 * @param {string} [apiKey] явний ключ із opts виклику
 * @returns {string|null} ключ для `Authorization: Bearer …` або null
 */
export function resolveOmlxApiKey(apiKey) {
  if (apiKey) return apiKey
  if (env.N_CURSOR_OMLX_KEY) return env.N_CURSOR_OMLX_KEY
  try {
    const settings = JSON.parse(readFileSync(join(homedir(), '.omlx', 'settings.json'), 'utf8'))
    return settings?.auth?.api_key || null
  } catch {
    return null
  }
}

/** Дефолтна модель, якщо в id лишився голий `omlx/` (override — `N_CURSOR_OMLX_MODEL`). */
export const DEFAULT_OMLX_MODEL = 'mlx-community--gemma-4-e2b-it-4bit'

const OMLX_PREFIX = 'omlx/'

/**
 * Чи цей model-id адресує локальний omlx-бекенд (префікс `omlx/`).
 * @param {unknown} model перевірюваний model-id
 * @returns {boolean} true, якщо рядок починається з `omlx/`
 */
export function isOmlxModel(model) {
  return typeof model === 'string' && model.startsWith(OMLX_PREFIX)
}

/**
 * Прибирає `omlx/`-префікс → чистий model-id для omlx API.
 * Не-omlx-рядки повертає без змін.
 * @param {string} model model-id (можливо з префіксом)
 * @returns {string} model-id без `omlx/`
 */
export function omlxModelId(model) {
  return isOmlxModel(model) ? model.slice(OMLX_PREFIX.length) : model
}

/**
 * Витягує reasoning (думки моделі) з omlx-`message`. Джерела за пріоритетом:
 *   - `field`     — окреме поле `message.reasoning_content` (Qwen3-Thinking тощо);
 *   - `think_tag` — `<think>…</think>` усередині `content` (інші thinking-моделі);
 *   - `truncated` — `finish_reason: "length"` зрізав думку в `content` до закриття
 *                   тега → сирий reasoning лишився в `content` без `</think>`;
 *   - `null`      — reasoning немає (не-thinking модель).
 * @param {{content?:string, reasoning_content?:string}} message обʼєкт `choices[0].message`
 * @param {string|null} finishReason `choices[0].finish_reason`
 * @returns {{ reasoning: string|null, reasoningSource: 'field'|'think_tag'|'truncated'|null }} текст думок і його джерело
 */
const THINK_TAG_RE = /<think>([\s\S]*?)<\/think>/

/**
 *
 */
export function extractReasoning(message, finishReason) {
  const field = message?.reasoning_content
  if (field && field.trim()) return { reasoning: field, reasoningSource: 'field' }
  const content = message?.content ?? ''
  const m = content.match(THINK_TAG_RE)
  if (m) return { reasoning: m[1].trim(), reasoningSource: 'think_tag' }
  if (finishReason === 'length' && content.trim()) return { reasoning: content, reasoningSource: 'truncated' }
  return { reasoning: null, reasoningSource: null }
}

/**
 * Ядро прямого HTTP-виклику до omlx через `curl` (spawnSync). Повертає **багатий**
 * обʼєкт: контент + reasoning + usage + finish_reason + кількість спроб. Ретраїть
 * лише transient curl-помилки (18 = transfer closed, 52 = empty reply, 56 = recv failure).
 * @param {Array<{role:string, content:string}>} messages OpenAI-messages (system+user збережено)
 * @param {string} model model-id (з/без `omlx/`-префікса); порожній → дефолт
 * @param {{ url?: string, timeoutMs?: number, temperature?: number, maxTokens?: number, fallbackModel?: string, apiKey?: string }} [opts] URL, timeout, температура, ліміт виходу, fallback-модель, API-ключ
 * @returns {{ content:string, reasoning:string|null, reasoningSource:string|null, finishReason:string|null, usage:object|null, attempts:number }} багатий результат виклику
 * @throws на curl-помилці, не-200 exit, поганому JSON чи порожньому контенті
 */
export function callOmlxRaw(messages, model, opts = {}) {
  const {
    url = env.N_CURSOR_OMLX_URL ?? DEFAULT_OMLX_URL,
    timeoutMs = 60_000,
    temperature = 0.2,
    maxTokens = 4096,
    fallbackModel = env.N_CURSOR_OMLX_MODEL ?? DEFAULT_OMLX_MODEL,
    apiKey
  } = opts

  const m = omlxModelId(model) || fallbackModel
  const body = JSON.stringify({ model: m, messages, max_tokens: maxTokens, temperature })
  // Ключ локального сервера в argv допустимий: localhost-секрет власної машини,
  // короткоживучий процес; stdin уже зайнятий body (`--data-binary @-`).
  const key = resolveOmlxApiKey(apiKey)
  const authArgs = key ? ['-H', `Authorization: Bearer ${key}`] : []

  const TRANSIENT_CURL_CODES = new Set([18, 52, 56])
  let lastErr
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = spawnSync(
      'curl',
      [
        '-sS',
        '-X',
        'POST',
        url,
        '-H',
        'Content-Type: application/json',
        '-H',
        'Connection: close',
        ...authArgs,
        '--max-time',
        String(Math.ceil(timeoutMs / 1000)),
        '--data-binary',
        '@-'
      ],
      { input: body, encoding: 'utf8', timeout: timeoutMs + 5000 }
    )
    if (r.error) {
      lastErr = new Error(`omlx curl error: ${r.error.message}`)
      break
    }
    if (r.status !== 0) {
      if (TRANSIENT_CURL_CODES.has(r.status) && attempt < 3) {
        lastErr = new Error(`omlx curl exit ${r.status} (transient, retry ${attempt})`)
        continue
      }
      throw new Error(`omlx curl exit ${r.status}: ${r.stderr?.slice(0, 300) ?? ''}`)
    }
    let j
    try {
      j = JSON.parse(r.stdout)
    } catch {
      throw new Error(`omlx bad json: ${r.stdout?.slice(0, 200) ?? ''}`)
    }
    if (j.error) throw new Error(`omlx api: ${JSON.stringify(j.error).slice(0, 300)}`)
    const message = j.choices?.[0]?.message ?? {}
    const finishReason = j.choices?.[0]?.finish_reason ?? null
    const content = message.content?.trim() ?? ''
    if (!content) throw new Error(`omlx empty content (finish=${finishReason})`)
    const { reasoning, reasoningSource } = extractReasoning(message, finishReason)
    return { content, reasoning, reasoningSource, finishReason, usage: j.usage ?? null, attempts: attempt }
  }
  throw lastErr ?? new Error('omlx unknown failure')
}

/**
 * Тонка обгортка над `callOmlxRaw` для споживачів, яким потрібен лише текст.
 * Контракт незмінний: повертає непорожній `choices[0].message.content`.
 * @param {Array<{role:string, content:string}>} messages OpenAI-messages
 * @param {string} model model-id (з/без `omlx/`-префікса)
 * @param {object} [opts] ті самі опції, що й у `callOmlxRaw`
 * @returns {string} непорожній контент відповіді
 */
export function callOmlx(messages, model, opts = {}) {
  return callOmlxRaw(messages, model, opts).content
}

/**
 * Єдина точка LLM-викликів для JS-оркестраторів (див. ADR 260610-2228).
 *
 * Маршрутизація — виключно за префіксом model-id (конвенція `npm/lib/models.mjs`):
 *   `omlx/<model>` → прямий HTTP до локального omlx-сервера (`callOmlx`)
 *   будь-що інше   → `pi` CLI (хмарні провайдери або pi-дефолт)
 *
 * Жодних env-перемикачів бекенда: рядок моделі сам визначає транспорт.
 *
 * Wire-trace (ADR 260610-1516/1524): якщо виставлено `N_CURSOR_LLM_TRACE=<file>`,
 * кожен виклик append-ить один JSONL-рядок з бекендом, моделлю, тривалістю і
 * розмірами prompt/output. Трейс fail-safe: помилка запису не ламає виклик.
 */
import { spawnSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { env } from 'node:process'

import { callOmlx, isOmlxModel } from './omlx.mjs'

/** Дефолтний timeout одного виклику (узгоджено з LOCAL_TIMEOUT доки-конвеєра). */
const DEFAULT_TIMEOUT_MS = 120_000

/**
 * Бекенд для model-id: `omlx` — прямий HTTP, `pi` — CLI.
 * @param {string} model model-id (можливо порожній — pi-дефолт)
 * @returns {'omlx'|'pi'} назва бекенда
 */
export function pickBackend(model) {
  return isOmlxModel(model) ? 'omlx' : 'pi'
}

/**
 * Fail-safe append JSONL-рядка трейсу у файл з `N_CURSOR_LLM_TRACE`.
 * @param {object} entry один запис трейсу
 */
function trace(entry) {
  const file = env.N_CURSOR_LLM_TRACE
  if (!file) return
  try {
    appendFileSync(file, JSON.stringify(entry) + '\n')
  } catch {
    // трейс не має ламати основний виклик
  }
}

/**
 * Виклик через `pi` CLI: messages конкатенуються у plain prompt
 * (pi не приймає messages-масив), tools вимкнено.
 * @param {Array<{role:string, content:string}>} messages OpenAI-style messages
 * @param {string} model model-id для `--model` (порожній — pi-дефолт)
 * @param {number} timeoutMs ліміт очікування процесу
 * @returns {string} stdout відповіді
 */
function callPi(messages, model, timeoutMs) {
  const prompt = messages.map(m => m.content).join('\n\n')
  const modelArgs = model ? ['--model', model] : []
  const r = spawnSync('pi', ['-p', prompt, ...modelArgs, '--no-session', '--mode', 'text', '--no-tools'], {
    encoding: 'utf8',
    timeout: timeoutMs
  })
  if (r.error) throw new Error(`pi error: ${r.error.message}`)
  if (r.status !== 0) throw new Error(`pi exit ${r.status}: ${r.stderr?.slice(0, 300) ?? ''}`)
  return r.stdout?.trim() ?? ''
}

/**
 * Універсальний LLM-виклик з маршрутизацією за префіксом model-id.
 * @param {Array<{role:string, content:string}>} messages OpenAI-style messages (system зберігається на omlx)
 * @param {string} model model-id; `omlx/<m>` → прямий HTTP, інакше → pi CLI
 * @param {{ timeoutMs?: number, temperature?: number, maxTokens?: number, url?: string }} [opts] timeout, температура, ліміт виходу, override URL
 * @returns {string} текст відповіді (непорожній на omlx; pi може повернути '')
 */
export function callLlm(messages, model, opts = {}) {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, temperature = 0.2, maxTokens, url } = opts
  const backend = pickBackend(model)
  const t0 = Date.now()
  const promptChars = messages.reduce((n, m) => n + (m.content?.length ?? 0), 0)
  try {
    const out =
      backend === 'omlx'
        ? callOmlx(messages, model, { url, timeoutMs, temperature, ...(maxTokens ? { maxTokens } : {}) })
        : callPi(messages, model, timeoutMs)
    trace({
      ts: new Date().toISOString(),
      backend,
      model,
      ms: Date.now() - t0,
      promptChars,
      outChars: out.length,
      ok: true
    })
    return out
  } catch (error) {
    trace({
      ts: new Date().toISOString(),
      backend,
      model,
      ms: Date.now() - t0,
      promptChars,
      ok: false,
      error: String(error.message).slice(0, 200)
    })
    throw error
  }
}

/** Фрагмент повідомлення omlx про memory-guard (динамічна стеля пам'яті). */
const MEMORY_GUARD_MARKER = 'memory ceiling'
/** Тип помилки omlx про відсутній/хибний API-ключ. */
const AUTH_ERROR_MARKER = 'authentication_error'

/**
 * Preflight-перевірка omlx перед масовим прогоном: мінімальний chat-виклик
 * (`max_tokens: 1`). Розрізняє стани, які вимагають різних дій:
 *   - `down`         — сервер не відповідає (не запущений / не той порт);
 *   - `memory-guard` — модель не влазить у динамічну стелю пам'яті зайнятої
 *                      машини → «відклади прогін», а не «модель погана»;
 *   - `auth`         — сервер вимагає API-ключ → вистав `N_CURSOR_OMLX_KEY`;
 *   - `error`        — інша помилка API.
 * Порожній контент відповіді — це ok: сервер живий і модель завантажена.
 * @param {{ url?: string, model?: string, timeoutMs?: number }} [opts] override URL/моделі/timeout перевірки
 * @returns {{ ok: boolean, reason: 'down'|'memory-guard'|'auth'|'error'|null, detail: string }} стан сервера і класифікована причина збою
 */
export function omlxHealthCheck(opts = {}) {
  const { url, model = '', timeoutMs = DEFAULT_TIMEOUT_MS } = opts
  try {
    callOmlx([{ role: 'user', content: 'ok' }], model, { url, timeoutMs, maxTokens: 1, temperature: 0 })
    return { ok: true, reason: null, detail: '' }
  } catch (error) {
    const detail = String(error.message)
    if (detail.includes(MEMORY_GUARD_MARKER)) return { ok: false, reason: 'memory-guard', detail }
    if (detail.includes(AUTH_ERROR_MARKER)) return { ok: false, reason: 'auth', detail }
    if (detail.startsWith('omlx empty content')) return { ok: true, reason: null, detail }
    if (detail.startsWith('omlx curl')) return { ok: false, reason: 'down', detail }
    return { ok: false, reason: 'error', detail }
  }
}

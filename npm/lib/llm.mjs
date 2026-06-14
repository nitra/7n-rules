/**
 * Єдина точка LLM-викликів для JS-оркестраторів (див. ADR 260610-2228).
 *
 * Маршрутизація — виключно за префіксом model-id (конвенція `npm/lib/models.mjs`):
 *   `omlx/<model>` → прямий HTTP до локального omlx-сервера (`callOmlx`)
 *   будь-що інше   → `pi` CLI (хмарні провайдери або pi-дефолт)
 *
 * Жодних env-перемикачів бекенда: рядок моделі сам визначає транспорт.
 *
 * Wire-trace (спека 2026-06-10-omlx-wire-trace-capture-design): **always-on**
 * багатий JSONL-запис на кожен виклик — обидва канали (reasoning + слід). Для
 * omlx захоплює content/reasoning/usage/finish_reason/attempts; для pi — лише
 * те, що CLI дає (rich-поля null). Деталі запису/шляху/ротації — `omlx-trace.mjs`.
 */
import { spawnSync } from 'node:child_process'
import { env } from 'node:process'

import { callOmlxRaw, isOmlxModel } from './omlx.mjs'
import { buildTraceRecord, writeTrace } from './omlx-trace.mjs'

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
 * Універсальний LLM-виклик з маршрутизацією за префіксом model-id і always-on
 * wire-trace (обидва канали).
 * @param {Array<{role:string, content:string}>} messages OpenAI-style messages (system зберігається на omlx)
 * @param {string} model model-id; `omlx/<m>` → прямий HTTP, інакше → pi CLI
 * @param {{ timeoutMs?: number, temperature?: number, maxTokens?: number, url?: string, caller?: string }} [opts] timeout, температура, ліміт виходу, override URL, мітка викликача для trace
 * @returns {string} текст відповіді (непорожній на omlx; pi може повернути '')
 */
export function callLlm(messages, model, opts = {}) {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, temperature = 0.2, maxTokens, url, caller } = opts
  const backend = pickBackend(model)
  const resolvedCaller = caller ?? env.N_CURSOR_TRACE_CALLER ?? 'unknown'
  const t0 = Date.now()
  try {
    let content
    let reasoning = null
    let reasoningSource = null
    let finishReason = null
    let usage = null
    let attempts = 1
    if (backend === 'omlx') {
      const raw = callOmlxRaw(messages, model, { url, timeoutMs, temperature, ...(maxTokens ? { maxTokens } : {}) })
      ;({ content, reasoning, reasoningSource, finishReason, usage, attempts } = raw)
    } else {
      content = callPi(messages, model, timeoutMs)
    }
    writeTrace(
      buildTraceRecord({
        ts: new Date().toISOString(),
        caller: resolvedCaller,
        backend,
        model,
        temperature,
        maxTokens,
        messages,
        content,
        reasoning,
        reasoningSource,
        finishReason,
        usage,
        ms: Date.now() - t0,
        attempts,
        ok: true,
        error: null
      })
    )
    return content
  } catch (error) {
    writeTrace(
      buildTraceRecord({
        ts: new Date().toISOString(),
        caller: resolvedCaller,
        backend,
        model,
        temperature,
        maxTokens,
        messages,
        ms: Date.now() - t0,
        attempts: null,
        ok: false,
        error: String(error.message).slice(0, 200)
      })
    )
    throw error
  }
}

/** Фрагмент повідомлення omlx про memory-guard (динамічна стеля пам'яті). */
const MEMORY_GUARD_MARKER = 'memory ceiling'
/** Тип помилки omlx про відсутній/хибний API-ключ. */
const AUTH_ERROR_MARKER = 'authentication_error'
/** Детерміновані помилки: контекст/модель — ретрай чи чекання не допоможе. */
const PERMANENT_RE = /too long|exceeds[^.]*context|not found/i

/**
 * Класифікує omlx-помилку **після** того, як `callOmlxRaw` вичерпав внутрішні
 * ретраї — для реакції оркестратора (skip vs circuit-breaker vs звичайна помилка):
 *   - `permanent` — детерміновано (контекст завеликий, модель відсутня): skip, не ретраїти;
 *   - `systemic`  — середовище/сервер (memory-guard, auth, down/таймаут): каскадить → circuit-breaker;
 *   - `transient` — решта (empty content, bad json): рідкісне, не каскадить.
 * @param {string} message текст `error.message`
 * @returns {'transient'|'systemic'|'permanent'} клас помилки
 */
export function classifyOmlxError(message) {
  const m = String(message)
  if (PERMANENT_RE.test(m)) return 'permanent'
  if (m.includes(MEMORY_GUARD_MARKER) || m.includes(AUTH_ERROR_MARKER) || m.startsWith('omlx curl')) {
    return 'systemic'
  }
  return 'transient'
}

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
    callOmlxRaw([{ role: 'user', content: 'ok' }], model, { url, timeoutMs, maxTokens: 1, temperature: 0 })
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

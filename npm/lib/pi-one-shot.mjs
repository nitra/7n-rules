/** @see ./docs/pi-one-shot.md */

/**
 * Bounded one-shot LLM-виклик поверх pi (§3а спеки pi-migration).
 *
 * Для shared не-agent consumers (`doc-files` generation/judge, `text/cspell`
 * класифікація, ADR-normalize): «messages → текст», без write-tool, без агентного
 * циклу. Реалізовано як `createAgentSession({ noTools: 'all' })` + `session.prompt`
 * (агент без tools = plain completion) — перевикористовує верифікований pi-embed
 * (той самий ModelRegistry/AuthStorage, що й agent-fix), замість окремого
 * raw-pi-ai streaming-плюмбінгу.
 *
 * Замінює `callLlm`/прямий omlx-канал для не-agent задач. Pi вантажиться lazy
 * (тверда межа CI). Повертає structured `{ content, usage, error, model, caller }`.
 */

import { getRegistry, resolveModel, resolveModelSpec } from './pi-model-tiers.mjs'
import { writeTrace } from './pi-trace.mjs'

/** Дефолтний timeout одного one-shot виклику. */
const DEFAULT_TIMEOUT_MS = 120_000

/**
 * Дефолтна фабрика сесії (lazy pi). `noTools:'all'` → чистий completion.
 * Інструкції НЕ йдуть через `replaceInstructions`: слабкі локальні моделі (gemma-4b)
 * трактують system-prompt-інструкції як «правила для підтвердження» й мета-рамблять
 * замість виконувати. Тому system-повідомлення зливаються у prompt (див. runOneShot) —
 * перевірено: інлайн-інструкції модель ВИКОНУЄ, у system-промпті — переказує.
 * @returns {Promise<object>} pi AgentSession
 */
async function defaultCreateSession({ registry, model, cwd, thinkingLevel }) {
  const { createAgentSession, SessionManager } = await import('@earendil-works/pi-coding-agent')
  const { session } = await createAgentSession({
    modelRegistry: registry,
    model,
    noTools: 'all',
    thinkingLevel: thinkingLevel ?? 'off',
    cwd: cwd ?? process.cwd(),
    sessionManager: SessionManager.inMemory()
  })
  return session
}

/** Гонка проміса з таймаутом (мс ≤ 0 → без таймауту). */
async function withTimeout(promise, ms) {
  if (!ms || ms <= 0) return promise
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`one-shot timeout ${ms}ms`)), ms)
  })
  try {
    return await Promise.race([Promise.resolve(promise), timeout])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Виконує bounded one-shot LLM-виклик.
 * @param {{
 *   messages: Array<{role: string, content: string}>,
 *   modelTier?: 'min'|'avg'|'max',
 *   modelSpec?: string,
 *   thinkingLevel?: 'off'|'minimal'|'low'|'medium'|'high'|'xhigh',
 *   timeoutMs?: number,
 *   caller?: string,
 *   cwd?: string,
 *   deps?: { createSession?: Function, getRegistry?: Function, registry?: object, trace?: Function }
 * }} args параметри
 * @returns {Promise<{ content: string, usage: object|null, error: string|null, model: string|null, caller: string }>} результат
 */
export async function runOneShot({
  messages,
  modelTier = 'min',
  modelSpec,
  thinkingLevel,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  caller = 'one-shot',
  cwd,
  deps = {}
} = {}) {
  const createSession = deps.createSession ?? defaultCreateSession
  const getReg = deps.getRegistry ?? getRegistry
  const trace = deps.trace ?? writeTrace

  // Усі повідомлення (system+user) зливаються в один prompt — інлайн-інструкції
  // слабка локальна модель ВИКОНУЄ, а в system-промпті (replaceInstructions) — переказує.
  const userText = messages.map(m => m.content).join('\n\n')

  const fail = (error, model) => {
    trace({ caller, backend: 'pi-ai', kind: 'one-shot', model: model ?? null, cwd: cwd ?? null, error })
    return { content: '', usage: null, error, model: model ?? null, caller }
  }

  let registry
  let spec
  let model
  try {
    registry = deps.registry ?? (await getReg())
    spec = modelSpec ?? resolveModel(modelTier)
    model = spec ? resolveModelSpec(registry, spec) : null
    if (spec && !model) return fail(`модель не знайдена: ${spec}`, spec)
  } catch (e) {
    return fail(`registry: ${e.message}`, null)
  }

  let session
  try {
    session = await createSession({ registry, model, cwd, thinkingLevel })
  } catch (e) {
    return fail(`session: ${e.message}`, spec)
  }

  let text = ''
  let usage = null
  session.subscribe(event => {
    if (event.type === 'message_update' && event.assistantMessageEvent?.type === 'text_delta') {
      text += event.assistantMessageEvent.delta ?? ''
    } else if (event.type === 'message_end' && event.message?.usage) {
      usage = event.message.usage
    }
  })

  let error = null
  try {
    await withTimeout(session.prompt(userText), timeoutMs)
  } catch (e) {
    error = e.message
  }

  trace({ caller, backend: 'pi-ai', kind: 'one-shot', model: spec, cwd: cwd ?? null, usage, error })
  return { content: text.trim(), usage, error, model: spec, caller }
}

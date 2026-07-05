/** @see ./docs/one-shot.md */

/**
 * Bounded one-shot LLM-виклик поверх pi.
 *
 * Для не-agent consumers (генерація/judge доків, класифікація, ADR-normalize):
 * «messages → текст», без write-tool, без агентного циклу. Реалізовано як
 * `createAgentSession({ noTools: 'all' })` + `session.prompt` (агент без tools =
 * plain completion) — перевикористовує той самий ModelRegistry/AuthStorage,
 * що й agent-fix, замість окремого raw-pi-ai streaming-плюмбінгу.
 *
 * Pi вантажиться lazy (top-level import модуля pi-free). Повертає structured
 * `{ content, usage, error, model, caller }`.
 *
 * Виняток — memory-guard rejection локального model-сервера (нема RAM на prefill):
 * не structured-error-повернення, а негайний друк тіла запиту в stdout і Error —
 * ретраїти нема куди, RAM-стеля фіксована (fail-fast політика пакета).
 */

import { resolveModel } from './model-tiers.mjs'
import { getRegistry, resolveModelSpec } from './internal/registry.mjs'
import { failOnMemoryGuard } from './internal/memory-guard.mjs'
import { writeTrace } from './trace.mjs'
import { withTimeout } from './with-timeout.mjs'
import { applyMaxTokens } from './internal/max-tokens.mjs'

/** Дефолтний timeout одного one-shot виклику. */
const DEFAULT_TIMEOUT_MS = 120_000

/**
 * Дефолтна фабрика сесії (lazy pi). `noTools:'all'` → чистий completion.
 * Інструкції НЕ йдуть через `replaceInstructions`: слабкі локальні моделі (gemma-4b)
 * трактують system-prompt-інструкції як «правила для підтвердження» й мета-рамблять
 * замість виконувати. Тому system-повідомлення зливаються у prompt (див. runOneShot) —
 * перевірено: інлайн-інструкції модель ВИКОНУЄ, у system-промпті — переказує.
 * @param {object} args параметри створення сесії
 * @param {object} args.registry ModelRegistry pi
 * @param {object|null} args.model розвʼязана модель (spec → об'єкт)
 * @param {string} [args.cwd] робочий каталог сесії
 * @param {string} [args.thinkingLevel] рівень thinking (дефолт 'off')
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
  return applyMaxTokens(session)
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
 *   deps?: { createSession?: (args: object) => Promise<object>, getRegistry?: () => Promise<object>, registry?: object, trace?: (entry: object) => void }
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
  } catch (error) {
    return fail(`registry: ${error.message}`, null)
  }

  let session
  try {
    session = await createSession({ registry, model, cwd, thinkingLevel })
  } catch (error) {
    return fail(`session: ${error.message}`, spec)
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

  let promptError = null
  try {
    await withTimeout(session.prompt(userText), timeoutMs, { label: 'one-shot' })
  } catch (error) {
    promptError = error.message
    failOnMemoryGuard(promptError, userText)
  }

  trace({ caller, backend: 'pi-ai', kind: 'one-shot', model: spec, cwd: cwd ?? null, usage, error: promptError })
  return { content: text.trim(), usage, error: promptError, model: spec, caller }
}

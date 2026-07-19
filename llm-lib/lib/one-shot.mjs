/** @see ./docs/one-shot.md */

/**
 * Bounded one-shot LLM-виклик поверх pi.
 *
 * Для не-agent consumers (генерація/judge доків, класифікація, ADR-normalize):
 * «messages → текст», без write-tool, без агентного циклу. Реалізовано як
 * `createAgentSession({ noTools: 'all' })` + `session.prompt` (агент без tools =
 * plain completion) — перевикористовує той самий ModelRegistry (lazy singleton
 * getRegistry()), що й agent-fix, замість окремого raw-pi-ai streaming-плюмбінгу.
 *
 * Pi вантажиться lazy (top-level import модуля pi-free). Повертає structured
 * `{ content, usage, error, model, caller }`.
 *
 * Виняток — memory-guard rejection локального model-сервера (нема RAM на prefill):
 * не structured-error-повернення, а негайний друк тіла запиту в stdout і Error —
 * ретраїти нема куди, RAM-стеля фіксована (fail-fast політика пакета).
 */

import { formatModelSpec, isLocalModel, resolveModel } from './model-tiers.mjs'
import { getRegistry, resolveModelSpec } from './internal/registry.mjs'
import { failOnMemoryGuard } from './internal/memory-guard.mjs'
import { writeTrace } from './trace.mjs'
import { withTimeout } from './with-timeout.mjs'
import { applySessionMixins } from './internal/apply-session-mixins.mjs'
import { captureBody } from './body-capture.mjs'
import { promptHash } from './chain.mjs'

// Частина error-контракту fail-fast: consumers класифікують memory-guard помилку
// (пробити нагору й завершити процес) окремо від звичайних per-item помилок.
export { MEMORY_ERROR_RE } from './internal/memory-guard.mjs'

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
 * @param {number} [args.maxTokens] per-call стеля відповіді (undefined → дефолт пакета, 0 → без стелі)
 * @param {object|null} [args.chain] chain handle — домішує X-Chain-* заголовки (лише локальні моделі)
 * @returns {Promise<object>} pi AgentSession
 */
async function defaultCreateSession({ registry, model, cwd, thinkingLevel, maxTokens, chain }) {
  const { createAgentSession, SessionManager } = await import('@earendil-works/pi-coding-agent')
  const { session } = await createAgentSession({
    modelRegistry: registry,
    model,
    noTools: 'all',
    thinkingLevel: thinkingLevel ?? 'off',
    cwd: cwd ?? process.cwd(),
    sessionManager: SessionManager.inMemory()
  })
  return applySessionMixins(session, chain, maxTokens)
}

/**
 * Виконує bounded one-shot LLM-виклик.
 * @param {{
 *   messages: Array<{role: string, content: string}>,
 *   modelTier?: 'min'|'avg'|'max',
 *   modelSpec?: string,
 *   thinkingLevel?: 'off'|'minimal'|'low'|'medium'|'high'|'xhigh',
 *   timeoutMs?: number,
 *   maxTokens?: number,
 *   caller?: string,
 *   cwd?: string,
 *   chain?: object,
 *   deps?: { createSession?: (args: object) => Promise<object>, getRegistry?: () => Promise<object>, registry?: object, trace?: (entry: object) => void }
 * }} args параметри; `maxTokens` — per-call стеля відповіді (undefined → дефолт пакета, 0 → без стелі);
 *   `chain` — handle зі startChain: виклик стає кроком ланцюжка (chain-поля у trace, X-Chain-* заголовки локальним моделям)
 * @returns {Promise<{ content: string, usage: object|null, error: string|null, model: string|null, stopReason: string|null, caller: string }>} результат;
 *   `stopReason` — фініш останнього assistant-повідомлення (`'length'` = відповідь обрізана стелею; політика повтору — за колером)
 */
export async function runOneShot({
  messages,
  modelTier = 'min',
  modelSpec,
  thinkingLevel,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxTokens,
  caller = 'one-shot',
  cwd,
  chain = null,
  deps = {}
} = {}) {
  const createSession = deps.createSession ?? defaultCreateSession
  const getReg = deps.getRegistry ?? getRegistry
  const trace = deps.trace ?? writeTrace
  const capture = deps.captureBody ?? captureBody

  // Усі повідомлення (system+user) зливаються в один prompt — інлайн-інструкції
  // слабка локальна модель ВИКОНУЄ, а в system-промпті (replaceInstructions) — переказує.
  const userText = messages.map(m => m.content).join('\n\n')
  chain?.nextStep()
  const pHash = promptHash(userText)

  const fail = (error, model) => {
    chain?.note({ model: model ?? null, error })
    trace({
      caller,
      backend: 'pi-ai',
      kind: 'one-shot',
      model: model ?? null,
      cwd: cwd ?? null,
      error,
      promptHash: pHash,
      ...chain?.traceFields()
    })
    return { content: '', usage: null, error, model: model ?? null, stopReason: null, caller }
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
    // Заголовки кореляції — лише локальним моделям (myllm стоїть тільки перед ними).
    const headerChain = spec && isLocalModel(spec) ? chain : null
    session = await createSession({ registry, model, cwd, thinkingLevel, maxTokens, chain: headerChain })
  } catch (error) {
    return fail(`session: ${error.message}`, spec)
  }

  let text = ''
  let usage = null
  let stopReason = null
  session.subscribe(event => {
    if (event.type === 'message_update' && event.assistantMessageEvent?.type === 'text_delta') {
      text += event.assistantMessageEvent.delta ?? ''
    } else if (event.type === 'message_end' && event.message) {
      if (event.message.usage) usage = event.message.usage
      stopReason = event.message.stopReason ?? null
    }
  })

  let promptError = null
  try {
    await withTimeout(session.prompt(userText), timeoutMs, { label: 'one-shot' })
  } catch (error) {
    promptError = error.message
    failOnMemoryGuard(promptError, userText)
  }

  // spec порожній/нерозв'язаний ('' → pi сам вибирає дефолт) — беремо фактично
  // резолвлену pi-модель із сесії, щоб chain.note()/trace не бачили порожній
  // model і не потрапляли в неявний cloud-бакет (isLocalModel('') === false).
  const resolvedModel = spec || formatModelSpec(session.model)

  chain?.note({ model: resolvedModel, usage, error: promptError, stopReason })
  trace({
    caller,
    backend: 'pi-ai',
    kind: 'one-shot',
    model: resolvedModel,
    cwd: cwd ?? null,
    usage,
    stopReason,
    error: promptError,
    promptHash: pHash,
    ...chain?.traceFields()
  })
  capture({
    chainId: chain?.traceFields()?.chainId,
    caller,
    step: chain?.traceFields()?.chainStep,
    model: resolvedModel,
    promptHash: pHash,
    prompt: userText,
    output: text.trim(),
    usage,
    error: promptError
  })
  return { content: text.trim(), usage, error: promptError, model: resolvedModel, stopReason, caller }
}

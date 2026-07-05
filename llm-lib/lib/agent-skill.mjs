/** @see ./docs/agent-skill.md */

/**
 * Agentic skill-runner поверх pi `createAgentSession`.
 *
 * Виконує один скіл як pi-агента: готовий промпт-рядок → `session.prompt`.
 * Повний user-trust набір вбудованих tools (`read/grep/find/edit/write/ls/bash`), БЕЗ
 * write-guard — скіл є явною user-invocation (паритет із `claude -p`, який теж без
 * обмежень). Модель — з ОДНОГО тиру (дефолт `max`), без escalation-сходів fix-engine.
 * Runaway-backstop: turn-ceiling + per-call timeout. Асистентський текст стрімиться
 * у stdout (паритет із `claude -p`). Телеметрія `kind:"skill"` у глобальний trace.
 *
 * Pi вантажиться lazy (top-level import модуля pi-free). Логіка інжектована через
 * `deps` для unit-тестів.
 *
 * Виняток — memory-guard rejection локального model-сервера: друк скіл-промпту
 * в stdout і Error замість structured error (fail-fast політика пакета).
 */

import { env, stdout } from 'node:process'
import { resolveModel } from './model-tiers.mjs'
import { getRegistry, resolveModelSpec } from './internal/registry.mjs'
import { failOnMemoryGuard } from './internal/memory-guard.mjs'
import { writeTrace } from './trace.mjs'
import { applyMaxTokens } from './internal/max-tokens.mjs'
import { withTimeout } from './with-timeout.mjs'

/** Аварійна стеля turns на сесію скіла (runaway-backstop). Override: `N_LLM_SKILL_TURN_CEILING` (legacy `N_CURSOR_SKILL_TURN_CEILING`). */
const TURN_CEILING = Number(env.N_LLM_SKILL_TURN_CEILING ?? env.N_CURSOR_SKILL_TURN_CEILING) || 80

/** Дефолтний timeout одного скіл-виклику (скіли довгі). Override: `N_LLM_SKILL_TIMEOUT_MS` (legacy `N_CURSOR_SKILL_TIMEOUT_MS`). */
const DEFAULT_TIMEOUT_MS = Number(env.N_LLM_SKILL_TIMEOUT_MS ?? env.N_CURSOR_SKILL_TIMEOUT_MS) || 600_000

/** Повний user-trust набір вбудованих tools. `bash` — обовʼязковий (taze→bun, coverage→тести). */
const SKILL_TOOLS = ['read', 'grep', 'find', 'edit', 'write', 'ls', 'bash']

/** Тира скіла → pi `thinkingLevel` (одна тира на виклик, без rung-сходів). */
const THINKING_BY_TIER = { min: 'low', avg: 'medium', max: 'high' }

/**
 * Дефолтна фабрика pi-сесії: повний tool-set із `bash`, БЕЗ custom-tools і write-guard.
 * @param {{ registry: object, model: object|null, cwd?: string, thinkingLevel?: string }} args параметри сесії.
 * @returns {Promise<object>} pi AgentSession
 */
async function defaultCreateSession({ registry, model, cwd, thinkingLevel }) {
  const { createAgentSession, SessionManager } = await import('@earendil-works/pi-coding-agent')
  const { session } = await createAgentSession({
    modelRegistry: registry,
    model,
    tools: SKILL_TOOLS,
    thinkingLevel: thinkingLevel ?? 'medium',
    cwd: cwd ?? process.cwd(),
    sessionManager: SessionManager.inMemory()
  })
  return applyMaxTokens(session)
}

/**
 * Виконує ОДИН скіл агентно через pi.
 * @param {string} prompt готовий промпт скіла.
 * @param {{
 *   skillId?: string,
 *   tier?: 'min'|'avg'|'max',
 *   modelSpec?: string,
 *   cwd?: string,
 *   thinkingLevel?: 'off'|'minimal'|'low'|'medium'|'high'|'xhigh',
 *   timeoutMs?: number,
 *   caller?: string,
 *   deps?: { createSession?: (args: object) => Promise<object>, getRegistry?: () => Promise<object>, registry?: object, trace?: (entry: object) => void, clock?: () => number, out?: (s: string) => void }
 * }} [opts] опції виконання скіла.
 * @returns {Promise<{ ok: boolean, telemetry: object|null, error: string|null }>} результат прогону скіла.
 */
export async function runAgentSkill(prompt, opts = {}) {
  const {
    skillId = 'skill',
    tier = 'max',
    modelSpec,
    cwd = process.cwd(),
    thinkingLevel,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    caller = `skill:${skillId}`,
    deps = {}
  } = opts
  const createSession = deps.createSession ?? defaultCreateSession
  const getReg = deps.getRegistry ?? getRegistry
  const trace = deps.trace ?? writeTrace
  const clock = deps.clock ?? (() => Date.now())
  const out = deps.out ?? (s => stdout.write(s))

  const fail = (error, model) => {
    trace({ caller, backend: 'pi-ai', kind: 'skill', skill: skillId, tier, model: model ?? null, cwd, error })
    return { ok: false, telemetry: null, error }
  }

  let registry
  let spec
  let model
  try {
    registry = deps.registry ?? (await getReg())
    spec = modelSpec ?? resolveModel(tier) // '' допустимо → дефолт провайдера pi
    model = spec ? resolveModelSpec(registry, spec) : null
    if (spec && !model) return fail(`модель не знайдена: ${spec}`, spec)
  } catch (error) {
    return fail(`registry: ${error.message}`, null)
  }

  let session
  try {
    session = await createSession({
      registry,
      model,
      cwd,
      thinkingLevel: thinkingLevel ?? THINKING_BY_TIER[tier] ?? 'medium'
    })
  } catch (error) {
    return fail(`session: ${error.message}`, spec)
  }

  let turnCount = 0
  let toolCallCount = 0
  let backstopHit = false
  session.subscribe(event => {
    switch (event.type) {
      case 'turn_start': {
        turnCount++
        if (turnCount > TURN_CEILING) {
          backstopHit = true
          session.abort?.()
        }
        break
      }
      case 'tool_execution_start': {
        toolCallCount++
        break
      }
      case 'message_update': {
        if (event.assistantMessageEvent?.type === 'text_delta') {
          out(event.assistantMessageEvent.delta ?? '')
        }
        break
      }
      default: {
        break
      }
    }
  })

  const startedAt = clock()
  let error = null
  try {
    await withTimeout(session.prompt(prompt), timeoutMs, { onTimeout: () => session.abort?.(), label: 'skill' })
  } catch (promptError) {
    error = promptError.message
    failOnMemoryGuard(error, prompt)
  }

  const telemetry = {
    skill: skillId,
    tier,
    model: spec || null,
    turnCount,
    toolCallCount,
    backstopHit,
    wallMs: clock() - startedAt
  }
  trace({
    caller,
    backend: 'pi-ai',
    kind: 'skill',
    skill: skillId,
    tier,
    model: spec || null,
    cwd,
    turnCount,
    toolCallCount,
    backstopHit,
    error
  })
  return { ok: !error && !backstopHit, telemetry, error }
}

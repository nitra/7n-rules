/** @see ./docs/agent-fix.md */

/**
 * Agentic fix-worker поверх pi `createAgentSession`.
 *
 * Агентний цикл, де pi сам читає контекст і **застосовує патч** вбудованими
 * `edit`/`write`. Інтегрує:
 *   - тири → Model ([model-tiers] + [internal/registry]),
 *   - write-safety ([write-guard]) через `DefaultResourceLoader` + **fail-closed canary**,
 *   - custom-tools `ast_facts` і `self_check` (advisory) — обидва інжектовані consumer-ом,
 *   - turn-ceiling backstop (`session.abort()` на перевищенні),
 *   - телеметрію (turns/tool-calls/повні edits) у [trace].
 *
 * Контракт (application-agnostic seam): повертає `{ applied, touchedFiles, telemetry,
 * error, rollback }` — застосуванням володіє worker, orchestrator робить лише зовнішній
 * verdict-recheck і за провалу кличе `rollback()` (clean-slate per rung).
 *
 * Pi вантажиться lazy (top-level import модуля pi-free). Логіка інжектована через
 * `deps` для unit-тестів; `deps.astContext` — споживацький AST-екстрактор (напр.
 * oxc-based у `@nitra/cursor`), без нього tool чесно відповідає «недоступний».
 *
 * Виняток — memory-guard rejection локального model-сервера ([internal/memory-guard]):
 * друк fix-промпту в stdout і Error замість structured error (fail-fast політика пакета).
 */

import { env } from 'node:process'
import { homedir } from 'node:os'
import { getRegistry, resolveModelSpec } from './internal/registry.mjs'
import { thinkingLevelForTier } from './model-tiers.mjs'
import { createWriteGuard, gitRoot } from './write-guard.mjs'
import { failOnMemoryGuard } from './internal/memory-guard.mjs'
import { writeTrace } from './trace.mjs'
import { withTimeout } from './with-timeout.mjs'
import { applyMaxTokens } from './internal/max-tokens.mjs'

/** Аварійна стеля turns на одну сесію (runaway-backstop). Override: `N_LLM_FIX_TURN_CEILING` (legacy `N_CURSOR_FIX_TURN_CEILING`). */
const TURN_CEILING = Number(env.N_LLM_FIX_TURN_CEILING ?? env.N_CURSOR_FIX_TURN_CEILING) || 50

/**
 * Дефолтний таймаут fix-спроби, коли consumer не передав `opts.timeoutMs`.
 * `withTimeout` при falsy `ms` НЕ влаштовує гонки — без дефолту зависла SSE-сесія
 * (спостережено: ESTABLISHED TCP годинами) блокувала виклик назавжди. Consumer-и
 * з per-tier таймаутами (ladder, ADR 260620-0556) передають власні значення.
 */
const DEFAULT_TIMEOUT_MS = 300_000

/**
 * Порожній rollback для fail-шляхів.
 * @returns {void}
 */
function noop() {
  /* навмисно порожньо: нема чого відкочувати */
}

/**
 * Маркер недоступності `astContext`.
 * @returns {{ error: string }} повідомлення про недоступність AST facts
 */
function astUnavailable() {
  return { error: 'ast_facts недоступний: consumer не надав astContext' }
}

/**
 * Будує fix-промпт для рунга: правило + порушення + (опц.) target-файли + (опц.) feedback
 * попереднього провалу + жорсткий блок обмежень (лише механічні зміни) + інструкція
 * «ast_facts перед edit, self_check після».
 *
 * Блок обмежень — перший шар semantic-collateral guard (спека pi-migration §12,
 * addendum 2026-07-05): слабкі локальні моделі схильні «виправляти» правило семантичною
 * правкою (хардкод значення, симуляція поведінки) — промпт явно це забороняє, а
 * verdict-veto consumer-а (re-check) відхиляє такі правки поза target-файлами.
 * @param {{ ruleId: string, violation: string, ruleText?: string, feedback?: object,
 *   targetFiles?: string[] }} args параметри промпта; `targetFiles` — файли порушення,
 *   єдині наявні файли, які дозволено редагувати (порожньо/відсутнє — без переліку).
 * @returns {string} промпт
 */
export function buildFixPrompt({ ruleId, violation, ruleText, feedback, targetFiles }) {
  const parts = [`Виправ порушення правила "${ruleId}" у цьому проєкті.`]
  if (ruleText) parts.push(`## Правило\n${ruleText}`)
  parts.push(`## Порушення\n${violation}`)
  if (Array.isArray(targetFiles) && targetFiles.length > 0) {
    parts.push(
      '## Target-файли (єдині наявні файли, які дозволено редагувати)\n' + targetFiles.map(f => `- ${f}`).join('\n')
    )
  }
  if (feedback?.previousError) {
    parts.push(`## Попередня спроба не спрацювала\n${feedback.previousError}\nСпробуй інший підхід.`)
  }
  parts.push(
    '## Обмеження (обовʼязкові)\n' +
      'Дозволені ЛИШЕ механічні зміни, що прямо усувають наведене порушення правила:\n' +
      '- НЕ змінюй бізнес-логіку і поведінку коду.\n' +
      '- НЕ хардкодь значення замість викликів функцій чи обчислень.\n' +
      '- НЕ симулюй і не заглушуй поведінку (stub/mock/"simulate").\n' +
      '- НЕ редагуй наявні файли поза порушенням; нові файли створюй лише якщо цього прямо вимагає правило.\n' +
      'Якщо порушення не усувається механічною правкою — зупинись, нічого не змінюючи.',
    'Перед редагуванням JS/TS-файлу спершу виклич `ast_facts` на ньому. ' +
      'Після правок виклич `self_check`, щоб підтвердити, що порушення зникло. ' +
      'Редагуй лише потрібне, не чіпай стороннє.'
  )
  return parts.join('\n\n')
}

/**
 * Дефолтна фабрика pi-сесії: loader із write-guard, custom-tools ast_facts+self_check.
 * @param {{ registry: object, model: object, thinkingLevel?: string, cwd: string,
 *   factory: (pi: { on: (event: string, handler: (event: object) => void) => void }) => void,
 *   astContext: (path: string) => object,
 *   selfCheck: (files: string[]) => Promise<{ ok: boolean, output: string }> | { ok: boolean, output: string } }} args параметри сесії.
 * @returns {Promise<object>} pi AgentSession
 */
async function defaultCreateSession({ registry, model, thinkingLevel, cwd, factory, astContext, selfCheck }) {
  const { createAgentSession, SessionManager, DefaultResourceLoader, SettingsManager, defineTool } =
    await import('@earendil-works/pi-coding-agent')
  const agentDir = `${homedir()}/.pi/agent`
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager: SettingsManager.create(cwd, agentDir),
    extensionFactories: [factory]
  })
  await loader.reload()

  const astTool = defineTool({
    name: 'ast_facts',
    label: 'AST facts',
    description:
      'Extract structured AST facts (imports, exports, top-level functions) from a JS/TS source file. Call this before editing a file to understand it without reading the whole content.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'file path' } },
      required: ['path']
    },
    execute: (_id, { path }) => ({
      content: [{ type: 'text', text: JSON.stringify(astContext(path)) }],
      details: {}
    })
  })
  const checkTool = defineTool({
    name: 'self_check',
    label: 'Self check',
    description:
      'Re-run the rule check on the given files to see whether the violation is resolved. Advisory: use it to decide if more edits are needed.',
    parameters: { type: 'object', properties: { files: { type: 'array', items: { type: 'string' } } }, required: [] },
    execute: async (_id, { files }) => ({
      content: [{ type: 'text', text: JSON.stringify(await selfCheck(files ?? [])) }],
      details: {}
    })
  })

  const { session } = await createAgentSession({
    modelRegistry: registry,
    model,
    thinkingLevel,
    cwd,
    tools: ['read', 'grep', 'find', 'edit', 'write', 'ls', 'ast_facts', 'self_check'],
    customTools: [astTool, checkTool],
    sessionManager: SessionManager.inMemory(),
    resourceLoader: loader
  })
  return applyMaxTokens(session)
}

/**
 * Проводить ОДНУ агентну fix-спробу (рунг) для правила.
 * @param {string} ruleId id правила
 * @param {string} violation violation-output
 * @param {string} cwd корінь проєкту
 * @param {{
 *   model: string, tier?: string, feedback?: object, caller?: string, timeoutMs?: number, ruleText?: string,
 *   targetFiles?: string[],
 *   deps?: { createSession?: (args: object) => Promise<object>, getRegistry?: () => Promise<object>,
 *            registry?: object, root?: string|null,
 *            astContext?: (path: string) => object,
 *            selfCheck?: (files: string[]) => Promise<{ ok: boolean, output: string }> | { ok: boolean, output: string },
 *            trace?: (entry: object) => void, clock?: () => number }
 * }} opts опції fix-спроби (модель, тир, feedback, таймаут, ін'єкції consumer-а/тестів).
 * @returns {Promise<{ applied: boolean, touchedFiles: string[], telemetry: object|null, error: string|null, rollback: () => void }>} результат fix-спроби.
 */
export async function runAgentFix(ruleId, violation, cwd, opts = {}) {
  const {
    model: modelSpec,
    tier = null,
    feedback,
    caller = `fix:${ruleId}`,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    ruleText,
    targetFiles,
    deps = {}
  } = opts
  const createSession = deps.createSession ?? defaultCreateSession
  const getReg = deps.getRegistry ?? getRegistry
  const trace = deps.trace ?? writeTrace
  const clock = deps.clock ?? (() => Date.now())
  const astContext = deps.astContext ?? astUnavailable
  const selfCheck = deps.selfCheck ?? (() => ({ ok: false, output: 'self_check недоступний' }))
  // Фактичний sampling knob payload-а: провайдер отримує лише model + thinkingLevel
  // (temperature не задається), тому trace фіксує саме їх.
  const thinkingLevel = thinkingLevelForTier(tier ?? '')

  const fail = error => {
    trace({
      caller,
      backend: 'pi-ai',
      kind: 'agent',
      rule: ruleId,
      rung: tier,
      model: modelSpec,
      thinkingLevel,
      cwd,
      error
    })
    return { applied: false, touchedFiles: [], telemetry: null, error, rollback: noop }
  }

  // git-precondition: нема git → fix пропускається.
  const root = deps.root === undefined ? gitRoot(cwd) : deps.root
  if (!root) return fail('fix пропущено: не git-репо (write-guard precondition)')

  let registry
  let model
  try {
    registry = deps.registry ?? (await getReg())
    model = resolveModelSpec(registry, modelSpec)
    if (!model) return fail(`модель не знайдена: ${modelSpec}`)
  } catch (error) {
    return fail(`registry: ${error.message}`)
  }

  // onCapture — bridge у central rollback consumer-а (напр. ctx.recordWrite).
  const guard = createWriteGuard({ cwd, root, onCapture: opts.recordWrite })
  let session
  try {
    session = await createSession({
      registry,
      model,
      thinkingLevel,
      cwd,
      factory: guard.factory,
      astContext,
      selfCheck
    })
  } catch (error) {
    return fail(`session: ${error.message}`)
  }

  // Fail-closed canary: guard мусив приєднатись через loader.
  if (!guard.state.attached) return fail('write-guard не приєднався — fix скасовано (fail-closed)')

  // Телеметрія із subscribe + turn-ceiling backstop.
  const turns = []
  let turnCount = 0
  let toolCallCount = 0
  let backstopHit = false
  session.subscribe(event => {
    switch (event.type) {
      case 'turn_start': {
        turnCount++
        turns.push({ i: turnCount, toolCalls: [], usage: null, finish: null })
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
      case 'tool_execution_end': {
        turns.at(-1)?.toolCalls.push({ name: event.toolName, status: event.isError ? 'error' : 'ok' })
        break
      }
      case 'message_end': {
        const t = turns.at(-1)
        if (t && event.message?.usage) {
          t.usage = event.message.usage
          t.finish = event.message.stopReason ?? null
        }
        break
      }
      default: {
        break
      }
    }
  })

  const fixPrompt = buildFixPrompt({ ruleId, violation, ruleText, feedback, targetFiles })
  const startedAt = clock()
  let error = null
  try {
    await withTimeout(session.prompt(fixPrompt), timeoutMs, { onTimeout: () => session.abort?.(), label: 'fix' })
  } catch (promptError) {
    error = promptError.message
    failOnMemoryGuard(error, fixPrompt)
  }

  const touchedFiles = guard.touchedFiles()
  const telemetry = {
    rule: ruleId,
    rung: tier,
    model: modelSpec,
    turns,
    turnCount,
    toolCallCount,
    edits: guard.state.editLog,
    blocks: guard.state.blocks,
    backstopHit,
    wallMs: clock() - startedAt
  }
  trace({
    caller,
    backend: 'pi-ai',
    kind: 'agent',
    rule: ruleId,
    rung: tier,
    model: modelSpec,
    thinkingLevel,
    cwd,
    // ВХІД LLM (щоб «що подали» було видно прямо у trace):
    // violation — обрізаний (може бути великим); promptChars — повний розмір промпта.
    violation: typeof violation === 'string' ? violation.slice(0, 4000) : null,
    violationChars: typeof violation === 'string' ? violation.length : 0,
    promptChars: fixPrompt.length,
    // вихід:
    turnCount,
    toolCallCount,
    touchedFiles,
    backstopHit,
    wallMs: clock() - startedAt,
    error
  })
  return { applied: touchedFiles.length > 0, touchedFiles, telemetry, error, rollback: guard.rollback }
}

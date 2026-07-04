/** @see ./docs/pi-agent-fix.md */

/**
 * Agentic fix-worker поверх pi `createAgentSession` (§1/§2/§5/§12 спеки pi-migration).
 *
 * Замінює `llm-worker.runLlmWorker` (`{changes}`+`applyChanges`) на агентний цикл, де
 * pi сам читає контекст і **застосовує патч** вбудованими `edit`/`write`. Інтегрує:
 *   - тири → Model ([pi-model-tiers]),
 *   - write-safety §12 ([pi-write-guard]) через `DefaultResourceLoader` + **fail-closed canary**,
 *   - custom-tools `ast_facts` (§3б) і `self_check` (§4+5, advisory),
 *   - turn-ceiling backstop (`session.abort()` на перевищенні),
 *   - телеметрію §7 (turns/tool-calls/повні edits) у [pi-trace].
 *
 * Контракт (application-agnostic seam §2): повертає `{ applied, touchedFiles, telemetry,
 * error, rollback }` — застосуванням володіє worker, orchestrator робить лише зовнішній
 * verdict-recheck і за провалу кличе `rollback()` (clean-slate per rung).
 *
 * Pi вантажиться lazy (тверда межа CI). Логіка інжектована через `deps` для unit-тестів.
 *
 * Виняток — memory-guard rejection локального model-сервера ([pi-memory-guard]):
 * друк fix-промпту в stdout і негайний `process.exit(1)` замість structured error.
 */

import { env } from 'node:process'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { getRegistry, resolveModelSpec, thinkingLevelForTier } from './pi-model-tiers.mjs'
import { createWriteGuard, gitRoot } from './pi-write-guard.mjs'
import { failOnMemoryGuard } from './pi-memory-guard.mjs'
import { writeTrace } from './pi-trace.mjs'
import { withTimeout } from './pi-with-timeout.mjs'
import { extractContext } from '../scripts/utils/ast-extract.mjs'

/** Аварійна стеля turns на одну сесію (runaway-backstop §4+5). Override: `N_CURSOR_FIX_TURN_CEILING`. */
const TURN_CEILING = Number(env.N_CURSOR_FIX_TURN_CEILING) || 50

/** No-op rollback для fail-шляхів, коли сесія ще не створена. */
function noop() {
  /* навмисно порожньо: нема чого відкочувати */
}

/**
 * Будує fix-промпт для рунга: правило + порушення + (опц.) feedback попереднього провалу
 * + інструкція «ast_facts перед edit, self_check після».
 * @param {{ ruleId: string, violation: string, ruleText?: string, feedback?: object }} args параметри промпта.
 * @returns {string} промпт
 */
export function buildFixPrompt({ ruleId, violation, ruleText, feedback }) {
  const parts = [`Виправ порушення правила "${ruleId}" у цьому проєкті.`]
  if (ruleText) parts.push(`## Правило\n${ruleText}`)
  parts.push(`## Порушення\n${violation}`)
  if (feedback?.previousError) {
    parts.push(`## Попередня спроба не спрацювала\n${feedback.previousError}\nСпробуй інший підхід.`)
  }
  parts.push(
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
  return session
}

/**
 * Проводить ОДНУ агентну fix-спробу (рунг) для правила.
 * @param {string} ruleId id правила
 * @param {string} violation violation-output (вже з concern-маркерами §1а)
 * @param {string} cwd корінь проєкту
 * @param {{
 *   model: string, tier?: string, feedback?: object, caller?: string, timeoutMs?: number, ruleText?: string,
 *   deps?: { createSession?: (args: object) => Promise<object>, getRegistry?: () => Promise<object>,
 *            registry?: object, root?: string|null,
 *            astContext?: (path: string) => object,
 *            selfCheck?: (files: string[]) => Promise<{ ok: boolean, output: string }> | { ok: boolean, output: string },
 *            trace?: (entry: object) => void, clock?: () => number }
 * }} opts опції fix-спроби (модель, тир, feedback, таймаут, ін'єкції для тестів).
 * @returns {Promise<{ applied: boolean, touchedFiles: string[], telemetry: object|null, error: string|null, rollback: () => void }>} результат fix-спроби.
 */
export async function runPiAgentFix(ruleId, violation, cwd, opts = {}) {
  const { model: modelSpec, tier = null, feedback, caller = `fix:${ruleId}`, timeoutMs, ruleText, deps = {} } = opts
  const createSession = deps.createSession ?? defaultCreateSession
  const getReg = deps.getRegistry ?? getRegistry
  const trace = deps.trace ?? writeTrace
  const clock = deps.clock ?? (() => Date.now())
  const astContext = deps.astContext ?? (p => extractContext(resolve(cwd, p)))
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

  // §12 git-precondition: нема git → fix пропускається.
  const root = deps.root === undefined ? gitRoot(cwd) : deps.root
  if (!root) return fail('fix пропущено: не git-репо (§12 precondition)')

  let registry
  let model
  try {
    registry = deps.registry ?? (await getReg())
    model = resolveModelSpec(registry, modelSpec)
    if (!model) return fail(`модель не знайдена: ${modelSpec}`)
  } catch (error) {
    return fail(`registry: ${error.message}`)
  }

  // onCapture — bridge у central rollback unified lint surface (ctx.recordWrite).
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

  // §12 fail-closed canary: guard мусив приєднатись через loader.
  if (!guard.state.attached) return fail('write-guard не приєднався — fix скасовано (§12 fail-closed)')

  // Телеметрія §7 із subscribe + turn-ceiling backstop.
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

  const fixPrompt = buildFixPrompt({ ruleId, violation, ruleText, feedback })
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

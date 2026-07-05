/**
 * Тести pi-agent-skill: happy-path контракт {ok,telemetry,error}, стрім тексту у out,
 * turn-ceiling backstop (abort), prompt-error, model-not-found, trace kind:"skill".
 * Сесія інжектована (fake), registry інжектований — pi не вантажиться.
 */

import { afterEach, describe, expect, test, vi } from 'vitest'
import { runAgentSkill } from '../lib/agent-skill.mjs'

const RE_HEX16 = /^[0-9a-f]{16}$/
const registry = { find: (p, id) => ({ provider: p, id }) }

const RE_NOT_FOUND = /не знайдена/

/**
 * No-op placeholder для subscribe-хендлера до реєстрації.
 * @returns {null} маркер відсутньої дії
 */
const noop = () => null

/**
 * Fake pi-сесія: драйвить задані події у subscribe-хендлер і (опц.) кидає у prompt.
 * @param {object} [opts] опції
 * @param {Array<object>} [opts.events] події, що емітяться у subscribe-хендлер
 * @param {string|null} [opts.promptError] якщо задано — prompt кидає з цим текстом
 * @returns {{ session: object, abort: import('vitest').Mock }} fake-сесія + abort-spy
 */
function fakeSession({ events = [], promptError = null } = {}) {
  const abort = vi.fn()
  let handler = noop
  const session = {
    subscribe: fn => {
      handler = fn
    },
    abort,
    prompt: async () => {
      await Promise.resolve()
      for (const e of events) handler(e)
      if (promptError) throw new Error(promptError)
    }
  }
  return { session, abort }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('runAgentSkill', () => {
  test('happy-path: ok, телеметрія, стрім тексту, trace kind:"skill"', async () => {
    const { session } = fakeSession({
      events: [
        { type: 'turn_start' },
        { type: 'tool_execution_start', toolName: 'bash' },
        { type: 'tool_execution_start', toolName: 'edit' },
        { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'Готово' } }
      ]
    })
    const trace = vi.fn()
    const out = []
    const r = await runAgentSkill('PROMPT', {
      skillId: 'taze',
      tier: 'avg',
      cwd: '/proj',
      deps: {
        registry,
        createSession: () => Promise.resolve(session),
        trace,
        clock: () => 0,
        out: s => {
          out.push(s)
        }
      }
    })

    expect(r.ok).toBe(true)
    expect(r.error).toBeNull()
    expect(r.telemetry).toMatchObject({
      skill: 'taze',
      tier: 'avg',
      turnCount: 1,
      toolCallCount: 2,
      backstopHit: false
    })
    expect(out.join('')).toBe('Готово')
    expect(trace).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'skill', skill: 'taze', backend: 'pi-ai', caller: 'skill:taze' })
    )
  })

  test('createSession отримує тиру → thinkingLevel і cwd', async () => {
    const { session } = fakeSession()
    const createSession = vi.fn(() => Promise.resolve(session))
    await runAgentSkill('P', {
      skillId: 's',
      tier: 'max',
      cwd: '/here',
      deps: { registry, createSession, trace: vi.fn() }
    })
    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({ cwd: '/here', thinkingLevel: 'high' }))
  })

  test('maxTokens прокидається у createSession (0 = без стелі)', async () => {
    const { session } = fakeSession()
    const createSession = vi.fn(() => Promise.resolve(session))
    await runAgentSkill('P', {
      skillId: 's',
      modelSpec: 'omlx/x',
      maxTokens: 0,
      deps: { registry, createSession, trace: vi.fn() }
    })
    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({ maxTokens: 0 }))
  })

  test('з chain: step/note/chain-поля у trace; хмарна модель → chain:null у сесію', async () => {
    const { session } = fakeSession()
    const createSession = vi.fn(() => Promise.resolve(session))
    const trace = vi.fn()
    const chain = {
      nextStep: vi.fn(() => 1),
      note: vi.fn(),
      traceFields: () => ({ chainId: 'cs1', chainKind: 'k', chainUnit: 'u', chainStep: 1 }),
      headers: () => ({})
    }
    await runAgentSkill('P', {
      skillId: 's',
      modelSpec: 'openai/gpt-5.5',
      chain,
      deps: { registry, createSession, trace }
    })
    expect(chain.nextStep).toHaveBeenCalledTimes(1)
    expect(chain.note).toHaveBeenCalledWith(expect.objectContaining({ model: 'openai/gpt-5.5' }))
    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({ chain: null }))
    expect(trace).toHaveBeenCalledWith(
      expect.objectContaining({ chainId: 'cs1', promptHash: expect.stringMatching(RE_HEX16) })
    )
  })

  test('prompt кидає → ok:false + error', async () => {
    const { session } = fakeSession({ events: [{ type: 'turn_start' }], promptError: 'boom' })
    const r = await runAgentSkill('P', {
      skillId: 's',
      deps: { registry, createSession: () => Promise.resolve(session), trace: vi.fn() }
    })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('boom')
  })

  test('turn-ceiling backstop → abort + ok:false', async () => {
    const events = Array.from({ length: 81 }, () => ({ type: 'turn_start' }))
    const { session, abort } = fakeSession({ events })
    const r = await runAgentSkill('P', {
      skillId: 's',
      deps: { registry, createSession: () => Promise.resolve(session), trace: vi.fn() }
    })
    expect(abort).toHaveBeenCalled()
    expect(r.telemetry.backstopHit).toBe(true)
    expect(r.ok).toBe(false)
  })

  test('memory-guard rejection → друкує скіл-промпт у stdout і кидає Error', async () => {
    const memoryMsg = 'Prefill would require ~12.32 GB peak but metal_cap ceiling is 11.84 GB.'
    const { session } = fakeSession({ events: [{ type: 'turn_start' }], promptError: memoryMsg })
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => null)

    await expect(
      runAgentSkill('PROMPT', {
        skillId: 's',
        deps: { registry, createSession: () => Promise.resolve(session), trace: vi.fn() }
      })
    ).rejects.toThrow('omlx memory-guard')

    expect(logSpy).toHaveBeenCalledWith('PROMPT')
  })

  test('модель не знайдена (modelSpec непорожній, registry → null) → error', async () => {
    const r = await runAgentSkill('P', {
      skillId: 's',
      modelSpec: 'openai/missing',
      deps: { registry: { find: () => null }, createSession: vi.fn(), trace: vi.fn() }
    })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(RE_NOT_FOUND)
  })
})

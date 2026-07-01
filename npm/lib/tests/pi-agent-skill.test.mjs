/**
 * Тести pi-agent-skill: happy-path контракт {ok,telemetry,error}, стрім тексту у out,
 * turn-ceiling backstop (abort), prompt-error, model-not-found, trace kind:"skill".
 * Сесія інжектована (fake), registry інжектований — pi не вантажиться.
 */

import { afterEach, describe, expect, test, vi } from 'vitest'
import { runPiAgentSkill } from '../pi-agent-skill.mjs'

const registry = { find: (p, id) => ({ provider: p, id }) }

/** Fake pi-сесія: драйвить задані події у subscribe-хендлер і (опц.) кидає у prompt. */
function fakeSession({ events = [], promptError = null } = {}) {
  const abort = vi.fn()
  let handler = () => {}
  const session = {
    subscribe: fn => {
      handler = fn
    },
    abort,
    prompt: async () => {
      for (const e of events) handler(e)
      if (promptError) throw new Error(promptError)
    }
  }
  return { session, abort }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('runPiAgentSkill', () => {
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
    const r = await runPiAgentSkill('PROMPT', {
      skillId: 'taze',
      tier: 'avg',
      cwd: '/proj',
      deps: {
        registry,
        createSession: async () => session,
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
    const createSession = vi.fn(async () => session)
    await runPiAgentSkill('P', {
      skillId: 's',
      tier: 'max',
      cwd: '/here',
      deps: { registry, createSession, trace: vi.fn() }
    })
    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({ cwd: '/here', thinkingLevel: 'high' }))
  })

  test('prompt кидає → ok:false + error', async () => {
    const { session } = fakeSession({ events: [{ type: 'turn_start' }], promptError: 'boom' })
    const r = await runPiAgentSkill('P', {
      skillId: 's',
      deps: { registry, createSession: async () => session, trace: vi.fn() }
    })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('boom')
  })

  test('turn-ceiling backstop → abort + ok:false', async () => {
    const events = Array.from({ length: 81 }, () => ({ type: 'turn_start' }))
    const { session, abort } = fakeSession({ events })
    const r = await runPiAgentSkill('P', {
      skillId: 's',
      deps: { registry, createSession: async () => session, trace: vi.fn() }
    })
    expect(abort).toHaveBeenCalled()
    expect(r.telemetry.backstopHit).toBe(true)
    expect(r.ok).toBe(false)
  })

  test('модель не знайдена (modelSpec непорожній, registry → null) → error', async () => {
    const r = await runPiAgentSkill('P', {
      skillId: 's',
      modelSpec: 'openai/missing',
      deps: { registry: { find: () => null }, createSession: vi.fn(), trace: vi.fn() }
    })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/не знайдена/)
  })
})

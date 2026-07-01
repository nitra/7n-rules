/**
 * Тести pi-one-shot: text-capture з subscribe, usage з message_end, error-шляхи,
 * timeout. Сесія/registry/trace інжектуються (без pi).
 */

import { setTimeout as sleep } from 'node:timers/promises'
import { describe, expect, test, vi } from 'vitest'
import { runOneShot } from '../pi-one-shot.mjs'

const RE_NOT_FOUND = /не знайдена/
const RE_TIMEOUT = /timeout/
const RE_REGISTRY_ERR = /registry: no reg/

/** No-op placeholder для subscribe-хендлера до реєстрації. */
const noop = () => {
  /* no-op */
}

/**
 * Fake AgentSession: емітить text_delta + message_end, опційно кидає/затримує.
 * @param {object} [opts] опції
 * @param {string[]} [opts.deltas] text_delta-фрагменти для стріму
 * @param {object|null} [opts.usage] usage у message_end (або без нього)
 * @param {string|null} [opts.promptError] якщо задано — prompt кидає з цим текстом
 * @param {number} [opts.delayMs] затримка перед емісією (для timeout-тесту)
 * @returns {object} fake AgentSession
 */
function fakeSession({ deltas = [], usage = null, promptError = null, delayMs = 0 } = {}) {
  let cb = noop
  return {
    subscribe: fn => {
      cb = fn
    },
    prompts: [],
    prompt(text) {
      this.prompts.push(text)
      return (async () => {
        if (delayMs) await sleep(delayMs)
        for (const d of deltas) cb({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: d } })
        if (usage) cb({ type: 'message_end', message: { usage } })
        if (promptError) throw new Error(promptError)
      })()
    }
  }
}

const registry = { find: (p, id) => ({ provider: p, id }) }
const baseDeps = session => ({ registry, trace: vi.fn(), createSession: vi.fn(() => Promise.resolve(session)) })

describe('runOneShot', () => {
  test('happy path: збирає текст + usage', async () => {
    const usage = { input: 455, output: 1, totalTokens: 456 }
    const deps = baseDeps(fakeSession({ deltas: ['goo', 'dbye'], usage }))
    const r = await runOneShot({
      messages: [
        { role: 'system', content: 'be terse' },
        { role: 'user', content: 'say goodbye' }
      ],
      modelSpec: 'omlx/gemma-4-e4b',
      deps
    })
    expect(r).toMatchObject({ content: 'goodbye', usage, error: null, model: 'omlx/gemma-4-e4b' })
    expect(deps.trace).toHaveBeenCalled()
  })

  test('усі messages (system+user) зливаються в один prompt; без replaceInstructions', async () => {
    const session = fakeSession({ deltas: ['ok'] })
    const deps = { registry, trace: vi.fn(), createSession: vi.fn(() => Promise.resolve(session)) }
    await runOneShot({
      messages: [
        { role: 'system', content: 'SYS' },
        { role: 'user', content: 'U1' },
        { role: 'user', content: 'U2' }
      ],
      modelSpec: 'omlx/x',
      deps
    })
    expect(session.prompts[0]).toBe('SYS\n\nU1\n\nU2')
    // createSession більше не отримує systemText (інструкції — інлайн у prompt)
    expect(deps.createSession).toHaveBeenCalledWith(expect.not.objectContaining({ systemText: expect.anything() }))
  })

  test('модель не знайдена → error, сесія не створюється', async () => {
    const deps = {
      registry: { find: () => null },
      trace: vi.fn(),
      createSession: vi.fn()
    }
    const r = await runOneShot({ messages: [{ role: 'user', content: 'x' }], modelSpec: 'omlx/missing', deps })
    expect(r.error).toMatch(RE_NOT_FOUND)
    expect(deps.createSession).not.toHaveBeenCalled()
  })

  test('prompt кидає → error, частковий текст збережено', async () => {
    const deps = baseDeps(fakeSession({ deltas: ['part'], promptError: 'boom' }))
    const r = await runOneShot({ messages: [{ role: 'user', content: 'x' }], modelSpec: 'omlx/x', deps })
    expect(r.error).toBe('boom')
    expect(r.content).toBe('part')
  })

  test('timeout → error', async () => {
    const deps = baseDeps(fakeSession({ deltas: ['late'], delayMs: 200 }))
    const r = await runOneShot({
      messages: [{ role: 'user', content: 'x' }],
      modelSpec: 'omlx/x',
      timeoutMs: 20,
      deps
    })
    expect(r.error).toMatch(RE_TIMEOUT)
  })

  test('registry кидає → error', async () => {
    const deps = {
      getRegistry: () => Promise.reject(new Error('no reg')),
      trace: vi.fn(),
      createSession: vi.fn()
    }
    const r = await runOneShot({ messages: [{ role: 'user', content: 'x' }], modelSpec: 'omlx/x', deps })
    expect(r.error).toMatch(RE_REGISTRY_ERR)
  })
})

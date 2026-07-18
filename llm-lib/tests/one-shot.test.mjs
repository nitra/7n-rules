/**
 * Тести pi-one-shot: text-capture з subscribe, usage з message_end, error-шляхи,
 * timeout. Сесія/registry/trace інжектуються (без pi).
 */

import { setTimeout as sleep } from 'node:timers/promises'
import { describe, expect, test, vi } from 'vitest'
import { MEMORY_ERROR_RE, runOneShot } from '../lib/one-shot.mjs'

const RE_NOT_FOUND = /не знайдена/
const RE_TIMEOUT = /timeout/
const RE_REGISTRY_ERR = /registry: no reg/
const RE_HEX16 = /^[0-9a-f]{16}$/

/**
 * No-op placeholder для subscribe-хендлера до реєстрації.
 * @returns {null} маркер відсутньої дії
 */
const noop = () => null

/**
 * Fake AgentSession: емітить text_delta + message_end, опційно кидає/затримує.
 * @param {object} [opts] опції
 * @param {string[]} [opts.deltas] text_delta-фрагменти для стріму
 * @param {object|null} [opts.usage] usage у message_end (або без нього)
 * @param {string|null} [opts.promptError] якщо задано — prompt кидає з цим текстом
 * @param {number} [opts.delayMs] затримка перед емісією (для timeout-тесту)
 * @param {string|null} [opts.stopReason] stopReason у message_end (напр. 'length')
 * @param {{provider: string, id: string}|null} [opts.model] резолвлена pi-модель (`session.model`)
 * @returns {object} fake AgentSession
 */
function fakeSession({
  deltas = [],
  usage = null,
  promptError = null,
  delayMs = 0,
  stopReason = null,
  model = null
} = {}) {
  let cb = noop
  return {
    model,
    subscribe: fn => {
      cb = fn
    },
    prompts: [],
    prompt(text) {
      this.prompts.push(text)
      return (async () => {
        if (delayMs) await sleep(delayMs)
        for (const d of deltas) cb({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: d } })
        if (usage || stopReason) cb({ type: 'message_end', message: { usage, stopReason } })
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

  test('memory-guard rejection → друкує тіло запиту в stdout і кидає Error, без structured error', async () => {
    const memoryMsg = 'Prefill would require ~12.32 GB peak but metal_cap ceiling is 11.84 GB.'
    const deps = baseDeps(fakeSession({ deltas: [], promptError: memoryMsg }))
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => null)

    try {
      await expect(
        runOneShot({
          messages: [{ role: 'user', content: 'Summarize this huge source file...' }],
          modelSpec: 'omlx/x',
          deps
        })
      ).rejects.toThrow('omlx memory-guard')

      expect(logSpy).toHaveBeenCalledWith('Summarize this huge source file...')
    } finally {
      logSpy.mockRestore()
    }
  })

  test('maxTokens прокидається у createSession; stopReason length повертається', async () => {
    const usage = { totalTokens: 5 }
    const session = fakeSession({ deltas: ['cut'], usage, stopReason: 'length' })
    const deps = { registry, trace: vi.fn(), createSession: vi.fn(() => Promise.resolve(session)) }
    const r = await runOneShot({
      messages: [{ role: 'user', content: 'x' }],
      modelSpec: 'omlx/x',
      maxTokens: 2048,
      deps
    })
    expect(deps.createSession).toHaveBeenCalledWith(expect.objectContaining({ maxTokens: 2048 }))
    expect(r.stopReason).toBe('length')
    expect(r.content).toBe('cut')
  })

  test('MEMORY_ERROR_RE — публічна частина error-контракту', () => {
    expect(MEMORY_ERROR_RE.test('omlx memory-guard: prefill would require 12GB')).toBe(true)
    expect(MEMORY_ERROR_RE.test('звичайна помилка')).toBe(false)
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

  test('з chain: step/note/trace-поля + headerChain лише для локальної моделі', async () => {
    const usage = { totalTokens: 7 }
    const deps = baseDeps(fakeSession({ deltas: ['ok'], usage }))
    const chain = {
      nextStep: vi.fn(() => 3),
      note: vi.fn(),
      traceFields: () => ({ chainId: 'cid1', chainKind: 'k', chainUnit: 'u', chainStep: 3 }),
      headers: () => ({ 'X-Chain-Id': 'cid1' })
    }
    await runOneShot({ messages: [{ role: 'user', content: 'x' }], modelSpec: 'omlx/x', chain, deps })
    expect(chain.nextStep).toHaveBeenCalledTimes(1)
    expect(chain.note).toHaveBeenCalledWith(expect.objectContaining({ model: 'omlx/x', usage }))
    // omlx — локальний провайдер → chain пішов у createSession (для headers-mixin)
    expect(deps.createSession).toHaveBeenCalledWith(expect.objectContaining({ chain }))
    expect(deps.trace).toHaveBeenCalledWith(
      expect.objectContaining({ chainId: 'cid1', chainStep: 3, promptHash: expect.stringMatching(RE_HEX16) })
    )
  })

  test('з chain на хмарній моделі: headers НЕ йдуть у сесію, note — йде', async () => {
    const deps = baseDeps(fakeSession({ deltas: ['ok'] }))
    const chain = {
      nextStep: vi.fn(() => 1),
      note: vi.fn(),
      traceFields: () => ({ chainId: 'cid2', chainKind: 'k', chainUnit: 'u', chainStep: 1 }),
      headers: () => ({})
    }
    await runOneShot({ messages: [{ role: 'user', content: 'x' }], modelSpec: 'openai/gpt-5.5', chain, deps })
    expect(deps.createSession).toHaveBeenCalledWith(expect.objectContaining({ chain: null }))
    expect(chain.note).toHaveBeenCalled()
  })

  test('без chain: у trace нема chain-полів, але є promptHash (сумісність)', async () => {
    const deps = baseDeps(fakeSession({ deltas: ['ok'] }))
    await runOneShot({ messages: [{ role: 'user', content: 'x' }], modelSpec: 'omlx/x', deps })
    const record = deps.trace.mock.calls.at(-1)[0]
    expect(record).not.toHaveProperty('chainId')
    expect(record.promptHash).toMatch(RE_HEX16)
  })

  test('captureBody кличеться з prompt/output/usage/model і chain-полями', async () => {
    const usage = { totalTokens: 3 }
    const deps = baseDeps(fakeSession({ deltas: ['goo', 'dbye'], usage }))
    deps.captureBody = vi.fn()
    const chain = {
      nextStep: vi.fn(() => 1),
      note: vi.fn(),
      traceFields: () => ({ chainId: 'cb1', chainKind: 'k', chainUnit: 'u', chainStep: 1 }),
      headers: () => ({})
    }
    await runOneShot({ messages: [{ role: 'user', content: 'say goodbye' }], modelSpec: 'omlx/x', chain, deps })
    expect(deps.captureBody).toHaveBeenCalledWith(
      expect.objectContaining({
        chainId: 'cb1',
        step: 1,
        model: 'omlx/x',
        prompt: 'say goodbye',
        output: 'goodbye',
        usage,
        error: null
      })
    )
  })

  test('modelSpec порожній: model — фактично резолвлена pi-модель із session.model, не echo spec', async () => {
    const usage = { totalTokens: 4 }
    const deps = baseDeps(fakeSession({ deltas: ['ok'], usage, model: { provider: 'omlx', id: 'gemma-4' } }))
    const chain = {
      nextStep: vi.fn(() => 1),
      note: vi.fn(),
      traceFields: () => ({ chainId: 'cid-empty', chainKind: 'k', chainUnit: 'u', chainStep: 1 }),
      headers: () => ({})
    }
    const r = await runOneShot({ messages: [{ role: 'user', content: 'x' }], modelSpec: '', chain, deps })
    expect(r.model).toBe('omlx/gemma-4')
    expect(chain.note).toHaveBeenCalledWith(expect.objectContaining({ model: 'omlx/gemma-4' }))
  })

  test('modelSpec порожній і session.model недоступна: model — null (не echo "")', async () => {
    const deps = baseDeps(fakeSession({ deltas: ['ok'] }))
    const chain = { nextStep: vi.fn(() => 1), note: vi.fn(), traceFields: () => ({}), headers: () => ({}) }
    const r = await runOneShot({ messages: [{ role: 'user', content: 'x' }], modelSpec: '', chain, deps })
    expect(r.model).toBeNull()
    expect(chain.note).toHaveBeenCalledWith(expect.objectContaining({ model: null }))
  })

  test('captureBody не падає без chain (chainId/step — undefined)', async () => {
    const deps = baseDeps(fakeSession({ deltas: ['ok'] }))
    deps.captureBody = vi.fn()
    await runOneShot({ messages: [{ role: 'user', content: 'x' }], modelSpec: 'omlx/x', deps })
    expect(deps.captureBody).toHaveBeenCalledWith(expect.objectContaining({ chainId: undefined, step: undefined }))
  })
})

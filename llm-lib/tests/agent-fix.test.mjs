/**
 * Тести pi-agent-fix: buildFixPrompt (pure), git-precondition, model-not-found,
 * fail-closed canary, happy-path контракт {applied,touchedFiles,telemetry,error,rollback}.
 * Сесія інжектована (fake), write-guard — справжній на temp git-репо.
 */

import { spawnSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { buildFixPrompt, buildVerifyFeedbackPrompt, runAgentFix } from '../lib/agent-fix.mjs'

const RE_AST_FACTS = /ast_facts/
const RE_SELF_CHECK = /self_check/
const RE_PREVIOUS_ATTEMPT = /Попередня спроба/
const RE_HEX16 = /^[0-9a-f]{16}$/
const RE_NOT_GIT = /не git-репо/
const RE_NOT_FOUND = /не знайдена/
const RE_FAIL_CLOSED = /fail-closed/

const registry = { find: (p, id) => ({ provider: p, id }) }

/**
 * No-op placeholder для subscribe-хендлера до реєстрації.
 * @returns {null} маркер відсутньої дії
 */
const noop = () => null

/**
 * Fake pi-сесія, що приєднує guard через factory і драйвить події + один edit.
 * @param {object} [opts] опції
 * @param {string|null} [opts.promptError] якщо задано — prompt кидає з цим текстом
 * @returns {import('vitest').Mock} vi.fn-фабрика createSession
 */
function fakeCreate({ promptError = null } = {}) {
  return vi.fn(async ({ factory }) => {
    await Promise.resolve()
    let toolCb = null
    factory({
      on: (ev, h) => {
        if (ev === 'tool_call') toolCb = h
      }
    })
    let sub = noop
    return {
      subscribe: fn => {
        sub = fn
      },
      abort: vi.fn(),
      prompt: async () => {
        await Promise.resolve()
        sub({ type: 'turn_start' })
        sub({ type: 'tool_execution_start', toolName: 'edit' })
        toolCb?.({ toolName: 'edit', input: { path: 'src.mjs', edits: [{ oldText: 'OLD', newText: 'NEW' }] } })
        sub({ type: 'tool_execution_end', toolName: 'edit', isError: false })
        sub({
          type: 'message_end',
          message: { usage: { input: 100, output: 10, totalTokens: 110 }, stopReason: 'stop' }
        })
        if (promptError) throw new Error(promptError)
      }
    }
  })
}

/**
 * Fake pi-сесія verify-тестів: приєднує guard, збирає prompt-и в масив.
 * @param {string[]} prompts акумулятор prompt-ів
 * @returns {import('vitest').Mock} vi.fn-фабрика createSession
 */
function fakeVerifyCreate(prompts) {
  return vi.fn(async ({ factory }) => {
    await Promise.resolve()
    factory({ on: () => null })
    return {
      subscribe: () => null,
      abort: vi.fn(),
      prompt: p => {
        prompts.push(p)
        return Promise.resolve()
      }
    }
  })
}

describe('buildFixPrompt', () => {
  test('містить правило, порушення, інструкцію ast_facts/self_check', () => {
    const p = buildFixPrompt({ ruleId: 'n-ci4', violation: '❌ bad', ruleText: 'правило X' })
    expect(p).toContain('n-ci4')
    expect(p).toContain('❌ bad')
    expect(p).toContain('правило X')
    expect(p).toMatch(RE_AST_FACTS)
    expect(p).toMatch(RE_SELF_CHECK)
  })

  test('feedback додається лише за наявності', () => {
    expect(buildFixPrompt({ ruleId: 'r', violation: 'v' })).not.toMatch(RE_PREVIOUS_ATTEMPT)
    expect(buildFixPrompt({ ruleId: 'r', violation: 'v', feedback: { previousError: 'E' } })).toMatch(
      RE_PREVIOUS_ATTEMPT
    )
  })

  test('блок обмежень: лише механічні зміни, без хардкоду/симуляції (semantic-collateral guard)', () => {
    const p = buildFixPrompt({ ruleId: 'r', violation: 'v' })
    expect(p).toContain('## Обмеження')
    expect(p).toContain('механічні зміни')
    expect(p).toContain('НЕ хардкодь значення')
    expect(p).toContain('НЕ симулюй')
    expect(p).toContain('НЕ змінюй бізнес-логіку')
  })

  test('anchoredEdits: інструкція read_anchored/edit_anchored лише при увімкненому профілі', () => {
    expect(buildFixPrompt({ ruleId: 'r', violation: 'v' })).not.toContain('read_anchored')
    const p = buildFixPrompt({ ruleId: 'r', violation: 'v', anchoredEdits: true })
    expect(p).toContain('read_anchored')
    expect(p).toContain('edit_anchored')
    expect(p).toContain('НОВИХ файлів')
  })

  test('targetFiles: перелік додається лише за наявності', () => {
    expect(buildFixPrompt({ ruleId: 'r', violation: 'v' })).not.toContain('Target-файли')
    expect(buildFixPrompt({ ruleId: 'r', violation: 'v', targetFiles: [] })).not.toContain('Target-файли')
    const p = buildFixPrompt({ ruleId: 'r', violation: 'v', targetFiles: ['src/a.mjs', 'src/b.vue'] })
    expect(p).toContain('## Target-файли')
    expect(p).toContain('- src/a.mjs')
    expect(p).toContain('- src/b.vue')
  })
})

describe('error-шляхи (без git/pi)', () => {
  test('не git-репо → fix пропущено', async () => {
    const r = await runAgentFix('r', 'v', '/tmp', { model: 'omlx/x', deps: { root: null, trace: vi.fn() } })
    expect(r.error).toMatch(RE_NOT_GIT)
    expect(r.applied).toBe(false)
  })

  test('модель не знайдена → error', async () => {
    const r = await runAgentFix('r', 'v', '/tmp', {
      model: 'omlx/missing',
      deps: { root: '/tmp', registry: { find: () => null }, trace: vi.fn(), createSession: vi.fn() }
    })
    expect(r.error).toMatch(RE_NOT_FOUND)
  })

  test('trace фіксує sampling knobs payload-а: model + thinkingLevel від tier', async () => {
    const trace = vi.fn()
    await runAgentFix('r', 'v', '/tmp', {
      model: 'openai-codex/gpt-5.5',
      tier: 'cloud-max',
      deps: { root: '/tmp', registry: { find: () => null }, trace, createSession: vi.fn() }
    })
    expect(trace).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'openai-codex/gpt-5.5', thinkingLevel: 'xhigh', rung: 'cloud-max' })
    )
  })

  test('fail-closed canary: factory не викликана → fix скасовано', async () => {
    const createSession = vi.fn(() =>
      Promise.resolve({
        subscribe: vi.fn(),
        prompt: () => Promise.resolve(),
        abort: vi.fn()
      })
    )
    const r = await runAgentFix('r', 'v', '/tmp', {
      model: 'omlx/x',
      deps: { root: '/tmp', registry, createSession, trace: vi.fn() }
    })
    expect(r.error).toMatch(RE_FAIL_CLOSED)
  })
})

describe('happy-path (справжній write-guard на temp git-репо)', () => {
  let dir
  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'agf-')))
    spawnSync('git', ['init', '-q'], { cwd: dir })
    spawnSync('git', ['config', 'user.email', 't@t'], { cwd: dir })
    spawnSync('git', ['config', 'user.name', 't'], { cwd: dir })
    writeFileSync(join(dir, 'src.mjs'), 'export const X = "OLD"\n')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  test('контракт {applied,touchedFiles,telemetry,error,rollback}', async () => {
    const trace = vi.fn()
    const r = await runAgentFix('n-ci4', '❌ v', dir, {
      model: 'omlx/gemma',
      tier: 'local-min',
      deps: { root: dir, registry, createSession: fakeCreate(), trace }
    })
    expect(r.error).toBeNull()
    expect(r.applied).toBe(true)
    expect(r.touchedFiles).toEqual([join(dir, 'src.mjs')])
    expect(r.telemetry).toMatchObject({
      rule: 'n-ci4',
      rung: 'local-min',
      turnCount: 1,
      toolCallCount: 1,
      backstopHit: false
    })
    expect(r.telemetry.edits[0]).toMatchObject({ tool: 'edit', edits: [{ oldText: 'OLD', newText: 'NEW' }] })
    expect(typeof r.rollback).toBe('function')
    expect(trace).toHaveBeenCalledWith(expect.objectContaining({ kind: 'agent', rule: 'n-ci4', backend: 'pi-ai' }))
  })

  test('timeoutMs: зависла сесія (prompt ніколи не резолвиться) → fix timeout + session.abort', async () => {
    const abort = vi.fn()
    const createSession = vi.fn(async ({ factory }) => {
      await Promise.resolve()
      factory({ on: () => null })
      return {
        subscribe: () => null,
        abort,
        // Модель зависшої cloud-SSE: без timeout-гонки виклик стояв би вічно.
        prompt: () => Promise.race([])
      }
    })
    const r = await runAgentFix('n-ci4', '❌ v', dir, {
      model: 'omlx/gemma',
      timeoutMs: 20,
      deps: { root: dir, registry, createSession, trace: vi.fn() }
    })
    expect(r.error).toBe('fix timeout 20ms')
    expect(r.applied).toBe(false)
    expect(abort).toHaveBeenCalled()
  })

  test('з chain: step/note/chain-поля у trace + usage з turns', async () => {
    const trace = vi.fn()
    const chain = {
      nextStep: vi.fn(() => 2),
      note: vi.fn(),
      traceFields: () => ({ chainId: 'cf1', chainKind: 'fix-concern', chainUnit: 'r/c', chainStep: 2 }),
      headers: () => ({ 'X-Chain-Id': 'cf1' })
    }
    await runAgentFix('n-ci4', '❌ v', dir, {
      model: 'omlx/gemma',
      tier: 'local-min',
      chain,
      deps: { root: dir, registry, createSession: fakeCreate(), trace }
    })
    expect(chain.nextStep).toHaveBeenCalledTimes(1)
    expect(chain.note).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'omlx/gemma', usage: { input: 100, output: 10, totalTokens: 110 } })
    )
    expect(trace).toHaveBeenCalledWith(
      expect.objectContaining({ chainId: 'cf1', chainStep: 2, promptHash: expect.stringMatching(RE_HEX16) })
    )
  })

  test('без chain: trace без chain-полів (сумісність), promptHash присутній', async () => {
    const trace = vi.fn()
    await runAgentFix('n-ci4', '❌ v', dir, {
      model: 'omlx/gemma',
      deps: { root: dir, registry, createSession: fakeCreate(), trace }
    })
    const record = trace.mock.calls.at(-1)[0]
    expect(record).not.toHaveProperty('chainId')
    expect(record.promptHash).toMatch(RE_HEX16)
  })

  test('captureBody кличеться з prompt/output(touchedFiles+edits)/usage', async () => {
    const captureBody = vi.fn()
    const r = await runAgentFix('n-ci4', '❌ v', dir, {
      model: 'omlx/gemma',
      deps: { root: dir, registry, createSession: fakeCreate(), trace: vi.fn(), captureBody }
    })
    expect(captureBody).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'omlx/gemma',
        prompt: expect.stringContaining('n-ci4'),
        output: expect.objectContaining({ touchedFiles: r.touchedFiles }),
        usage: { input: 100, output: 10, totalTokens: 110 }
      })
    )
  })

  test('prompt кидає → error, але touched зафіксовані', async () => {
    const r = await runAgentFix('n-ci4', '❌ v', dir, {
      model: 'omlx/gemma',
      deps: { root: dir, registry, createSession: fakeCreate({ promptError: 'boom' }), trace: vi.fn() }
    })
    expect(r.error).toBe('boom')
    expect(r.touchedFiles).toContain(join(dir, 'src.mjs'))
  })

  test('memory-guard rejection → друкує fix-промпт у stdout і кидає Error', async () => {
    const memoryMsg = 'Prefill would require ~12.32 GB peak but metal_cap ceiling is 11.84 GB.'
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => null)

    try {
      await expect(
        runAgentFix('n-ci4', '❌ v', dir, {
          model: 'omlx/gemma',
          deps: { root: dir, registry, createSession: fakeCreate({ promptError: memoryMsg }), trace: vi.fn() }
        })
      ).rejects.toThrow('omlx memory-guard')

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Виправ порушення правила "n-ci4"'))
    } finally {
      logSpy.mockRestore()
    }
  })
})

describe('verify-loop (evidence-гейт, Фаза A1)', () => {
  let dir
  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'agf-')))
    spawnSync('git', ['init', '-q'], { cwd: dir })
    spawnSync('git', ['config', 'user.email', 't@t'], { cwd: dir })
    spawnSync('git', ['config', 'user.name', 't'], { cwd: dir })
    writeFileSync(join(dir, 'src.mjs'), 'export const X = "OLD"\n')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  test('buildVerifyFeedbackPrompt: вивід перевірки + нагадування обмежень', () => {
    const p = buildVerifyFeedbackPrompt('❌ лишилось 2 порушення')
    expect(p).toContain('❌ лишилось 2 порушення')
    expect(p).toContain('ДОСІ активне')
    expect(p).toContain('механічні зміни')
  })

  test('verify ok одразу → один prompt, error null, verifyAttempts=[ok]', async () => {
    const prompts = []
    const verify = vi.fn(() => ({ ok: true }))
    const r = await runAgentFix('r', 'v', dir, {
      model: 'omlx/gemma',
      verify,
      deps: { root: dir, registry, createSession: fakeVerifyCreate(prompts), trace: vi.fn() }
    })
    expect(r.error).toBeNull()
    expect(prompts).toHaveLength(1)
    expect(verify).toHaveBeenCalledWith({ touchedFiles: [] })
    expect(r.telemetry.verifyAttempts).toEqual([{ ok: true }])
  })

  test('verify fail → фідбек у ту саму сесію → ok: два prompt-и, другий несе вивід перевірки', async () => {
    const prompts = []
    const verify = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, output: '❌ ще порушено у src.mjs' })
      .mockResolvedValue({ ok: true })
    const trace = vi.fn()
    const r = await runAgentFix('r', 'v', dir, {
      model: 'omlx/gemma',
      verify,
      deps: { root: dir, registry, createSession: fakeVerifyCreate(prompts), trace }
    })
    expect(r.error).toBeNull()
    expect(prompts).toHaveLength(2)
    expect(prompts[1]).toContain('❌ ще порушено у src.mjs')
    expect(r.telemetry.verifyAttempts).toEqual([{ ok: false }, { ok: true }])
    expect(trace).toHaveBeenCalledWith(expect.objectContaining({ verifyAttempts: 2, verifyOk: true }))
  })

  test('verify стабільно fail + verifyMax=1 → два prompt-и, чесний error', async () => {
    const prompts = []
    const verify = vi.fn(() => ({ ok: false, output: '❌' }))
    const r = await runAgentFix('r', 'v', dir, {
      model: 'omlx/gemma',
      verify,
      verifyMax: 1,
      deps: { root: dir, registry, createSession: fakeVerifyCreate(prompts), trace: vi.fn() }
    })
    expect(r.error).toBe('verify: порушення лишилось після 2 перевірок')
    expect(prompts).toHaveLength(2)
    expect(r.telemetry.verifyAttempts).toEqual([{ ok: false }, { ok: false }])
  })

  test('verify кидає → інфраструктурний error без додаткових ітерацій', async () => {
    const prompts = []
    const verify = vi.fn(() => {
      throw new Error('detector exploded')
    })
    const r = await runAgentFix('r', 'v', dir, {
      model: 'omlx/gemma',
      verify,
      deps: { root: dir, registry, createSession: fakeVerifyCreate(prompts), trace: vi.fn() }
    })
    expect(r.error).toBe('verify: detector exploded')
    expect(prompts).toHaveLength(1)
    expect(r.telemetry.verifyAttempts).toEqual([{ ok: false, infra: true }])
  })

  test('бюджет часу рунга вичерпано → без фідбек-prompt-а, чесний error', async () => {
    const prompts = []
    let now = 0
    const verify = vi.fn(() => {
      now = 299_000 // майже весь дефолтний timeoutMs 300_000 — залишок < VERIFY_MIN_BUDGET_MS
      return { ok: false, output: '❌' }
    })
    const r = await runAgentFix('r', 'v', dir, {
      model: 'omlx/gemma',
      verify,
      deps: { root: dir, registry, createSession: fakeVerifyCreate(prompts), trace: vi.fn(), clock: () => now }
    })
    expect(r.error).toBe('verify: бюджет часу рунга вичерпано')
    expect(prompts).toHaveLength(1)
  })

  test('без verify — поведінка попередня: жодних verify-полів у роботі, attempts порожні', async () => {
    const prompts = []
    const r = await runAgentFix('r', 'v', dir, {
      model: 'omlx/gemma',
      deps: { root: dir, registry, createSession: fakeVerifyCreate(prompts), trace: vi.fn() }
    })
    expect(r.error).toBeNull()
    expect(prompts).toHaveLength(1)
    expect(r.telemetry.verifyAttempts).toEqual([])
  })

  test('anchoredEdits прокидається у createSession і в trace (A/B-аналіз)', async () => {
    const trace = vi.fn()
    const createSession = fakeVerifyCreate([])
    await runAgentFix('r', 'v', dir, {
      model: 'omlx/gemma',
      anchoredEdits: true,
      deps: { root: dir, registry, createSession, trace }
    })
    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({ anchoredEdits: true }))
    expect(trace).toHaveBeenCalledWith(expect.objectContaining({ anchoredEdits: true }))
  })

  test('webTools (A3) прокидається у createSession і в trace; дефолт false', async () => {
    const trace = vi.fn()
    const createSession = fakeVerifyCreate([])
    await runAgentFix('r', 'v', dir, {
      model: 'openai-codex/gpt-5.5',
      webTools: true,
      deps: { root: dir, registry, createSession, trace }
    })
    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({ webTools: true }))
    expect(trace).toHaveBeenCalledWith(expect.objectContaining({ webTools: true }))

    const createDefault = fakeVerifyCreate([])
    await runAgentFix('r', 'v', dir, {
      model: 'omlx/gemma',
      deps: { root: dir, registry, createSession: createDefault, trace: vi.fn() }
    })
    expect(createDefault).toHaveBeenCalledWith(expect.objectContaining({ webTools: false }))
  })

  test('prompt-error першого проходу → verify не запускається', async () => {
    const verify = vi.fn()
    const r = await runAgentFix('r', 'v', dir, {
      model: 'omlx/gemma',
      verify,
      deps: { root: dir, registry, createSession: fakeCreate({ promptError: 'boom' }), trace: vi.fn() }
    })
    expect(r.error).toBe('boom')
    expect(verify).not.toHaveBeenCalled()
  })
})

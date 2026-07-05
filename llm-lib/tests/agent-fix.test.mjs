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
import { buildFixPrompt, runAgentFix } from '../lib/agent-fix.mjs'

const RE_AST_FACTS = /ast_facts/
const RE_SELF_CHECK = /self_check/
const RE_PREVIOUS_ATTEMPT = /Попередня спроба/
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

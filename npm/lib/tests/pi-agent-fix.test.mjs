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
import { buildFixPrompt, runPiAgentFix } from '../pi-agent-fix.mjs'

describe('buildFixPrompt', () => {
  test('містить правило, порушення, інструкцію ast_facts/self_check', () => {
    const p = buildFixPrompt({ ruleId: 'n-ci4', violation: '❌ bad', ruleText: 'правило X' })
    expect(p).toContain('n-ci4')
    expect(p).toContain('❌ bad')
    expect(p).toContain('правило X')
    expect(p).toMatch(/ast_facts/)
    expect(p).toMatch(/self_check/)
  })

  test('feedback додається лише за наявності', () => {
    expect(buildFixPrompt({ ruleId: 'r', violation: 'v' })).not.toMatch(/Попередня спроба/)
    expect(buildFixPrompt({ ruleId: 'r', violation: 'v', feedback: { previousError: 'E' } })).toMatch(
      /Попередня спроба/
    )
  })
})

const registry = { find: (p, id) => ({ provider: p, id }) }

describe('error-шляхи (без git/pi)', () => {
  test('не git-репо → fix пропущено', async () => {
    const r = await runPiAgentFix('r', 'v', '/tmp', { model: 'omlx/x', deps: { root: null, trace: vi.fn() } })
    expect(r.error).toMatch(/не git-репо/)
    expect(r.applied).toBe(false)
  })

  test('модель не знайдена → error', async () => {
    const r = await runPiAgentFix('r', 'v', '/tmp', {
      model: 'omlx/missing',
      deps: { root: '/tmp', registry: { find: () => null }, trace: vi.fn(), createSession: vi.fn() }
    })
    expect(r.error).toMatch(/не знайдена/)
  })

  test('fail-closed canary: factory не викликана → fix скасовано', async () => {
    const createSession = vi.fn(async () => ({ subscribe() {}, prompt: async () => {}, abort() {} }))
    const r = await runPiAgentFix('r', 'v', '/tmp', {
      model: 'omlx/x',
      deps: { root: '/tmp', registry, createSession, trace: vi.fn() }
    })
    expect(r.error).toMatch(/fail-closed/)
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

  /** Fake session, що приєднує guard через factory і драйвить події + один edit. */
  function fakeCreate({ promptError = null } = {}) {
    return vi.fn(async ({ factory }) => {
      let toolCb = null
      factory({
        on: (ev, h) => {
          if (ev === 'tool_call') toolCb = h
        }
      })
      let sub = () => {}
      return {
        subscribe: fn => {
          sub = fn
        },
        abort: vi.fn(),
        prompt: async () => {
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

  test('контракт {applied,touchedFiles,telemetry,error,rollback}', async () => {
    const trace = vi.fn()
    const r = await runPiAgentFix('n-ci4', '❌ v', dir, {
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
    const r = await runPiAgentFix('n-ci4', '❌ v', dir, {
      model: 'omlx/gemma',
      deps: { root: dir, registry, createSession: fakeCreate({ promptError: 'boom' }), trace: vi.fn() }
    })
    expect(r.error).toBe('boom')
    expect(r.touchedFiles).toContain(join(dir, 'src.mjs'))
  })
})

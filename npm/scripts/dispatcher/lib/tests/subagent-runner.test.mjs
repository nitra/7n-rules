/**
 * Тести SubagentRunner (`lib/subagent-runner.mjs`, spec §15.1). spawn/query/PATH
 * ін'єктуються — без реальних процесів і без SDK.
 */
import { describe, expect, test } from 'vitest'

import { cliRunner, createRunner, isBinaryInPath, sdkRunner, selectBackend } from '../subagent-runner.mjs'

/** Фейкова SDK-черга: текст + успішний result. */
async function* okQuery() {
  yield { text: 'hello ' }
  yield { text: 'world' }
  yield { type: 'result', is_error: false }
}

/** Фейкова SDK-черга: помилковий result. */
async function* errorQuery() {
  yield { type: 'result', is_error: true }
}

describe('selectBackend', () => {
  test('sdk коли є API key + SDK', () => {
    expect(selectBackend({ hasApiKey: true, canImportSdk: true, isInPath: () => false })).toBe('sdk')
  })
  test('claude коли нема SDK, але claude у PATH', () => {
    expect(selectBackend({ hasApiKey: false, canImportSdk: false, isInPath: n => n === 'claude' })).toBe('claude')
  })
  test('cursor коли лише cursor-agent', () => {
    expect(selectBackend({ hasApiKey: false, canImportSdk: false, isInPath: n => n === 'cursor-agent' })).toBe('cursor')
  })
  test('null коли нічого нема (навіть з API key без SDK)', () => {
    expect(selectBackend({ hasApiKey: true, canImportSdk: false, isInPath: () => false })).toBe(null)
  })
})

describe('cliRunner', () => {
  test('спавнить bin -p з prompt у stdin; ok за status 0', () => {
    const calls = []
    const spawn = (bin, args, opts) => {
      calls.push({ bin, args, opts })
      return { status: 0, stdout: 'done', stderr: '' }
    }
    const res = cliRunner('claude', { spawn }).runStep('PROMPT', { cwd: '/wt' })
    expect(res).toEqual({ ok: true, output: 'done' })
    expect(calls[0]).toMatchObject({ bin: 'claude', args: ['-p'], opts: { input: 'PROMPT', cwd: '/wt' } })
  })
  test('ok=false за ненульовий status; output = stdout+stderr', () => {
    const res = cliRunner('cursor-agent', { spawn: () => ({ status: 1, stdout: 'o', stderr: 'e' }) }).runStep('p')
    expect(res).toEqual({ ok: false, output: 'oe' })
  })
})

describe('sdkRunner', () => {
  test('консумить async-iterable; output з text, ok з result', async () => {
    const res = await sdkRunner({ query: okQuery }).runStep('p', { cwd: '/x' })
    expect(res).toEqual({ ok: true, output: 'hello world' })
  })
  test('is_error → ok false', async () => {
    const res = await sdkRunner({ query: errorQuery }).runStep('p')
    expect(res.ok).toBe(false)
  })
  test('виняток query → ok false', async () => {
    const res = await sdkRunner({
      query: () => {
        throw new Error('boom')
      }
    }).runStep('p')
    expect(res.ok).toBe(false)
    expect(res.output).toContain('boom')
  })
})

describe('createRunner', () => {
  test('явний backend=claude → cliRunner', async () => {
    const r = await createRunner({ backend: 'claude', spawn: () => ({ status: 0 }) })
    expect(r.backend).toBe('claude')
  })
  test('обирає за env/PATH (claude)', async () => {
    const r = await createRunner({ env: {}, canImportSdk: false, isInPath: n => n === 'claude' })
    expect(r.backend).toBe('claude')
  })
  test('нема backend → throw', async () => {
    await expect(createRunner({ env: {}, canImportSdk: false, isInPath: () => false })).rejects.toThrow(/спавнити нічим/)
  })
  test('sdk коли API key + SDK', async () => {
    const r = await createRunner({ env: { ANTHROPIC_API_KEY: 'x' }, canImportSdk: true, isInPath: () => false, query: okQuery })
    expect(r.backend).toBe('sdk')
  })
})

describe('isBinaryInPath', () => {
  test('status 0 → true; інакше false', () => {
    expect(isBinaryInPath('x', () => ({ status: 0 }))).toBe(true)
    expect(isBinaryInPath('x', () => ({ status: 1 }))).toBe(false)
  })
})

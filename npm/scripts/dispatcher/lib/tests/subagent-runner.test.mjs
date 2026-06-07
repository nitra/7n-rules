/**
 * Тести SubagentRunner (`lib/subagent-runner.mjs`).
 * callPi ін'єктується через deps — без реальних процесів.
 */
import { describe, expect, test } from 'vitest'

import { createRunner } from '../subagent-runner.mjs'

describe('createRunner', () => {
  test('повертає runner з backend = pi', async () => {
    const r = await createRunner({ callPi: () => ({ ok: true, output: '' }) })
    expect(r.backend).toBe('pi')
  })

  test('runStep делегує prompt і cwd до callPi', async () => {
    let captured = null
    const r = await createRunner({
      callPi: (prompt, model, opts) => {
        captured = { prompt, model, cwd: opts?.cwd }
        return { ok: true, output: 'done' }
      }
    })
    const res = await r.runStep('PROMPT', { cwd: '/wt' })
    expect(res).toEqual({ ok: true, output: 'done' })
    expect(captured.prompt).toBe('PROMPT')
    expect(captured.cwd).toBe('/wt')
  })

  test('deps.model передається до callPi', async () => {
    let capturedModel = null
    const r = await createRunner({
      model: 'openai/gpt-5.5',
      callPi: (p, model) => {
        capturedModel = model
        return { ok: true, output: '' }
      }
    })
    await r.runStep('p')
    expect(capturedModel).toBe('openai/gpt-5.5')
  })

  test('за замовч. передає CLOUD_AVG як модель', async () => {
    let capturedModel = null
    const r = await createRunner({
      callPi: (p, model) => {
        capturedModel = model
        return { ok: true, output: '' }
      }
    })
    await r.runStep('p')
    // CLOUD_AVG може бути '', якщо N_CLOUD_AVG_MODEL не задано в тесті — перевіряємо що string
    expect(typeof capturedModel).toBe('string')
  })

  test('callPi throw → runStep повертає ok:false, не кидає', async () => {
    const r = await createRunner({
      callPi: () => {
        throw new Error('pi not found')
      }
    })
    const res = await r.runStep('p')
    expect(res.ok).toBe(false)
    expect(res.output).toContain('pi not found')
  })

  test('callPi ok:false → runStep повертає ok:false з output', async () => {
    const r = await createRunner({ callPi: () => ({ ok: false, output: 'stderr msg' }) })
    const res = await r.runStep('p')
    expect(res).toEqual({ ok: false, output: 'stderr msg' })
  })
})

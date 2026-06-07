/**
 * Тести маршрутизації `runFlowCli` (`dispatcher/index.mjs`).
 * Підкоманди — stub-и; перевіряємо розводку та usage.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'

import { runFlowCli } from '../index.mjs'

afterEach(() => vi.restoreAllMocks())

describe('runFlowCli', () => {
  test('невідома підкоманда → usage + код 1', async () => {
    const err = vi.spyOn(console, 'error').mockReturnValue()
    expect(await runFlowCli(['bogus'])).toBe(1)
    expect(err).toHaveBeenCalled()
  })

  test('без підкоманди → usage + код 1', async () => {
    vi.spyOn(console, 'error').mockReturnValue()
    expect(await runFlowCli([])).toBe(1)
  })

  test('маршрутизує plan до handler-а', async () => {
    const planFn = vi.fn(async () => 0)
    const code = await runFlowCli(['plan'], { handlers: { plan: planFn } })
    expect(code).toBe(0)
    expect(planFn).toHaveBeenCalledWith([], expect.any(Object))
  })

  test('маршрутизує verify до handler-а', async () => {
    const verifyFn = vi.fn(async () => 0)
    const code = await runFlowCli(['verify'], { handlers: { verify: verifyFn } })
    expect(code).toBe(0)
    expect(verifyFn).toHaveBeenCalledWith([], expect.any(Object))
  })

  test('маршрутизує done до handler-а', async () => {
    const doneFn = vi.fn(async () => 0)
    const code = await runFlowCli(['done'], { handlers: { done: doneFn } })
    expect(code).toBe(0)
    expect(doneFn).toHaveBeenCalledWith([], expect.any(Object))
  })

  test('маршрутизує audit до handler-а', async () => {
    const auditFn = vi.fn(async () => 0)
    const code = await runFlowCli(['audit'], { handlers: { audit: auditFn } })
    expect(code).toBe(0)
    expect(auditFn).toHaveBeenCalledWith([], expect.any(Object))
  })

  test('маршрутизує failed до handler-а', async () => {
    const failedFn = vi.fn(async () => 0)
    const code = await runFlowCli(['failed'], { handlers: { failed: failedFn } })
    expect(code).toBe(0)
    expect(failedFn).toHaveBeenCalledWith([], expect.any(Object))
  })

  test('маршрутизує spawn до handler-а', async () => {
    const spawnFn = vi.fn(async () => 0)
    const code = await runFlowCli(['spawn'], { handlers: { spawn: spawnFn } })
    expect(code).toBe(0)
    expect(spawnFn).toHaveBeenCalledWith([], expect.any(Object))
  })

  test('прокидає решту аргументів у handler', async () => {
    const planFn = vi.fn(async () => 0)
    await runFlowCli(['plan', '--some-flag', 'value'], { handlers: { plan: planFn } })
    expect(planFn).toHaveBeenCalledWith(['--some-flag', 'value'], expect.any(Object))
  })

  test('handler повертає 1 → runFlowCli повертає 1', async () => {
    const code = await runFlowCli(['verify'], { handlers: { verify: async () => 1 } })
    expect(code).toBe(1)
  })
})

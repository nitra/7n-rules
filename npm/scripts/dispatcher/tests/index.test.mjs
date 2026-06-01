/**
 * Тести маршрутизації `runFlowCli` (`dispatcher/index.mjs`, spec §8). У Ф0
 * підкоманди — stub-и; перевіряємо саме розводку та usage.
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

  test('маршрутизує відому підкоманду до handler-а з rest-аргументами', async () => {
    const init = vi.fn(async () => 0)
    const code = await runFlowCli(['init', 'опис', '--model', 'x'], { handlers: { init } })
    expect(code).toBe(0)
    expect(init).toHaveBeenCalledWith(['опис', '--model', 'x'], expect.any(Object))
  })

  test('маршрутизує spec/plan з прапорцем --panel', async () => {
    const spec = vi.fn(async () => 0)
    const plan = vi.fn(async () => 0)
    await runFlowCli(['spec', '--panel'], { handlers: { spec } })
    await runFlowCli(['plan', '--panel'], { handlers: { plan } })
    expect(spec).toHaveBeenCalledWith(['--panel'], expect.any(Object))
    expect(plan).toHaveBeenCalledWith(['--panel'], expect.any(Object))
  })

  test('маршрутизує review', async () => {
    const review = vi.fn(async () => 0)
    await runFlowCli(['review'], { handlers: { review } })
    expect(review).toHaveBeenCalledWith([], expect.any(Object))
  })

  test('маршрутизує gate', async () => {
    const gate = vi.fn(async () => 0)
    await runFlowCli(['gate'], { handlers: { gate } })
    expect(gate).toHaveBeenCalledWith([], expect.any(Object))
  })
})

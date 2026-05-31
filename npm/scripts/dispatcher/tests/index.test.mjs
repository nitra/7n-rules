/**
 * Тести маршрутизації `runFlowCli` (`dispatcher/index.mjs`, spec §8). У Ф0
 * підкоманди — stub-и; перевіряємо саме розводку та usage.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'

import { DEFAULT_HANDLERS, SUBCOMMANDS, runFlowCli } from '../index.mjs'

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

  test('усі підкоманди зареєстровані як handler-и', () => {
    expect(Object.keys(DEFAULT_HANDLERS).toSorted()).toEqual([...SUBCOMMANDS].toSorted())
  })
})

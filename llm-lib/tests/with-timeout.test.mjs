/**
 * Тести with-timeout: falsy/від'ємний ms (без гонки — задокументована
 * поведінка), перемога основного promise, спрацювання таймауту з onTimeout
 * і label у повідомленні, прокидання помилки основного promise, відсутність
 * unhandled rejection після виграної гонки.
 */
import { describe, expect, test, vi } from 'vitest'
import { setTimeout as sleep } from 'node:timers/promises'
import { withTimeout } from '../lib/with-timeout.mjs'

describe('withTimeout', () => {
  test('falsy ms (0/undefined) — повертає promise без гонки, onTimeout не кличеться', async () => {
    const onTimeout = vi.fn()
    // ms=0 у гонці спрацював би миттєво; успіх повільнішого promise доводить її відсутність
    const slow = (async () => {
      await sleep(30)
      return 'done'
    })()
    await expect(withTimeout(slow, 0, { onTimeout })).resolves.toBe('done')
    await expect(withTimeout(Promise.resolve('v'), undefined, { onTimeout })).resolves.toBe('v')
    expect(onTimeout).not.toHaveBeenCalled()
  })

  test("від'ємний ms — теж без таймауту", async () => {
    await expect(
      withTimeout(
        (async () => {
          await sleep(20)
          return 42
        })(),
        -5
      )
    ).resolves.toBe(42)
  })

  test('promise встигає до таймауту — значення повертається, onTimeout не кличеться', async () => {
    const onTimeout = vi.fn()
    const result = await withTimeout(
      (async () => {
        await sleep(10)
        return 'ok'
      })(),
      500,
      { onTimeout, label: 'fast' }
    )
    expect(result).toBe('ok')
    expect(onTimeout).not.toHaveBeenCalled()
  })

  test('таймаут — reject із label у повідомленні, onTimeout викликаний один раз', async () => {
    const onTimeout = vi.fn()
    const hang = (async () => {
      await sleep(500)
      return 'late'
    })()
    await expect(withTimeout(hang, 15, { onTimeout, label: 'my-op' })).rejects.toThrow('my-op timeout 15ms')
    expect(onTimeout).toHaveBeenCalledTimes(1)
    await hang // дочекатися фонового sleep, щоб не текти між тестами
  })

  test('дефолтний label — "operation"', async () => {
    const hang = sleep(500)
    await expect(withTimeout(hang, 10)).rejects.toThrow('operation timeout 10ms')
    await hang
  })

  test('помилка основного promise до таймауту прокидається як є', async () => {
    const onTimeout = vi.fn()
    const failing = (async () => {
      await sleep(5)
      throw new Error('boom')
    })()
    await expect(withTimeout(failing, 500, { onTimeout })).rejects.toThrow('boom')
    expect(onTimeout).not.toHaveBeenCalled()
  })

  test('після виграної гонки скасований таймер не спливає unhandled rejection', async () => {
    const captured = []
    /**
     * @param {unknown} reason причина unhandled rejection
     * @returns {void}
     */
    const capture = reason => {
      captured.push(reason)
    }
    process.on('unhandledRejection', capture)
    try {
      await withTimeout(Promise.resolve('won'), 20)
      await sleep(50) // вікно, за яке AbortError таймера сплив би unhandled
      expect(captured).toEqual([])
    } finally {
      process.off('unhandledRejection', capture)
    }
  })
})

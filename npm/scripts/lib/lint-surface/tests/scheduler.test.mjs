import { describe, expect, test } from 'vitest'
import { setTimeout as sleep } from 'node:timers/promises'
import { once } from 'node:events'

import { runPlanConcurrently } from '../scheduler.mjs'

/** Скасування, спричинене нашим власним `AbortController` — очікувана поведінка, не помилка. */
class AbortError extends Error {
  /** @param {string} [message] текст помилки */
  constructor(message = 'The operation was aborted') {
    super(message)
    this.name = 'AbortError'
  }
}

/**
 * @param {number} [ms] затримка в мілісекундах
 * @returns {Promise<void>} проміс, що резолвиться на наступному тіку макротаску
 */
const tick = (ms = 5) => sleep(ms)

describe('runPlanConcurrently', () => {
  test('parallel lane не перевищує concurrency одночасних workers', async () => {
    const items = Array.from({ length: 8 }, (_, i) => i)
    let active = 0
    let maxActive = 0

    const { results, infraError } = await runPlanConcurrently(items, {
      concurrency: 3,
      isSerial: () => false,
      runItem: async item => {
        active += 1
        maxActive = Math.max(maxActive, active)
        await tick()
        active -= 1
        return item * 10
      }
    })

    expect(infraError).toBeNull()
    expect(maxActive).toBeLessThanOrEqual(3)
    expect(results).toHaveLength(8)
    expect(results.map(r => r.result).toSorted((a, b) => a - b)).toEqual([0, 10, 20, 30, 40, 50, 60, 70])
  })

  test('serial lane items ніколи не перекриваються самі з собою', async () => {
    const items = Array.from({ length: 5 }, (_, i) => i)
    let activeSerial = 0
    let overlapped = false

    const { results, infraError } = await runPlanConcurrently(items, {
      concurrency: 4,
      isSerial: () => true,
      runItem: async item => {
        activeSerial += 1
        if (activeSerial > 1) overlapped = true
        await tick()
        activeSerial -= 1
        return item
      }
    })

    expect(infraError).toBeNull()
    expect(overlapped).toBe(false)
    expect(results).toHaveLength(5)
  })

  test('serial і parallel лейни виконуються конкурентно один з одним', async () => {
    const order = []
    const { infraError } = await runPlanConcurrently(['s1', 'p1'], {
      concurrency: 2,
      isSerial: item => item === 's1',
      runItem: async item => {
        order.push(`${item}-start`)
        await tick(item === 's1' ? 20 : 5)
        order.push(`${item}-end`)
      }
    })

    expect(infraError).toBeNull()
    // p1 (коротший) стартує одночасно з s1 і завершується РАНІШЕ — якби лейни були
    // послідовними (спершу serial, потім parallel), p1-start був би останнім.
    expect(order.indexOf('p1-start')).toBeLessThan(order.indexOf('s1-end'))
  })

  test('перша помилка зупиняє нові старти в обох лейнах і чекає вже стартовані', async () => {
    const started = []
    const finished = []
    const items = ['ok-1', 'boom', 'ok-2', 'ok-3', 'ok-4']

    const { results, infraError } = await runPlanConcurrently(items, {
      concurrency: 2,
      isSerial: () => false,
      runItem: async item => {
        started.push(item)
        if (item === 'boom') {
          await tick(1)
          throw new Error('infra crash')
        }
        await tick(15)
        finished.push(item)
        return item
      }
    })

    expect(infraError).toBeInstanceOf(Error)
    expect(infraError.message).toBe('infra crash')
    // Не всі items мали шанс стартувати (пул зупинився одразу після infra-помилки).
    expect(started.length).toBeLessThan(items.length)
    // Усі, що реально стартували, з'явились у results (успішно чи з помилкою).
    expect(results).toHaveLength(started.length)
    // ok-1 стартував конкурентно з boom (concurrency=2) і встиг довиконатись — вже
    // запущені items завершуються, навіть якщо пізніше зʼявилась infra-помилка.
    expect(finished).toContain('ok-1')
  })

  test('AbortSignal доходить до вже запущеного item і позначається як очікуване скасування', async () => {
    let receivedSignal = null

    const { results, infraError } = await runPlanConcurrently(['slow', 'boom'], {
      concurrency: 2,
      isSerial: () => false,
      runItem: async (item, signal) => {
        if (item === 'boom') {
          await tick(1)
          throw new Error('infra crash')
        }
        receivedSignal = signal
        // чекає, поки інший item кине помилку й абортить signal, тоді сам кидає AbortError
        if (!signal.aborted) await once(signal, 'abort')
        throw new AbortError()
      }
    })

    expect(infraError.message).toBe('infra crash')
    expect(receivedSignal.aborted).toBe(true)
    const slowOutcome = results.find(r => r.item === 'slow')
    expect(slowOutcome.aborted).toBe(true)
    expect(slowOutcome.error).toBeUndefined()
  })
})

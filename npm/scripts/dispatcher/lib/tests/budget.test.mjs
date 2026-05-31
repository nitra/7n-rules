/**
 * Тести budget guard (`lib/budget.mjs`, spec §9.4).
 */
import { describe, expect, test } from 'vitest'

import { BudgetExceeded, withBudget } from '../budget.mjs'

describe('withBudget', () => {
  test('рахує виклики в межах ліміту', async () => {
    const wrapped = withBudget({ backend: 'x', runStep: async () => ({ ok: true }) }, { maxApiCalls: 2 })
    await wrapped.runStep('a')
    await wrapped.runStep('b')
    expect(wrapped.calls).toBe(2)
  })

  test('кидає BudgetExceeded при перевищенні', async () => {
    const wrapped = withBudget({ runStep: async () => ({}) }, { maxApiCalls: 1 })
    await wrapped.runStep('a')
    await expect(wrapped.runStep('b')).rejects.toBeInstanceOf(BudgetExceeded)
  })

  test('без ліміту (default) — не лімітує', async () => {
    const wrapped = withBudget({ runStep: async () => ({}) })
    await wrapped.runStep('a')
    await wrapped.runStep('b')
    expect(wrapped.calls).toBe(2)
  })
})

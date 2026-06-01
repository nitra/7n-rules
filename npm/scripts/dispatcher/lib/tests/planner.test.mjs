/**
 * Тести планувальника (`lib/planner.mjs`, spec §3 Ф1). runner ін'єктується.
 */
import { describe, expect, test } from 'vitest'

import { generatePlan, parsePlan, plannerPrompt } from '../planner.mjs'

describe('plannerPrompt', () => {
  test('містить задачу', () => {
    expect(plannerPrompt('кеш каталогу')).toContain('кеш каталогу')
  })
})

describe('parsePlan', () => {
  test('масив об\'єктів → нормалізовані кроки', () => {
    expect(parsePlan('[{"task":"a","acceptance":"x"},{"task":"b"}]')).toEqual([
      { step: 0, task: 'a', status: 'pending', retry_count: 0, acceptance: 'x' },
      { step: 1, task: 'b', status: 'pending', retry_count: 0 }
    ])
  })
  test('масив рядків', () => {
    expect(parsePlan('["a","b"]').map(s => s.task)).toEqual(['a', 'b'])
  })
  test('толерує префікс + markdown-огорожу', () => {
    expect(parsePlan('Ось план:\n```json\n[{"task":"a"}]\n```').length).toBe(1)
  })
  test('нема масиву → throw', () => {
    expect(() => parsePlan('нема плану')).toThrow(/fail-closed/)
  })
  test('невалідний JSON → throw', () => {
    expect(() => parsePlan('[{task: a}]')).toThrow(/fail-closed/)
  })
  test('порожній масив → throw', () => {
    expect(() => parsePlan('[]')).toThrow(/fail-closed/)
  })
  test('крок без task → throw', () => {
    expect(() => parsePlan('[{"acceptance":"x"}]')).toThrow(/fail-closed/)
  })
  test('відхиляє placeholder-кроки (TBD/порожній) — fail-closed', () => {
    expect(() => parsePlan('[{"task":"TBD"}]')).toThrow(/placeholder|TBD/i)
    expect(() => parsePlan('[{"task":"  "}]')).toThrow(/fail-closed/)
  })
})

describe('generatePlan', () => {
  test('ok → парсить вивід', async () => {
    const runner = { runStep: async () => ({ ok: true, output: '[{"task":"a"}]' }) }
    const p = await generatePlan({ runner, task: 't' })
    expect(p[0].task).toBe('a')
  })
  test('runner fail → throw', async () => {
    const runner = { runStep: async () => ({ ok: false, output: 'boom' }) }
    await expect(generatePlan({ runner, task: 't' })).rejects.toThrow(/планувальник завершився/)
  })
})

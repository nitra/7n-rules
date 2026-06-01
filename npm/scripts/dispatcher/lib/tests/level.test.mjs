/**
 * Тести scale-adaptive рівня (`lib/level.mjs`). Чисті функції — без IO.
 */
import { describe, expect, test } from 'vitest'

import { detectLevel, reviewersForLevel } from '../level.mjs'

describe('detectLevel', () => {
  test('L0 — тривіальне (fix/typo/bump)', () => {
    expect(detectLevel('fix typo in readme')).toBe(0)
    expect(detectLevel('bump deps')).toBe(0)
    expect(detectLevel('перейменування модуля')).toBe(0)
  })
  test('L3 — архітектурне (platform/migration/rewrite)', () => {
    expect(detectLevel('migration to new platform')).toBe(3)
    expect(detectLevel('повний редизайн архітектури')).toBe(3)
  })
  test('L2 — фіча/рефактор', () => {
    expect(detectLevel('add feature X')).toBe(2)
    expect(detectLevel('великий рефактор модуля')).toBe(2)
  })
  test('L1 — дефолт', () => {
    expect(detectLevel('додати кнопку')).toBe(1)
    expect(detectLevel('')).toBe(1)
    expect(detectLevel()).toBe(1)
  })
  test('пріоритет L3 > L0 (migration важливіше за fix у описі)', () => {
    expect(detectLevel('fix during platform migration')).toBe(3)
  })
})

describe('reviewersForLevel', () => {
  test('масштабування', () => {
    expect(reviewersForLevel(0)).toBe(1)
    expect(reviewersForLevel(1)).toBe(1)
    expect(reviewersForLevel(2)).toBe(2)
    expect(reviewersForLevel(3)).toBe(3)
  })
})

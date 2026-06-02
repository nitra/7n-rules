/**
 * Тести scale-adaptive рівня (`lib/level.mjs`). Чисті функції — без IO.
 */
import { describe, expect, test } from 'vitest'

import { detectLevel, detectRisk, reviewersFor, reviewersForLevel, reviewersForRisk } from '../level.mjs'

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
  test('ASCII L0-дієслово як ціле слово: prefix/fixture/suffix не дають хибний L0', () => {
    expect(detectLevel('add prefix validation')).toBe(1)
    expect(detectLevel('update fixture setup')).toBe(1)
    expect(detectLevel('suffix tweak')).toBe(1)
  })
  test('standalone fix/rename/hotfix лишаються L0 (без регресу)', () => {
    expect(detectLevel('fix prefix bug')).toBe(0)
    expect(detectLevel('rename module')).toBe(0)
    expect(detectLevel('hotfix login')).toBe(0)
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

describe('detectRisk', () => {
  test('high — безпека/гроші/доступи', () => {
    expect(detectRisk('fix auth token validation')).toBe('high')
    expect(detectRisk('зміна security-політики')).toBe('high')
  })
  test('med — дані/незворотність', () => {
    expect(detectRisk('db migration for orders')).toBe('med')
    expect(detectRisk('видалення застарілих записів')).toBe('med')
  })
  test('low — дефолт', () => {
    expect(detectRisk('додати кнопку')).toBe('low')
    expect(detectRisk()).toBe('low')
  })
})

describe('reviewersForRisk / reviewersFor', () => {
  test('reviewersForRisk', () => {
    expect(reviewersForRisk('high')).toBe(3)
    expect(reviewersForRisk('med')).toBe(2)
    expect(reviewersForRisk('low')).toBe(1)
  })
  test('reviewersFor — max(level, risk), кап 3', () => {
    expect(reviewersFor(0, 'high')).toBe(3) // тривіальне, але ризиковане
    expect(reviewersFor(2, 'low')).toBe(2) // розмір переважує
    expect(reviewersFor(0, 'low')).toBe(1)
    expect(reviewersFor(3, 'high')).toBe(3) // кап
  })
})

import { describe, expect, test } from 'vitest'

import { sectionMessages, overviewMessages, isApiGap, renderApiLine, apiGapMessages } from '../main.mjs'

const RE_EXACT_NAMES = /РІВНО ці публічні імена/
const RE_GENERIC_BAN = /відповідність контракту|обробка даних/

const FACTS = {
  relPath: 'npm/rules/bun/js/layout.mjs',
  header: 'перевірка bun-розкладки',
  exports: [{ name: 'check', desc: '' }],
  internalSymbols: [],
  markers: {}
}

describe('sectionMessages — Огляд більше не тут (R3)', () => {
  test('не повертає секцію overview', () => {
    const keys = sectionMessages(FACTS, 'export function check() {}', null).map(s => s.key)
    expect(keys).not.toContain('overview')
    expect(keys).toContain('behavior')
  })

  test('Поведінка обмежена експортованими іменами (R6)', () => {
    const multi = { ...FACTS, exports: [{ name: 'check' }, { name: 'parse' }] }
    const behavior = sectionMessages(multi, 'src', null).find(s => s.key === 'behavior')
    const user = behavior.messages.at(-1).content
    expect(user).toContain('check, parse')
    expect(user).toMatch(RE_EXACT_NAMES)
  })
})

describe('overviewMessages — узагальнення Поведінки (R3)', () => {
  test('містить текст Поведінки і заборону generic-формул', () => {
    const ms = overviewMessages(FACTS, 'Шукає bun.lock і забороняє yarn.lock.', null)
    const user = ms.at(-1).content
    expect(user).toContain('Шукає bun.lock і забороняє yarn.lock.')
    expect(user).toMatch(RE_GENERIC_BAN)
  })
})

describe('isApiGap — Stage 2 gap-детект (ADR 260719-2155)', () => {
  test('порожній desc → прогалина', () => {
    expect(isApiGap({ name: 'go', desc: '' })).toBe(true)
  })

  test('desc відсутній зовсім → прогалина', () => {
    expect(isApiGap({ name: 'go' })).toBe(true)
  })

  test('JSDoc-заглушка «опис.» → прогалина', () => {
    expect(isApiGap({ name: 'go', desc: 'опис.' })).toBe(true)
  })

  test('змістовний desc → не прогалина', () => {
    expect(isApiGap({ name: 'go', desc: 'Запускає перевірку.' })).toBe(false)
  })
})

describe('renderApiLine — Stage 1 дослівний рендер (0 токенів)', () => {
  test('name — desc дослівно, без перефразування', () => {
    expect(renderApiLine({ name: 'go', desc: 'Запускає перевірку.' })).toBe('- go — Запускає перевірку.')
  })
})

describe('apiGapMessages — Stage 3, LLM лише для прогалин', () => {
  test('містить лише імена прогалин, без покритих сусідів', () => {
    const ms = apiGapMessages([{ name: 'stop' }], null)
    const user = ms.at(-1).content
    expect(user).toContain('stop')
    expect(user).not.toContain('go')
  })
})

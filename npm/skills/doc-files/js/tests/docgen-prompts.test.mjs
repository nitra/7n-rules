import { describe, expect, test } from 'vitest'

import { sectionMessages, overviewMessages } from '../docgen-prompts.mjs'

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
    expect(user).toMatch(/РІВНО ці публічні імена/)
  })
})

describe('overviewMessages — узагальнення Поведінки (R3)', () => {
  test('містить текст Поведінки і заборону generic-формул', () => {
    const ms = overviewMessages(FACTS, 'Шукає bun.lock і забороняє yarn.lock.', null)
    const user = ms.at(-1).content
    expect(user).toContain('Шукає bun.lock і забороняє yarn.lock.')
    expect(user).toMatch(/відповідність контракту|обробка даних/)
  })
})

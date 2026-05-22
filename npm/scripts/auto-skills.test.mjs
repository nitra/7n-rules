/**
 * Тести автодетекту скілів для `.n-cursor.json` за `skills/<skill>/auto.md`.
 *
 * Скіли залежать від уже виявлених правил (вхід — `detectedRules`), а не безпосередньо
 * від файлів проєкту. Це навмисне: умови `adr-normalize` й `taze` дзеркалять умови
 * правил `adr` й `bun`, тож не дублюються.
 */
import { describe, expect, test } from 'bun:test'

import { detectAutoSkills } from './auto-skills.mjs'

const ALL_SKILLS = ['adr-normalize', 'fix', 'lint', 'llm-patch', 'publish-telegram', 'taze']

describe('detectAutoSkills', () => {
  test('завжди-додавані скіли — без правил у конфігу', () => {
    const actual = detectAutoSkills({
      availableSkills: ALL_SKILLS,
      detectedRules: []
    })

    expect(actual.skills).toEqual(['fix', 'lint', 'llm-patch', 'publish-telegram'])
  })

  test('adr-normalize додається, коли правило adr виявлене', () => {
    const actual = detectAutoSkills({
      availableSkills: ALL_SKILLS,
      detectedRules: ['adr']
    })

    expect(actual.skills).toEqual(['adr-normalize', 'fix', 'lint', 'llm-patch', 'publish-telegram'])
  })

  test('taze додається разом з правилом bun', () => {
    const actual = detectAutoSkills({
      availableSkills: ALL_SKILLS,
      detectedRules: ['bun']
    })

    expect(actual.skills).toEqual(['fix', 'lint', 'llm-patch', 'publish-telegram', 'taze'])
  })

  test('повний набір: adr + bun → всі скіли у фіксованому порядку', () => {
    const actual = detectAutoSkills({
      availableSkills: ALL_SKILLS,
      detectedRules: ['adr', 'bun']
    })

    expect(actual.skills).toEqual(['adr-normalize', 'fix', 'lint', 'llm-patch', 'publish-telegram', 'taze'])
  })

  test('disable-skills блокує автододавання', () => {
    const actual = detectAutoSkills({
      availableSkills: ALL_SKILLS,
      detectedRules: ['adr', 'bun'],
      disableSkills: ['fix', 'taze']
    })

    expect(actual.skills).toEqual(['adr-normalize', 'lint', 'llm-patch', 'publish-telegram'])
  })

  test('недоступні в пакеті скіли не додаються', () => {
    const actual = detectAutoSkills({
      availableSkills: ['fix', 'lint'],
      detectedRules: ['bun']
    })

    expect(actual.skills).toEqual(['fix', 'lint'])
  })

  test('taze НЕ додається без правила bun', () => {
    const actual = detectAutoSkills({
      availableSkills: ALL_SKILLS,
      detectedRules: ['vue', 'text']
    })

    expect(actual.skills.includes('taze')).toBe(false)
  })

  test('adr-normalize НЕ додається без правила adr', () => {
    const actual = detectAutoSkills({
      availableSkills: ALL_SKILLS,
      detectedRules: ['bun']
    })

    expect(actual.skills.includes('adr-normalize')).toBe(false)
  })
})

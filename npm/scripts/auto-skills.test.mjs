/**
 * Тести автодетекту скілів для `.n-cursor.json` за `skills/<skill>/auto.md`.
 *
 * Скіли залежать від уже виявлених правил (вхід — `detectedRules`), а не безпосередньо
 * від файлів проєкту. Це навмисне: умови `abie-kustomize` й `taze` дзеркалять умови
 * правил `abie` й `bun`, тож не дублюються.
 */
import { describe, expect, test } from 'bun:test'

import { detectAutoSkills } from './auto-skills.mjs'

const ALL_SKILLS = ['abie-kustomize', 'fix', 'lint', 'llm-patch', 'publish-telegram', 'taze']

describe('detectAutoSkills', () => {
  test('завжди-додавані скіли — без правил у конфігу', () => {
    const actual = detectAutoSkills({
      availableSkills: ALL_SKILLS,
      detectedRules: []
    })

    expect(actual.skills).toEqual(['fix', 'lint', 'llm-patch', 'publish-telegram'])
  })

  test('abie-kustomize додається, коли правило abie виявлене', () => {
    const actual = detectAutoSkills({
      availableSkills: ALL_SKILLS,
      detectedRules: ['abie']
    })

    expect(actual.skills).toEqual(['abie-kustomize', 'fix', 'lint', 'llm-patch', 'publish-telegram'])
  })

  test('taze додається разом з правилом bun', () => {
    const actual = detectAutoSkills({
      availableSkills: ALL_SKILLS,
      detectedRules: ['bun']
    })

    expect(actual.skills).toEqual(['fix', 'lint', 'llm-patch', 'publish-telegram', 'taze'])
  })

  test('повний набір: abie + bun → всі скіли у фіксованому порядку', () => {
    const actual = detectAutoSkills({
      availableSkills: ALL_SKILLS,
      detectedRules: ['abie', 'bun']
    })

    expect(actual.skills).toEqual(['abie-kustomize', 'fix', 'lint', 'llm-patch', 'publish-telegram', 'taze'])
  })

  test('disable-skills блокує автододавання', () => {
    const actual = detectAutoSkills({
      availableSkills: ALL_SKILLS,
      detectedRules: ['abie', 'bun'],
      disableSkills: ['fix', 'taze']
    })

    expect(actual.skills).toEqual(['abie-kustomize', 'lint', 'llm-patch', 'publish-telegram'])
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

  test('abie-kustomize НЕ додається без правила abie', () => {
    const actual = detectAutoSkills({
      availableSkills: ALL_SKILLS,
      detectedRules: ['bun']
    })

    expect(actual.skills.includes('abie-kustomize')).toBe(false)
  })
})

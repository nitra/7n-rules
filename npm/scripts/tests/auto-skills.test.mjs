/**
 * Тести автодетекту скілів для `.n-cursor.json` за `skills/<skill>/meta.json`.
 *
 * Скіли залежать від уже виявлених правил (вхід — `detectedRules`), а не безпосередньо
 * від файлів проєкту. Це навмисне: умови `adr-normalize` й `taze` дзеркалять умови
 * правил `adr` й `bun`, тож не дублюються.
 */
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import { detectAutoSkills, discoverSkillAutoActivation } from '../auto-skills.mjs'
import { ensureDir, withTmpDir, writeJson } from '../utils/test-helpers.mjs'

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

describe('discoverSkillAutoActivation (meta.json)', () => {
  test('читає auto: завжди / масив / пропуск', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'fix'))
      await writeJson(join(dir, 'fix', 'meta.json'), { auto: 'завжди', worktree: true })
      await ensureDir(join(dir, 'taze'))
      await writeJson(join(dir, 'taze', 'meta.json'), { auto: ['bun'], worktree: true })
      await ensureDir(join(dir, 'opt-in'))
      await writeJson(join(dir, 'opt-in', 'meta.json'), { worktree: false })

      const map = discoverSkillAutoActivation(dir)
      expect(map.fix).toEqual({ always: true })
      expect(map.taze).toEqual({ rules: ['bun'] })
      expect(map['opt-in']).toBeUndefined()
    })
  })

  test('скіл без meta.json не потрапляє в автоактивацію', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'bare'))
      expect(discoverSkillAutoActivation(dir).bare).toBeUndefined()
    })
  })
})

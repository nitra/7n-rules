import { describe, expect, test } from 'vitest'

import { parseChangeFile, serializeChangeFile, VALID_BUMPS, VALID_SECTIONS } from '../../lib/change-file.mjs'

describe('parseChangeFile', () => {
  test('парсить валідний frontmatter + опис', () => {
    const text = '---\nbump: minor\nsection: Added\n---\nДодав підтримку X\n'
    expect(parseChangeFile(text)).toEqual({ bump: 'minor', section: 'Added', description: 'Додав підтримку X' })
  })

  test('обрізає зайві пробіли в описі та кидає на порожньому описі', () => {
    const text = '---\nbump: patch\nsection: Fixed\n---\n\n  Виправив Y  \n\n'
    expect(parseChangeFile(text).description).toBe('Виправив Y')
    expect(() => parseChangeFile('---\nbump: patch\nsection: Fixed\n---\n   \n')).toThrow(/опис/)
  })

  test('кидає на невалідному bump/section та без frontmatter', () => {
    expect(() => parseChangeFile('---\nbump: huge\nsection: Added\n---\nx')).toThrow(/bump/)
    expect(() => parseChangeFile('---\nbump: patch\nsection: Nope\n---\nx')).toThrow(/section/)
    expect(() => parseChangeFile('просто текст')).toThrow(/frontmatter/)
  })

  test('VALID_* — очікувані множини', () => {
    expect(VALID_BUMPS).toEqual(['major', 'minor', 'patch'])
    expect(VALID_SECTIONS).toEqual(['Added', 'Changed', 'Fixed', 'Removed'])
  })
})

describe('serializeChangeFile', () => {
  test('round-trip із parseChangeFile', () => {
    const entry = { bump: 'major', section: 'Removed', description: 'Прибрав Z' }
    expect(parseChangeFile(serializeChangeFile(entry))).toEqual(entry)
  })
})

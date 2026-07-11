/**
 * Тести prompt-budget: budgetFor (копія, невідомий kind), capText
 * (межа, unicode-безпечність, маркер), fitToBudget (захист max-пріоритету,
 * обрізання → дроп, дефолтні label), packBatch (найменші першими,
 * oversize-одиниця → deferred, межа бюджету).
 */
import { describe, expect, test } from 'vitest'
import { budgetFor, capText, fitToBudget, packBatch } from '../lib/prompt-budget.mjs'

describe('budgetFor', () => {
  test('відомі типи задач повертають повний бюджет', () => {
    expect(budgetFor('header')).toEqual({ maxPromptChars: 8000, maxTokens: 2048 })
    expect(budgetFor('fix')).toEqual({ maxPromptChars: 60_000, maxTokens: 16_384 })
  })

  test('повертає копію — мутація результату не псує наступні виклики', () => {
    const first = budgetFor('block')
    first.maxPromptChars = 1
    expect(budgetFor('block').maxPromptChars).toBe(40_000)
  })

  test('невідомий taskKind — помилка з назвою типу', () => {
    expect(() => budgetFor('nope')).toThrow('невідомий taskKind "nope"')
  })
})

describe('capText', () => {
  test('текст коротший або рівний ліміту — без змін', () => {
    expect(capText('abc', 10)).toBe('abc')
    expect(capText('a'.repeat(10), 10)).toBe('a'.repeat(10))
  })

  test('на 1 символ понад ліміт — голова 70% + маркер + хвіст', () => {
    const text = 'абвгґдежзий' // 11 символів, ліміт 10
    const capped = capText(text, 10)
    // Голова/хвіст — похідні slice джерела (не літерали), щоб cspell не токенізував
    // фрагменти обрізаного слова як «невідомі» (канон: фікстури будуй динамічно).
    expect(capped).toBe(`${text.slice(0, 7)}\n...[обрізано 1 символів]...\n${text.slice(-3)}`)
  })

  test('unicode-безпечність — surrogate pairs (емодзі) не ріжуться навпіл', () => {
    const text = '🎯'.repeat(20)
    const capped = capText(text, 10)
    // голова 7 емодзі + хвіст 3 емодзі, жодного самотнього сурогата
    expect(capped.startsWith('🎯'.repeat(7))).toBe(true)
    expect(capped.endsWith('🎯'.repeat(3))).toBe(true)
    expect(capped).toContain('[обрізано 10 символів]')
    expect(capped.isWellFormed()).toBe(true)
  })
})

describe('fitToBudget', () => {
  test(String.raw`усе влазить — текст join через \n, dropped порожній`, () => {
    const { text, dropped } = fitToBudget(
      [
        { text: 'контекст', priority: 1 },
        { text: 'задача', priority: 10 }
      ],
      100
    )
    expect(text).toBe('контекст\nзадача')
    expect(dropped).toEqual([])
  })

  test('chunk із найвищим пріоритетом захищений навіть понад бюджет', () => {
    const task = 'x'.repeat(1000)
    const { text, dropped } = fitToBudget([{ text: task, priority: 10 }], 100)
    expect(text).toBe(task)
    expect(dropped).toEqual([])
  })

  test('нижчі пріоритети обрізаються, потім дропаються від найнижчого; вищий кандидат виживає обрізаним', () => {
    const { text, dropped } = fitToBudget(
      [
        { text: 'A'.repeat(1000), priority: 1, label: 'low' },
        { text: 'B'.repeat(1000), priority: 2, label: 'mid' },
        { text: 'T'.repeat(100), priority: 9, label: 'task' }
      ],
      900
    )
    // Обрізання самотужки в бюджет не вкладає (маркер додає ~31 символ),
    // тож прохід 2 дропає low цілком; mid лишається обрізаним.
    expect(dropped).toEqual(['low (обрізано)', 'mid (обрізано)', 'low (видалено)'])
    expect(text).not.toContain('A')
    expect(text).toContain('[обрізано')
    expect(text.endsWith('T'.repeat(100))).toBe(true)
    expect(text.length).toBeLessThanOrEqual(900)
  })

  test('без label — дефолтний chunk#<index>', () => {
    const { dropped } = fitToBudget(
      [
        { text: 'a'.repeat(500), priority: 1 },
        { text: 'задача', priority: 10 }
      ],
      100
    )
    expect(dropped).toContain('chunk#0 (видалено)')
  })
})

describe('packBatch', () => {
  test('пакує найменші першими, решта у deferred', () => {
    const { included, deferred } = packBatch(
      [
        { key: 'big', size: 60 },
        { key: 'small', size: 10 },
        { key: 'mid', size: 40 }
      ],
      55
    )
    expect(included).toEqual(['small', 'mid'])
    expect(deferred).toEqual(['big'])
  })

  test('одиниця, що сама-одна перевищує бюджет — deferred, не мовчазний skip', () => {
    const { included, deferred } = packBatch(
      [
        { key: 'huge', size: 1000 },
        { key: 'ok', size: 10 }
      ],
      100
    )
    expect(included).toEqual(['ok'])
    expect(deferred).toEqual(['huge'])
  })

  test('точна межа бюджету — включається', () => {
    const { included, deferred } = packBatch(
      [
        { key: 'a', size: 30 },
        { key: 'b', size: 70 }
      ],
      100
    )
    expect(included).toEqual(['a', 'b'])
    expect(deferred).toEqual([])
  })

  test('порожній список — порожні included/deferred, вхідний масив не мутується', () => {
    expect(packBatch([], 100)).toEqual({ included: [], deferred: [] })
    const items = [
      { key: 'z', size: 50 },
      { key: 'a', size: 10 }
    ]
    packBatch(items, 100)
    expect(items.map(i => i.key)).toEqual(['z', 'a'])
  })
})

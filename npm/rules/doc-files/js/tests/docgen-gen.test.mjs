import { describe, expect, test, vi, afterEach } from 'vitest'

vi.mock('node:fs', async importOriginal => ({ ...(await importOriginal()), readFileSync: vi.fn() }))

import { readFileSync } from 'node:fs'
import { scoreDoc, generateDoc } from '../docgen-gen.mjs'

const FACTS = { markers: { caches: false }, internalSymbols: [], localSymbols: [] }

// Чистий, конкретний документ — еталон 100
const CLEAN = `# foo.mjs

## Огляд

Перевіряє наявність bun.lock і забороняє yarn.lock у корені монорепо.

## Поведінка

1. Шукає заборонені lockfile-и конкурентних пакет-менеджерів.
2. Підтверджує, що bun.lock присутній.

## Гарантії поведінки

- Не звертається до мережі.
`

describe('scoreDoc — R4 generic-overview', () => {
  test('абстрактний Огляд штрафується і опускає score під поріг', () => {
    const md = CLEAN.replace(
      'Перевіряє наявність bun.lock і забороняє yarn.lock у корені монорепо.',
      'Файл надає інструмент для перевірки відповідності даних визначеному контракту.'
    )
    const { score, issues } = scoreDoc(md, FACTS)
    expect(issues).toContain('generic-overview')
    expect(score).toBeLessThan(70)
  })

  test('конкретний Огляд не штрафується', () => {
    expect(scoreDoc(CLEAN, FACTS).issues).not.toContain('generic-overview')
  })
})

describe('scoreDoc — R6 витік службових імен', () => {
  test('неекспортована функція у Поведінці → internal-name', () => {
    const md = CLEAN.replace('Підтверджує, що bun.lock присутній.', 'Викликає `ownerStatus` для обчислення стану.')
    const { issues } = scoreDoc(md, { ...FACTS, localSymbols: ['ownerStatus'] })
    expect(issues).toContain('internal-name:ownerStatus')
  })
})

describe('scoreDoc — R5 анкор-покриття', () => {
  const anchors = { urls: [], magicStrings: [], errorMarkers: ['bun.mdc'], configRefs: [] }
  const src = "throw new Error('(bun.mdc)')"

  test('пропущений валідний анкор → anchor-miss + штраф', () => {
    const { score, issues } = scoreDoc(CLEAN, FACTS, { anchors, src })
    expect(issues).toContain('anchor-miss:(bun.mdc)')
    expect(score).toBeLessThan(100)
  })

  test('наявний анкор → без штрафу', () => {
    const md = CLEAN.replace('Підтверджує, що bun.lock присутній.', 'Повідомлення несе маркер (bun.mdc).')
    expect(scoreDoc(md, FACTS, { anchors, src }).issues).not.toContain('anchor-miss:(bun.mdc)')
  })

  test('фейковий анкор (немає в src) не вимагається', () => {
    const fake = { urls: [], magicStrings: [], errorMarkers: [], configRefs: ['.local.json'] }
    expect(scoreDoc(CLEAN, FACTS, { anchors: fake, src: 'const x = 1' }).issues).not.toContain(
      'anchor-miss:.local.json'
    )
  })
})

describe('scoreDoc — R7 суржик', () => {
  test('русизм у тексті → surzhik', () => {
    const md = CLEAN.replace(
      'Шукає заборонені lockfile-и конкурентних пакет-менеджерів.',
      'Перевіряє файли, пропуская приховані.'
    )
    expect(scoreDoc(md, FACTS).issues).toContain('surzhik')
  })
})

describe('scoreDoc — еталон', () => {
  test('чистий документ → 100, без issues', () => {
    expect(scoreDoc(CLEAN, FACTS)).toEqual({ score: 100, issues: [] })
  })
})

describe('generateDoc — pre-send byte-guard', () => {
  afterEach(() => {
    delete process.env.N_CURSOR_DOCGEN_CTX
    vi.restoreAllMocks()
  })

  test('джерело понад бюджет → throw Prompt too long (skip, без LLM)', () => {
    process.env.N_CURSOR_DOCGEN_CTX = '100' // бюджет = 50 токенів ≈ 200 байтів
    readFileSync.mockReturnValue('x'.repeat(2000)) // ~500 токенів > 50
    expect(() => generateDoc('/big.js')).toThrow(/Prompt too long/)
  })
})

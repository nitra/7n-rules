import { afterEach, describe, expect, test, vi } from 'vitest'
import { env } from 'node:process'
import { readFileSync } from 'node:fs'

import { generateDoc, insertProtected, scoreDoc, splitProtected } from '../main.mjs'

vi.mock('node:fs', async importOriginal => ({ ...(await importOriginal()), readFileSync: vi.fn() }))

const FACTS = { markers: { caches: false }, internalSymbols: [], localSymbols: [] }

// Матчер помилки pre-send byte-guard (module scope — без ре-компіляції).
const PROMPT_TOO_LONG = /Prompt too long/

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
    delete env.N_CURSOR_DOCGEN_CTX
    vi.restoreAllMocks()
  })

  test('джерело понад бюджет → throw Prompt too long (skip, без LLM)', async () => {
    env.N_CURSOR_DOCGEN_CTX = '100' // бюджет = 50 токенів ≈ 200 байтів
    readFileSync.mockReturnValue('x'.repeat(2000)) // ~500 токенів > 50
    // generateDoc тепер async (pi-міграція) → pre-send guard реджектить, не кидає синхронно
    await expect(generateDoc('/big.js')).rejects.toThrow(PROMPT_TOO_LONG)
  })
})

const WITH_INTENT = `# foo.mjs

## Призначення

Рукотворний контракт. Деталі формату.

### Підрозділ

Ще деталі.

## Огляд

Машинний огляд.

## Поведінка

Крок один.
`

describe('splitProtected — захищена секція «Призначення» (Варіант B)', () => {
  test('витягує тіло, межа на наступному H2; ### усередині не обриває', () => {
    const { body } = splitProtected(WITH_INTENT)
    expect(body).toContain('Рукотворний контракт')
    expect(body).toContain('### Підрозділ')
    expect(body).toContain('Ще деталі')
    expect(body).not.toContain('Машинний огляд')
  })

  test('without прибирає блок, лишає машинні секції', () => {
    const { without } = splitProtected(WITH_INTENT)
    expect(without).not.toContain('Рукотворний контракт')
    expect(without).toContain('## Огляд')
    expect(without).toContain('Машинний огляд')
  })

  test('немає секції → body=null, without=md без змін', () => {
    const md = '# x\n\n## Огляд\n\nтекст\n'
    expect(splitProtected(md)).toEqual({ body: null, without: md })
  })
})

const INSERTED_INTENT_ORDER_RE = /# foo\.mjs[\s\S]*## Призначення[\s\S]*Контракт A\.[\s\S]*## Огляд/

describe('insertProtected — вставка після H1', () => {
  test('intent потрапляє між H1 і першою машинною секцією', () => {
    const machine = '# foo.mjs\n\n## Огляд\n\nОгляд тут.\n'
    const out = insertProtected(machine, 'Контракт A.')
    expect(out).toMatch(INSERTED_INTENT_ORDER_RE)
  })

  test('порожній intent → без змін', () => {
    const machine = '# foo.mjs\n\n## Огляд\n\nх\n'
    expect(insertProtected(machine, null)).toBe(machine)
  })

  test('roundtrip: insert → split повертає те саме тіло', () => {
    const out = insertProtected('# f\n\n## Огляд\n\nx\n', 'Контракт Б.')
    expect(splitProtected(out).body).toBe('Контракт Б.')
  })
})

describe('scoreDoc — захищена секція виключена зі скорингу', () => {
  const PROTECTED_FACTS = { markers: { caches: false }, internalSymbols: [], localSymbols: [] }

  test('суржик у «Призначення» НЕ штрафує', () => {
    const md = `# f\n\n## Призначення\n\nРаніше працювало у відповідності з планом.\n\n## Огляд\n\nЧистий конкретний огляд про bun.lock.\n\n## Поведінка\n\nКрок.\n`
    expect(scoreDoc(md, PROTECTED_FACTS).issues).not.toContain('surzhik')
  })

  test('суржик у машинній секції — штрафує (контроль)', () => {
    const md = `# f\n\n## Огляд\n\nОгляд, пропуская деталі.\n\n## Поведінка\n\nКрок.\n`
    expect(scoreDoc(md, PROTECTED_FACTS).issues).toContain('surzhik')
  })
})

import { afterEach, describe, expect, test, vi } from 'vitest'
import { env } from 'node:process'
import { readFileSync } from 'node:fs'

import {
  buildApiSection,
  capTimeoutToDeadline,
  generateDoc,
  insertProtected,
  scoreDoc,
  splitProtected,
  stripLeadingPreamble
} from '../main.mjs'
import { runOneShot } from '@7n/llm-lib/one-shot'

vi.mock('node:fs', async importOriginal => ({ ...(await importOriginal()), readFileSync: vi.fn() }))
vi.mock('@7n/llm-lib/one-shot', async importOriginal => ({ ...(await importOriginal()), runOneShot: vi.fn() }))

const FACTS = { markers: { caches: false }, internalSymbols: [], localSymbols: [] }

// Матчер помилки pre-send byte-guard (module scope — без ре-компіляції).
const PROMPT_TOO_LONG = /Prompt too long/
// Матчер помилки вичерпаного дедлайну fix-pipeline (module scope — без ре-компіляції).
const DEADLINE_TIMEOUT = /docgen deadline: .*timeout/

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

describe('scoreDoc — R8 refusal/чат-філер (пре-гейт перед judge, issue #16)', () => {
  test('«Я готовий писати… Надайте мені код» → refusal-filler, degraded попри валідну структуру', () => {
    // Структурно валідна дока (всі секції на місці) — саме так живий кейс отримав score=95.
    const md = CLEAN.replace(
      'Перевіряє наявність bun.lock і забороняє yarn.lock у корені монорепо.',
      'Я готовий писати поведінкову документацію. Надайте мені код, і я почну.'
    )
    const { score, issues } = scoreDoc(md, FACTS)
    expect(issues).toContain('refusal-filler')
    expect(score).toBeLessThan(70)
  })

  test('refusal-фраза лише в захищеному людському «Призначенні» → не штрафується', () => {
    const md = insertProtected(CLEAN, 'Я готовий доповнити цю секцію пізніше.')
    expect(scoreDoc(md, FACTS).issues).not.toContain('refusal-filler')
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

describe('capTimeoutToDeadline — зріз per-call таймауту під дедлайн рунга', () => {
  test('без дедлайну → базовий ліміт без змін', () => {
    expect(capTimeoutToDeadline(45_000, null)).toBe(45_000)
  })

  test('залишок до дедлайну менший за базовий → ріжеться до залишку', () => {
    expect(capTimeoutToDeadline(45_000, 1010, 1000)).toBe(10)
  })

  test('дедлайн у минулому → 0 (виклик не має стартувати)', () => {
    expect(capTimeoutToDeadline(45_000, 500, 1000)).toBe(0)
  })

  test('залишок більший за базовий → базовий ліміт', () => {
    expect(capTimeoutToDeadline(45_000, 1000 + 300_000, 1000)).toBe(45_000)
  })
})

describe('generateDoc — deadline fix-pipeline', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('вичерпаний бюджет → transient-помилка «timeout» без LLM-виклику, chain закривається fail', async () => {
    readFileSync.mockReturnValue('export const a = 1\n')
    const chain = { end: vi.fn() }
    await expect(generateDoc('/x.mjs', { deadlineAt: Date.now() - 1, chainFactory: () => chain })).rejects.toThrow(
      DEADLINE_TIMEOUT
    )
    expect(chain.end).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'fail' }))
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

describe('buildApiSection — Stage 1/3 гібрид (ADR 260719-2155): без LLM, коли немає прогалин', () => {
  test('немає експортів → порожня секція, без виклику LLM', async () => {
    await expect(buildApiSection({ exports: [] }, null, 'x', 1000)).resolves.toBe('')
  })

  test('єдиний непокритий експорт → порожня секція (лишається у Поведінці)', async () => {
    const facts = { exports: [{ name: 'go', desc: '' }] }
    await expect(buildApiSection(facts, null, 'x', 1000)).resolves.toBe('')
  })

  test('усі експорти покриті JSDoc → дослівний рендер, 0 LLM-викликів', async () => {
    const facts = {
      exports: [
        { name: 'go', desc: 'Запускає перевірку.' },
        { name: 'stop', desc: 'Зупиняє перевірку.' }
      ]
    }
    await expect(buildApiSection(facts, null, 'x', 1000)).resolves.toBe(
      '- go — Запускає перевірку.\n- stop — Зупиняє перевірку.'
    )
  })

  test('JSDoc-заглушка «опис.» вважається прогалиною (isApiGap): покритий рядок дослівно, прогалина — з LLM', async () => {
    runOneShot.mockResolvedValueOnce({ content: '- stop — Зупиняє фонові задачі.' })
    const facts = {
      exports: [
        { name: 'go', desc: 'Запускає перевірку.' },
        { name: 'stop', desc: 'опис.' }
      ]
    }
    const section = await buildApiSection(facts, null, 'x', 1000)
    expect(section).toBe('- go — Запускає перевірку.\n- stop — Зупиняє фонові задачі.')
    expect(runOneShot).toHaveBeenCalledTimes(1)
  })
})

describe('stripLeadingPreamble — R9 чат-преамбули (живі приклади gemma-4, efes 2026-07-21)', () => {
  test('«Ось оновлена чорнетка секції…» зрізається, контент лишається', () => {
    const raw =
      'Ось оновлена чорнетка секції «Overview», що відповідає всім зазначеним вимогам:\n\nКомпонент відповідає за генерацію контенту файлу Excel.'
    expect(stripLeadingPreamble(raw)).toBe('Компонент відповідає за генерацію контенту файлу Excel.')
  })

  test('«Як технічний письменник, я створю…» зрізається', () => {
    const raw =
      'Як технічний письменник, я створю контент для секції «Поведінка» у форматі лаконічного, нумерованого алгоритму.\n1. Отримує дані для експорту.'
    expect(stripLeadingPreamble(raw)).toBe('1. Отримує дані для експорту.')
  })

  test('дубль назви секції першим рядком («Поведінка:») зрізається', () => {
    const raw = 'Поведінка:\nvalidateUserAccess перевіряє наявність даних.'
    expect(stripLeadingPreamble(raw)).toBe('validateUserAccess перевіряє наявність даних.')
  })

  test('дві мета-рядки поспіль зрізаються обидві', () => {
    const raw = 'Оновлений текст секції:\nОгляд\nВизначає ідентичність користувача.'
    expect(stripLeadingPreamble(raw)).toBe('Визначає ідентичність користувача.')
  })

  test('звичайний текст без преамбули — без змін', () => {
    const raw = 'Формує JWT claims для Hasura.\nДругий рядок.'
    expect(stripLeadingPreamble(raw)).toBe(raw)
  })

  test('текст, що ЛИШЕ з преамбули — порожній рядок (не сміття)', () => {
    expect(stripLeadingPreamble('Ось оновлений текст секції:')).toBe('')
  })

  test('«Оглядає…»/«Створює…» на початку легітимного речення НЕ зрізаються (без false positive)', () => {
    const raw = 'Створює JWT claims для Hasura з ролями користувача.'
    expect(stripLeadingPreamble(raw)).toBe(raw)
  })
})

describe('scoreDoc — R9 chat-preamble штраф', () => {
  test('преамбула в машинній секції → chat-preamble, score падає', () => {
    const md = CLEAN.replace(
      'Перевіряє наявність bun.lock і забороняє yarn.lock у корені монорепо.',
      'Ось оновлена чорнетка секції, що відповідає вимогам:\nПеревіряє наявність bun.lock.'
    )
    const { score, issues } = scoreDoc(md, FACTS)
    expect(issues).toContain('chat-preamble')
    expect(score).toBeLessThan(100)
  })

  test('преамбула лише в захищеному «Призначенні» → не штрафується', () => {
    const md = insertProtected(CLEAN, 'Ось оновлений опис від людини.')
    expect(scoreDoc(md, FACTS).issues).not.toContain('chat-preamble')
  })

  test('чистий документ → без chat-preamble', () => {
    expect(scoreDoc(CLEAN, FACTS).issues).not.toContain('chat-preamble')
  })
})

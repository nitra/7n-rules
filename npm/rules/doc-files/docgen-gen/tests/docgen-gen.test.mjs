import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { env } from 'node:process'
import { readFileSync } from 'node:fs'

import {
  buildApiSection,
  capTimeoutToDeadline,
  finishBatchItem,
  generateDoc,
  insertProtected,
  prepareBatchItem,
  scoreDoc,
  splitProtected,
  stripLeadingPreamble
} from '../main.mjs'
import { runOneShot } from '@7n/llm-lib/one-shot'

vi.mock('node:fs', async importOriginal => ({ ...(await importOriginal()), readFileSync: vi.fn() }))
vi.mock('@7n/llm-lib/one-shot', async importOriginal => ({ ...(await importOriginal()), runOneShot: vi.fn() }))

// Supported-шлях (orchestratedDoc/judge, задача T8-coverage): без lang-плагінів у
// цьому dev-середовищі extractFacts ЗАВЖДИ unsupported, тож orchestratedDoc/
// runJudgeGate ніколи не виконувались жодним тестом. Підміняємо loadDocFilesExtractors,
// щоб для '.mjs' повертати керований `extractorState.facts` (null → unsupported,
// як і без плагінів — інші тести цей стан не займають).
const { extractorState } = vi.hoisted(() => ({ extractorState: { facts: null } }))
vi.mock('../../docgen-scan/lang-extensions.mjs', () => ({
  loadDocFilesExtractors: () => {
    const map = new Map()
    if (extractorState.facts) {
      map.set('.mjs', { extensions: ['.mjs'], extractFacts: () => extractorState.facts })
    }
    return Promise.resolve(map)
  }
}))

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

describe('prepareBatchItem / finishBatchItem — T8 2b-batch (без LLM-виклику)', () => {
  afterEach(() => {
    delete env.N_CURSOR_DOCGEN_CTX
    vi.restoreAllMocks()
  })

  test('prepareBatchItem: pre-send guard кидає ту саму помилку, що й generateDoc (без LLM)', async () => {
    env.N_CURSOR_DOCGEN_CTX = '100'
    readFileSync.mockReturnValue('x'.repeat(2000))
    await expect(prepareBatchItem('/big.js')).rejects.toThrow(PROMPT_TOO_LONG)
  })

  test('prepareBatchItem: повертає facts/anchors/src/messages/intent для допустимого джерела', async () => {
    readFileSync.mockReturnValue('export const a = 1\n')
    const prep = await prepareBatchItem('/x.mjs')
    expect(prep.src).toBe('export const a = 1\n')
    expect(prep.messages).toHaveLength(2)
    expect(prep.messages[0].role).toBe('system')
    expect(prep.messages[1].role).toBe('user')
    expect(prep.intent).toBeNull()
  })

  test('prepareBatchItem: захищена секція «Призначення» з наявної доки → intent', async () => {
    readFileSync.mockReturnValue('export const a = 1\n')
    const existingMd = insertProtected('# x.mjs\n\n## Огляд\n\nТест.\n', 'Контракт від людини.')
    const prep = await prepareBatchItem('/x.mjs', { existingMd })
    expect(prep.intent).toBe('Контракт від людини.')
  })

  test('finishBatchItem: unsupported + refusal-філер → score=0, degraded', () => {
    readFileSync.mockReturnValue('print(1)\n')
    const facts = { relPath: 'x.py', lang: 'py', unsupported: true, exports: [], imports: {}, markers: {} }
    const r = finishBatchItem('Я готовий писати документацію, надайте мені код.', {
      facts,
      anchors: null,
      src: 'print(1)\n',
      intent: null,
      model: 'omlx/test'
    })
    expect(r.score).toBe(0)
    expect(r.degraded).toBe(true)
    expect(r.issues).toContain('refusal-filler')
  })

  test('finishBatchItem: unsupported + чистий текст → score=null, не degraded', () => {
    const facts = { relPath: 'x.py', lang: 'py', unsupported: true, exports: [], imports: {}, markers: {} }
    const r = finishBatchItem('## Огляд\n\nРобить X.\n', {
      facts,
      anchors: null,
      src: 'print(1)\n',
      intent: null,
      model: 'omlx/test'
    })
    expect(r.score).toBeNull()
    expect(r.degraded).toBe(false)
    expect(r.md).toContain('# x.py')
  })

  test('finishBatchItem: det-скорер рахує score як і для orchestrated шляху (нижче порогу → degraded)', () => {
    const r = finishBatchItem('## Огляд\n\nX.\n', {
      facts: { ...FACTS, relPath: 'x.mjs' },
      anchors: null,
      src: '',
      intent: null,
      model: 'omlx/test'
    })
    expect(r.score).toBeLessThan(80)
    expect(r.degraded).toBe(true)
  })
})

/** Маршрути для `routedOneShot` — module-scope, без ре-компіляції regex на кожен виклик. */
const ONE_SHOT_ROUTES = [
  ['behavior', /Напиши вміст секції «Поведінка»/],
  ['overview', /На основі вже написаної секції «Поведінка»/],
  ['apiGap', /Для кожної названої публічної функції/],
  ['criticOverview', /Перевір цю чорнетку секції «overview»/],
  ['criticApi', /Перевір цю чорнетку секції «api»/],
  ['refineOverview', /Перепиши чорнетку секції «overview»/],
  ['refineApi', /Перепиши чорнетку секції «api»/],
  ['judge', /Return the JSON verdict/],
  ['judgeRefine', /Виправ ЛИШЕ хибні твердження/]
]

/**
 * Роутер runOneShot-заглушки для supported-шляху (orchestratedDoc/judge): диспетчеризує
 * за характерним фрагментом user-промпта — той самий сигнал, за яким сам prod-код
 * розрізняє section/critic/refine/judge messages (docgen-prompts.mjs/docgen-judge.mjs).
 * @param {Record<string, string|((user:string)=>string)>} handlers мапа ключ-маршруту → відповідь/функція(user)
 * @returns {(args:{messages:Array<{role:string,content:string}>}) => Promise<{content:string,error:null}>} мок runOneShot
 */
function routedOneShot(handlers) {
  return ({ messages }) => {
    const user = messages[1]?.content ?? messages[0]?.content ?? ''
    for (const [key, re] of ONE_SHOT_ROUTES) {
      if (re.test(user) && key in handlers) {
        const h = handlers[key]
        return Promise.resolve({ content: typeof h === 'function' ? h(user) : h, error: null })
      }
    }
    return Promise.reject(new Error(`routedOneShot: немає обробника для промпта: ${user.slice(0, 120)}`))
  }
}

const BEHAVIOR_TEXT =
  '1. Приймає вхідні дані.\n2. Обчислює doThing на основі вхідних даних.\n3. Повертає результат обчислення.'
const OVERVIEW_TEXT = 'Обчислює doThing для вхідних даних і повертає результат обчислення.'
const JUDGE_ACCURATE = JSON.stringify({ verdict: 'accurate', confidence: 0.9, reason: 'ok' })

/** Facts: один покритий JSDoc-описом експорт (buildApiSection рендерить без LLM). */
const FACTS_SINGLE_COVERED = {
  relPath: 'foo.mjs',
  lang: 'mjs',
  unsupported: false,
  header: '',
  exports: [{ name: 'doThing', desc: 'Обчислює значення X.' }],
  internalSymbols: [],
  localSymbols: [],
  imports: {},
  markers: {}
}

const SRC = 'export function doThing() { return 1 }\n'

describe('orchestratedDoc / judge — supported-file happy path (мок extractFacts + runOneShot)', () => {
  beforeEach(() => {
    // Рахунок викликів runOneShot звіряється по кожному тесту окремо — без чистого
    // старту calls-історія тягнеться з попередніх describe-блоків цього файлу.
    runOneShot.mockClear()
  })

  afterEach(() => {
    extractorState.facts = null
    vi.restoreAllMocks()
  })

  test('happy path: покритий API без LLM, критик NONE, суддя accurate → чистий success', async () => {
    extractorState.facts = FACTS_SINGLE_COVERED
    readFileSync.mockReturnValue(SRC)
    runOneShot.mockImplementation(
      routedOneShot({
        behavior: BEHAVIOR_TEXT,
        overview: OVERVIEW_TEXT,
        criticOverview: 'NONE',
        judge: JUDGE_ACCURATE
      })
    )
    const r = await generateDoc('/foo.mjs')
    expect(r.score).toBeGreaterThanOrEqual(80)
    expect(r.degraded).toBe(false)
    expect(r.judge.verdict).toBe('accurate')
    expect(r.md).toContain('## Публічний API')
    expect(r.md).toContain('- doThing — Обчислює значення X.')
    // Покритий JSDoc-експорт рендериться Stage 1 (дослівно, 0 LLM) — apiGap-промпт не летить:
    // behavior + overview + criticOverview + judge = рівно 4 виклики, без 5-го (apiGap).
    expect(runOneShot).toHaveBeenCalledTimes(4)
  })

  test('buildApiSection: мікс покритий+прогалина → apiGap LLM лише на прогалину (без critique-refine, gap.length!==exps.length)', async () => {
    extractorState.facts = {
      ...FACTS_SINGLE_COVERED,
      exports: [
        { name: 'a', desc: 'Робить А.' },
        { name: 'b', desc: '' }
      ]
    }
    readFileSync.mockReturnValue(SRC)
    runOneShot.mockImplementation(
      routedOneShot({
        behavior: BEHAVIOR_TEXT,
        overview: OVERVIEW_TEXT,
        apiGap: '- b — обчислює додаткове значення на основі вхідних даних.',
        criticOverview: 'NONE',
        judge: JUDGE_ACCURATE
      })
    )
    const r = await generateDoc('/foo.mjs')
    expect(r.md).toContain('- a — Робить А.')
    expect(r.md).toContain('- b — обчислює додаткове значення на основі вхідних даних.')
  })

  test('buildApiSection: усі експорти — прогалина → apiGap LLM + critique-refine (критик знайшов дефект)', async () => {
    extractorState.facts = {
      ...FACTS_SINGLE_COVERED,
      exports: [
        { name: 'a', desc: '' },
        { name: 'b', desc: '' }
      ]
    }
    readFileSync.mockReturnValue(SRC)
    runOneShot.mockImplementation(
      routedOneShot({
        behavior: BEHAVIOR_TEXT,
        overview: OVERVIEW_TEXT,
        apiGap: '- a — застосовує логіку.\n- b — застосовує логіку.',
        criticApi: '1. Generic-фрази без конкретики.',
        refineApi: '- a — обчислює перше значення.\n- b — обчислює друге значення.',
        criticOverview: 'NONE',
        judge: JUDGE_ACCURATE
      })
    )
    const r = await generateDoc('/foo.mjs')
    expect(r.md).toContain('- a — обчислює перше значення.')
    expect(r.md).toContain('- b — обчислює друге значення.')
  })

  test("best-of-2: перша спроба нижче порогу, ретрай кращий → 'best-of-2:retry-won', судиться вже переможець", async () => {
    extractorState.facts = FACTS_SINGLE_COVERED
    readFileSync.mockReturnValue(SRC)
    let attempt = 0
    runOneShot.mockImplementation(
      routedOneShot({
        behavior: () => {
          attempt++
          return attempt === 1 ? 'Замало.' : BEHAVIOR_TEXT
        },
        overview: () => (attempt === 1 ? '' : OVERVIEW_TEXT),
        criticOverview: 'NONE',
        judge: JUDGE_ACCURATE
      })
    )
    const r = await generateDoc('/foo.mjs')
    expect(r.issues).toContain('best-of-2:retry-won')
    expect(r.degraded).toBe(false)
  })

  test('judge gate: inaccurate → judge-refine приймається (заголовки збережено, score не впав, повторний суддя accurate)', async () => {
    extractorState.facts = FACTS_SINGLE_COVERED
    readFileSync.mockReturnValue(SRC)
    const FIXED_DOC = `# foo.mjs

## Огляд

${OVERVIEW_TEXT}

## Поведінка

${BEHAVIOR_TEXT}

## Публічний API

- doThing — Обчислює значення X.

## Гарантії поведінки

- (специфічних машинно-виведених гарантій немає)
`
    let judgeCalls = 0
    runOneShot.mockImplementation(
      routedOneShot({
        behavior: BEHAVIOR_TEXT,
        overview: OVERVIEW_TEXT,
        criticOverview: 'NONE',
        judge: () => {
          judgeCalls++
          return judgeCalls === 1
            ? JSON.stringify({ verdict: 'inaccurate', confidence: 0.9, reason: 'хибне твердження про кеш' })
            : JUDGE_ACCURATE
        },
        judgeRefine: FIXED_DOC
      })
    )
    const r = await generateDoc('/foo.mjs')
    expect(r.issues).toContain('judge-refine:won')
    expect(r.degraded).toBe(false)
    expect(r.judge.verdict).toBe('accurate')
    expect(judgeCalls).toBe(2)
  })

  test('judge gate: inaccurate → judge-refine відхилено (рерайт губить заголовок) → лишається degraded', async () => {
    extractorState.facts = FACTS_SINGLE_COVERED
    readFileSync.mockReturnValue(SRC)
    // Рерайт без «## Публічний API» — Guard 1 (origHeadings) провалюється, другий
    // виклик судді НЕ відбувається (judgeRefinePass повертає null одразу).
    const BROKEN_FIX = `# foo.mjs\n\n## Огляд\n\n${OVERVIEW_TEXT}\n\n## Поведінка\n\n${BEHAVIOR_TEXT}\n`
    runOneShot.mockImplementation(
      routedOneShot({
        behavior: BEHAVIOR_TEXT,
        overview: OVERVIEW_TEXT,
        criticOverview: 'NONE',
        judge: JSON.stringify({ verdict: 'inaccurate', confidence: 0.9, reason: 'хибне твердження' }),
        judgeRefine: BROKEN_FIX
      })
    )
    const r = await generateDoc('/foo.mjs')
    expect(r.issues).toContain('judge-refine:kept-original')
    expect(r.degraded).toBe(true)
    expect(r.judge.verdict).toBe('inaccurate')
  })
})

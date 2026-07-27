/**
 * Тести хвильового batch-конвеєра (фаза 2, спека
 * `2026-07-27-batch-local-avg-real-batches.md`): кожна хвиля — один
 * `submitBatchImpl`-виклик на всі живі файли; помилка обов'язкового виклику
 * валить лише СВІЙ файл; критика→refine лише коли критик не сказав NONE;
 * best-of-2 приймає ретрай лише якщо він кращий; judge гейтує degraded.
 *
 * `node:fs`/lang-екстрактори/docgen-crc/docgen-judge мокаються (як і в
 * `docgen-gen.test.mjs`); det-скорер (`scoreDoc`) і решта чистої логіки —
 * справжні.
 */
import { describe, expect, test, vi, beforeEach } from 'vitest'

const { writeFileSyncMock } = vi.hoisted(() => ({ writeFileSyncMock: vi.fn() }))

vi.mock('node:fs', async importOriginal => ({
  ...(await importOriginal()),
  readFileSync: () => 'export function f() {}\n',
  writeFileSync: writeFileSyncMock,
  mkdirSync: vi.fn(),
  existsSync: () => false
}))

vi.mock('../../docgen-scan/lang-extensions.mjs', () => ({
  loadDocFilesExtractors: () => {
    const map = new Map([
      [
        '.mjs',
        {
          extensions: ['.mjs'],
          extractFacts: (src, file) => ({
            relPath: file,
            lang: 'js',
            unsupported: false,
            header: '',
            exports: [],
            imports: {},
            markers: { caches: false },
            internalSymbols: [],
            localSymbols: []
          })
        }
      ]
    ])
    return Promise.resolve(map)
  }
}))

vi.mock('../../docgen-test-context/main.mjs', () => ({
  buildTestEvidenceIndex: () => ({}),
  testEvidenceForSource: () => ({ files: [] }),
  renderTestScenarios: () => ''
}))

vi.mock('../../docgen-crc/main.mjs', async importOriginal => ({
  ...(await importOriginal()),
  documentationCrc: () => 'crc',
  stampDoc: md => md
}))

// JUDGE_ENABLED — статична константа docgen-judge (Boolean(CLOUD_MIN)); той
// самий примусовий override, що й у docgen-gen.test.mjs, щоб judge-тести не
// залежали від ambient env.
let judgeEnabled = false
vi.mock('../../docgen-judge/main.mjs', async importOriginal => ({
  ...(await importOriginal()),
  get JUDGE_ENABLED() {
    return judgeEnabled
  },
  JUDGE_MODEL: 'test/judge-model'
}))

const { runWaveBatch } = await import('../main.mjs')

/**
 * Стан item-у, готовий для `runWaveBatch` (той самий формат, що й вихід
 * `prepareBatchTargets`/`prepareBatchItem` у `docgen-files-batch`).
 * @param {string} name базове ім'я файлу (без розширення)
 * @param {'full'|'comment+behavior'} mode режим
 * @returns {object} підготовлений елемент
 */
function prepItem(name, mode = 'full') {
  return {
    file: { sourcePath: `src/${name}.mjs`, docPath: `src/docs/${name}.md` },
    sourceAbs: `/root/src/${name}.mjs`,
    docAbs: `/root/src/docs/${name}.md`,
    size: 42,
    testIndex: {},
    facts: {
      relPath: `src/${name}.mjs`,
      lang: 'js',
      unsupported: false,
      header: '',
      exports: [],
      imports: {},
      markers: { caches: false },
      internalSymbols: [],
      localSymbols: []
    },
    anchors: null,
    src: 'export function f() {}\n',
    mode,
    intent: null
  }
}

const CLEAN_BEHAVIOR = '1. Читає конфіг із диска.\n2. Валідує обов’язкові поля.\n3. Повертає нормалізований обʼєкт.'
const CLEAN_OVERVIEW = 'Завантажує й нормалізує конфіг застосунку перед стартом сервера.'

/**
 * Фейковий `submitBatchImpl`: маршрутизує відповідь за суфіксом `customId`
 * (`::behavior`, `::overview`, `::critique:*`, `::refine:*`, `::judge`) через
 * передану мапу `responders` (customId-суфікс → `(item) => {ok}|{error}`).
 * @param {Record<string, (item: object) => {ok?: string, error?: string}>} responders мапа суфікс→відповідь
 * @returns {(model: string, items: Array<object>) => Promise<Array<object>>} fake submitBatch
 */
function fakeSubmitBatch(responders) {
  return (model, items) =>
    Promise.resolve(
      items.map(item => {
        const suffix = item.customId.split('::').slice(1).join('::')
        const responder = responders[suffix]
        const result = responder ? responder(item) : { ok: 'дефолтна відповідь' }
        return { customId: item.customId, ...result }
      })
    )
}

describe('runWaveBatch — щасливий шлях (full mode)', () => {
  beforeEach(() => {
    writeFileSyncMock.mockClear()
    judgeEnabled = false
  })

  test('behavior → overview → фінальний запис доки з хорошим score', async () => {
    const stats = { ok: 0, degraded: 0, err: 0, errors: [], skipped: [] }
    const out = vi.fn()
    const submitBatchImpl = fakeSubmitBatch({
      behavior: () => ({ ok: CLEAN_BEHAVIOR }),
      overview: () => ({ ok: CLEAN_OVERVIEW }),
      'critique:overview': () => ({ ok: 'NONE' })
    })

    await runWaveBatch([prepItem('a')], { model: 'omlx/test', submitBatchImpl }, stats, { out })

    expect(stats.ok).toBe(1)
    expect(stats.err).toBe(0)
    expect(writeFileSyncMock).toHaveBeenCalledTimes(1)
    const [docPath, md] = writeFileSyncMock.mock.calls[0]
    expect(docPath).toBe('/root/src/docs/a.md')
    expect(md).toContain(CLEAN_BEHAVIOR)
    expect(md).toContain(CLEAN_OVERVIEW)
  })

  test('N файлів — один submitBatchImpl-виклик на хвилю, не по одному на файл', async () => {
    const stats = { ok: 0, degraded: 0, err: 0, errors: [], skipped: [] }
    const calls = []
    const submitBatchImpl = vi.fn((model, items) => {
      calls.push(items.length)
      return fakeSubmitBatch({
        behavior: () => ({ ok: CLEAN_BEHAVIOR }),
        overview: () => ({ ok: CLEAN_OVERVIEW }),
        'critique:overview': () => ({ ok: 'NONE' })
      })(model, items)
    })

    const items = Array.from({ length: 5 }, (_, i) => prepItem(`f${i}`))
    await runWaveBatch(items, { model: 'omlx/test', submitBatchImpl }, stats, { out: vi.fn() })

    expect(stats.ok).toBe(5)
    // Wave A: 5 behavior items; Wave B: 5 overview; Wave C: 5 critique:overview;
    // Wave D: 0 (критик усюди NONE) — submitBatchImpl НЕ викликається для порожньої хвилі.
    expect(submitBatchImpl).toHaveBeenCalledTimes(3)
    expect(calls).toEqual([5, 5, 5])
  })
})

describe('runWaveBatch — помилка обов’язкового виклику валить лише свій файл', () => {
  beforeEach(() => {
    writeFileSyncMock.mockClear()
  })

  test('behavior для одного файлу падає — інший файл усе одно записується', async () => {
    const stats = { ok: 0, degraded: 0, err: 0, errors: [], skipped: [] }
    const submitBatchImpl = fakeSubmitBatch({
      behavior: item =>
        item.customId.startsWith('src/bad') ? { error: 'omlx api: connection refused' } : { ok: CLEAN_BEHAVIOR },
      overview: () => ({ ok: CLEAN_OVERVIEW }),
      'critique:overview': () => ({ ok: 'NONE' })
    })

    await runWaveBatch([prepItem('bad'), prepItem('good')], { model: 'omlx/test', submitBatchImpl }, stats, {
      out: vi.fn()
    })

    expect(stats.ok).toBe(1)
    expect(stats.err).toBe(1)
    expect(stats.errors).toEqual(['src/bad.mjs'])
    expect(writeFileSyncMock).toHaveBeenCalledTimes(1)
    expect(writeFileSyncMock.mock.calls[0][0]).toBe('/root/src/docs/good.md')
  })

  test('permanent-помилка (prompt too long) → skip, не err', async () => {
    const stats = { ok: 0, degraded: 0, err: 0, errors: [], skipped: [] }
    const submitBatchImpl = fakeSubmitBatch({
      behavior: () => ({ error: 'Prompt too long: занадто великий' })
    })

    await runWaveBatch([prepItem('huge')], { model: 'omlx/test', submitBatchImpl }, stats, { out: vi.fn() })

    expect(stats.err).toBe(0)
    expect(stats.skipped).toEqual(['src/huge.mjs'])
  })
})

describe('runWaveBatch — critique→refine (Wave C/D)', () => {
  beforeEach(() => {
    writeFileSyncMock.mockClear()
  })

  test('критик дає непорожнє зауваження → refine замінює overview у фінальному md', async () => {
    const stats = { ok: 0, degraded: 0, err: 0, errors: [], skipped: [] }
    const refinedOverview = 'Виправлений огляд без загальних фраз про застосування логіки.'
    const submitBatchImpl = fakeSubmitBatch({
      behavior: () => ({ ok: CLEAN_BEHAVIOR }),
      overview: () => ({ ok: 'Застосовує логіку для обробки даних.' }), // R4 generic-overview
      'critique:overview': () => ({ ok: '1. Generic-фраза без конкретики.' }),
      'refine:overview': () => ({ ok: refinedOverview })
    })

    await runWaveBatch([prepItem('a')], { model: 'omlx/test', submitBatchImpl }, stats, { out: vi.fn() })

    const md = writeFileSyncMock.mock.calls[0][1]
    expect(md).toContain(refinedOverview)
    expect(md).not.toContain('Застосовує логіку')
  })

  test('критик каже NONE → refine-хвиля не викликається для цього файлу', async () => {
    const stats = { ok: 0, degraded: 0, err: 0, errors: [], skipped: [] }
    const refineSpy = vi.fn(() => ({ ok: 'МАЄ НЕ ВИКЛИКАТИСЬ' }))
    const submitBatchImpl = fakeSubmitBatch({
      behavior: () => ({ ok: CLEAN_BEHAVIOR }),
      overview: () => ({ ok: CLEAN_OVERVIEW }),
      'critique:overview': () => ({ ok: 'NONE' }),
      'refine:overview': refineSpy
    })

    await runWaveBatch([prepItem('a')], { model: 'omlx/test', submitBatchImpl }, stats, { out: vi.fn() })

    expect(refineSpy).not.toHaveBeenCalled()
    expect(writeFileSyncMock.mock.calls[0][1]).toContain(CLEAN_OVERVIEW)
  })
})

describe('runWaveBatch — best-of-2', () => {
  beforeEach(() => {
    writeFileSyncMock.mockClear()
  })

  test('слабкий перший прохід, кращий ретрай на temperature 0.5 — перемагає ретрай', async () => {
    const stats = { ok: 0, degraded: 0, err: 0, errors: [], skipped: [] }
    let behaviorCall = 0
    const submitBatchImpl = fakeSubmitBatch({
      behavior: () => {
        behaviorCall++
        // Перший прохід: generic-overview спровокує низький score через Огляд
        // (behavior лишається тим самим — важливий саме overview нижче).
        return { ok: CLEAN_BEHAVIOR }
      },
      overview: () =>
        behaviorCall <= 1
          ? { ok: 'Виконує перевірку відповідності даних визначеному контракту.' } // R4, низький score
          : { ok: CLEAN_OVERVIEW }, // ретрай (temp 0.5) — чистий
      'critique:overview': () => ({ ok: 'NONE' })
    })

    await runWaveBatch([prepItem('weak')], { model: 'omlx/test', submitBatchImpl }, stats, { out: vi.fn() })

    const md = writeFileSyncMock.mock.calls[0][1]
    expect(md).toContain(CLEAN_OVERVIEW)
    expect(stats.ok).toBe(1)
  })
})

describe('runWaveBatch — judge (Wave E)', () => {
  beforeEach(() => {
    writeFileSyncMock.mockClear()
    judgeEnabled = true
  })

  test('суддя каже inaccurate з достатньою впевненістю → degraded=true', async () => {
    const stats = { ok: 0, degraded: 0, err: 0, errors: [], skipped: [] }
    const submitBatchImpl = fakeSubmitBatch({
      behavior: () => ({ ok: CLEAN_BEHAVIOR }),
      overview: () => ({ ok: CLEAN_OVERVIEW }),
      'critique:overview': () => ({ ok: 'NONE' }),
      judge: () => ({ ok: '{"verdict":"inaccurate","confidence":0.95,"reason":"вигаданий факт"}' })
    })

    await runWaveBatch([prepItem('a')], { model: 'omlx/test', submitBatchImpl }, stats, { out: vi.fn() })

    expect(stats.degraded).toBe(1)
  })

  test('суддя каже accurate → не degraded', async () => {
    const stats = { ok: 0, degraded: 0, err: 0, errors: [], skipped: [] }
    const submitBatchImpl = fakeSubmitBatch({
      behavior: () => ({ ok: CLEAN_BEHAVIOR }),
      overview: () => ({ ok: CLEAN_OVERVIEW }),
      'critique:overview': () => ({ ok: 'NONE' }),
      judge: () => ({ ok: '{"verdict":"accurate","confidence":0.95,"reason":"ок"}' })
    })

    await runWaveBatch([prepItem('a')], { model: 'omlx/test', submitBatchImpl }, stats, { out: vi.fn() })

    expect(stats.degraded).toBe(0)
  })
})

describe("runWaveBatch — 'comment+behavior' режим", () => {
  beforeEach(() => {
    writeFileSyncMock.mockClear()
    judgeEnabled = false
  })

  test('один behavior-виклик, без overview/critique-хвиль', async () => {
    const stats = { ok: 0, degraded: 0, err: 0, errors: [], skipped: [] }
    const overviewSpy = vi.fn(() => ({ ok: 'МАЄ НЕ ВИКЛИКАТИСЬ' }))
    const submitBatchImpl = fakeSubmitBatch({
      behavior: () => ({ ok: 'Додатковий контракт: приймає лише абсолютні шляхи.' }),
      overview: overviewSpy
    })
    const p = prepItem('withComments', 'comment+behavior')
    p.facts.header = 'Читає файл конфігурації.'

    await runWaveBatch([p], { model: 'omlx/test', submitBatchImpl }, stats, { out: vi.fn() })

    expect(overviewSpy).not.toHaveBeenCalled()
    expect(stats.ok).toBe(1)
    expect(writeFileSyncMock).toHaveBeenCalledTimes(1)
  })
})

describe('runWaveBatch — порожній вхід', () => {
  test('0 items → 0 submitBatchImpl-викликів', async () => {
    const stats = { ok: 0, degraded: 0, err: 0, errors: [], skipped: [] }
    const submitBatchImpl = vi.fn()
    await runWaveBatch([], { model: 'omlx/test', submitBatchImpl }, stats, { out: vi.fn() })
    expect(submitBatchImpl).not.toHaveBeenCalled()
    expect(stats.ok).toBe(0)
  })
})

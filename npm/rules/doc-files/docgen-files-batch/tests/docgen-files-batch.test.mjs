/**
 * Тести оркестратора docgen-files-batch: класифікація збоїв у циклі —
 *   - systemic ×K підряд → негайний abort (exit 2), решта файлів не чіпається;
 *   - permanent → skip (не «помилка»), прогін триває, exit 0;
 *   - ok між systemic скидає streak → без abort.
 *
 * generateDoc / scan / health / fs / crc мокаються; класифікатор — справжній.
 */
import { describe, expect, test, vi, beforeEach } from 'vitest'

const { generateDocMock, scanMock, readDocQualityMock, readDocTierMock, prepareBatchItemMock, finishBatchItemMock } =
  vi.hoisted(() => ({
    generateDocMock: vi.fn(),
    scanMock: vi.fn(),
    readDocQualityMock: vi.fn(() => ({ score: null, issues: [], judgeModel: null })),
    readDocTierMock: vi.fn(() => null),
    // T8 (2b-batch): prepareBatchItem/finishBatchItem — реальна логіка тестується окремо
    // в docgen-gen/tests/; тут batch-оркестрацію перевіряємо з простими стабами.
    prepareBatchItemMock: vi.fn(),
    finishBatchItemMock: vi.fn()
  }))

vi.mock('../../docgen-gen/main.mjs', () => ({
  generateDoc: generateDocMock,
  DEFAULT_LOCAL_MODEL: 'omlx/test-model',
  prepareBatchItem: prepareBatchItemMock,
  finishBatchItem: finishBatchItemMock
}))
vi.mock('../../docgen-scan/main.mjs', () => ({
  resolveRoot: () => '/fake-root',
  scanForDocFiles: scanMock,
  scanOrphanedDocs: () => [] // у batch-тестах orphan-перевірка незначима
}))
vi.mock('../../docgen-crc/main.mjs', () => ({
  crc32: () => 'crc',
  stampDoc: md => md,
  readDocQuality: readDocQualityMock,
  readDocTier: readDocTierMock,
  readDocModel: () => null,
  QUALITY_THRESHOLD: 80
}))
// (pi-міграція: docgen-files-batch більше не імпортує lib/llm.mjs — preflight прибрано,
// доступність моделі тепер per-call у generateDoc; circuit-breaker тестуємо через generateDocMock)
vi.mock('node:fs', () => ({
  readFileSync: () => Buffer.from('x'),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  existsSync: () => false,
  statSync: () => ({ size: 100 })
}))

const { runDocFilesGenCli, runGenerationBatch, selectTargets, nativeBatchAvailable } = await import('../main.mjs')

/**
 * @param {number} n кількість stale-цілей.
 * @returns {Array<{sourcePath: string, docPath: string, stale: boolean}>} масив stale-цілей.
 */
const targets = n =>
  Array.from({ length: n }, (_, i) => ({ sourcePath: `src/f${i}.js`, docPath: `src/docs/f${i}.md`, stale: true }))

/**
 * Стаб `prepareBatchItem` (T8-тести): мінімальний prep-обʼєкт для будь-якого файлу.
 * @param {string} file абсолютний шлях джерела.
 * @returns {Promise<object>} prep-обʼєкт.
 */
const prepOk = file =>
  Promise.resolve({
    facts: { relPath: file, unsupported: true, exports: [], imports: {}, markers: {} },
    anchors: null,
    src: 'x',
    messages: [
      { role: 'system', content: 'style' },
      { role: 'user', content: `prompt for ${file}` }
    ],
    intent: null
  })

const SYSTEMIC = () => {
  throw new Error('omlx api: ... memory ceiling 11.84GB')
}
const PERMANENT = () => {
  throw new Error('omlx api: Prompt too long: 9177917 tokens exceeds max context window')
}
const OK = () => ({
  md: '## Огляд\n',
  score: 90,
  degraded: false,
  issues: [],
  model: 'omlx/test-model',
  ms: 1,
  llmMs: 1,
  llmCalls: 1
})

describe('runDocFilesGenCli — circuit-breaker / класифікація', () => {
  beforeEach(() => {
    generateDocMock.mockReset()
    scanMock.mockReset()
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(console, 'log').mockImplementation(() => {
      // навмисний no-op: глушимо console.log у тесті
    })
    vi.spyOn(console, 'error').mockImplementation(() => {
      // навмисний no-op: глушимо console.error у тесті
    })
  })

  test('3 systemic підряд → abort, exit 2, решта не обробляється', async () => {
    scanMock.mockReturnValue(targets(5))
    generateDocMock.mockImplementation(SYSTEMIC)
    const code = await runDocFilesGenCli([])
    expect(code).toBe(2)
    expect(generateDocMock).toHaveBeenCalledTimes(3) // abort на 3-му, файли 4-5 не чіпались
  })

  test('permanent → skip, прогін триває, exit 0', async () => {
    scanMock.mockReturnValue(targets(2))
    generateDocMock.mockImplementation(PERMANENT)
    const code = await runDocFilesGenCli([])
    expect(code).toBe(0) // permanent не рахується як помилка
    expect(generateDocMock).toHaveBeenCalledTimes(2) // обидва оброблені, без abort
  })

  test('ok між systemic скидає streak → без abort', async () => {
    scanMock.mockReturnValue(targets(5))
    generateDocMock
      .mockImplementationOnce(SYSTEMIC)
      .mockImplementationOnce(SYSTEMIC)
      .mockImplementationOnce(OK) // скидає streak
      .mockImplementationOnce(SYSTEMIC)
      .mockImplementationOnce(SYSTEMIC)
    const code = await runDocFilesGenCli([])
    expect(code).toBe(1) // були помилки, але без systemic-abort
    expect(generateDocMock).toHaveBeenCalledTimes(5)
  })
})

/**
 * @param {string} sourcePath шлях до джерела.
 * @param {string} docPath шлях до доки.
 * @param {boolean} stale чи ціль застаріла.
 * @returns {{sourcePath: string, docPath: string, stale: boolean}} ціль для selectTargets.
 */
const mk = (sourcePath, docPath, stale) => ({ sourcePath, docPath, stale })

describe('selectTargets — stale + degraded-once guard', () => {
  test('default: stale | degraded-not-cloud-avg → обрано; good | degraded-cloud-avg → пропущено', () => {
    const all = [
      mk('src/stale.js', 'd/stale.md', true),
      mk('src/good.js', 'd/good.md', false),
      mk('src/deg.js', 'd/deg.md', false),
      mk('src/dret.js', 'd/dret.md', false)
    ]
    readDocQualityMock.mockImplementation(p => {
      if (p.includes('good')) return { score: 90, issues: [], judgeModel: null } // ≥ поріг 80
      return { score: 40, issues: [], judgeModel: null } // degraded (score < 80)
    })
    readDocTierMock.mockImplementation(p => (p.includes('dret') ? 'cloud-avg' : null))
    const sel = selectTargets('/root', all, {})
      .map(f => f.sourcePath)
      .toSorted()
    expect(sel).toEqual(['src/deg.js', 'src/stale.js'])
  })

  test('--overwrite → усі цілі незалежно від стану', () => {
    const all = [mk('a.js', 'd/a.md', false), mk('b.js', 'd/b.md', false)]
    expect(selectTargets('/root', all, { overwrite: true })).toHaveLength(2)
  })

  test('foreign (рукописна дока): без --overwrite не ціль, з --overwrite — explicit перезапис', () => {
    readDocQualityMock.mockReturnValue({ score: null, issues: [], judgeModel: null })
    const all = [{ sourcePath: 'npm/index.js', docPath: 'npm/docs/index.md', stale: false, foreign: true }]
    expect(selectTargets('/root', all, {})).toHaveLength(0)
    expect(selectTargets('/root', all, { overwrite: true })).toHaveLength(1)
  })
})

describe("runGenerationBatch — м'який дедлайн (issue #16)", () => {
  beforeEach(() => {
    generateDocMock.mockReset()
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(console, 'log').mockImplementation(() => {
      // навмисний no-op: глушимо console.log у тесті
    })
  })

  test('дедлайн у минулому → перший файл обробляється, решта відкладається, штатний exit 0', async () => {
    generateDocMock.mockImplementation(OK)
    const code = await runGenerationBatch(targets(5), '/fake-root', { deadlineAt: Date.now() - 1 })
    expect(code).toBe(0)
    // Перший файл стартує завжди (гарантія прогресу), далі — стоп до наступного прогону.
    expect(generateDocMock).toHaveBeenCalledTimes(1)
  })

  test('без deadlineAt → увесь беклог, як раніше', async () => {
    generateDocMock.mockImplementation(OK)
    const code = await runGenerationBatch(targets(3), '/fake-root', {})
    expect(code).toBe(0)
    expect(generateDocMock).toHaveBeenCalledTimes(3)
  })

  test('deadlineAt прокидається у generateDoc — дедлайн ріже і файл у процесі', async () => {
    generateDocMock.mockImplementation(OK)
    const deadlineAt = Date.now() + 60_000
    await runGenerationBatch(targets(2), '/fake-root', { deadlineAt })
    expect(generateDocMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ deadlineAt }))
  })
})

describe('nativeBatchAvailable — детекція native-аддону (T8)', () => {
  test('submitBatchImpl резолвиться → true, кешується (той самий impl не викликається вдруге)', async () => {
    const impl = vi.fn(() => Promise.resolve([]))
    expect(await nativeBatchAvailable(impl, false)).toBe(true)
    expect(impl).toHaveBeenCalledWith('min', [])
  })

  test('submitBatchImpl кидає (аддон не зібраний) → false, послідовний фолбек', async () => {
    const impl = vi.fn(() => {
      throw new Error('napi addon not found')
    })
    expect(await nativeBatchAvailable(impl, false)).toBe(false)
  })

  test('useCache=false: кожен виклик перевіряє заново (не залежить від попереднього результату)', async () => {
    const flaky = vi
      .fn()
      .mockImplementationOnce(() => Promise.reject(new Error('boom')))
      .mockImplementationOnce(() => Promise.resolve([]))
    expect(await nativeBatchAvailable(flaky, false)).toBe(false)
    expect(await nativeBatchAvailable(flaky, false)).toBe(true)
  })
})

describe('runGenerationBatch — 2b-batch шлях (T8, native доступний)', () => {
  beforeEach(() => {
    generateDocMock.mockReset()
    prepareBatchItemMock.mockReset()
    finishBatchItemMock.mockReset()
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(console, 'log').mockImplementation(() => {
      // навмисний no-op: глушимо console.log у тесті
    })
  })

  test('N файлів одним submitBatchImpl-викликом (не по одному через generateDoc)', async () => {
    prepareBatchItemMock.mockImplementation(prepOk)
    finishBatchItemMock.mockReturnValue({ md: '# doc\n', score: 90, issues: [], degraded: false, model: 'omlx/x' })
    const submitBatchImpl = vi.fn((model, items) =>
      Promise.resolve(items.map(it => ({ customId: it.customId, ok: `відповідь для ${it.customId}` })))
    )
    const code = await runGenerationBatch(targets(6), '/fake-root', { submitBatchImpl })
    expect(code).toBe(0)
    // Виклик 0 — availability-проба (`nativeBatchAvailable`, порожні items); виклик 1 — реальний submit.
    expect(submitBatchImpl).toHaveBeenCalledTimes(2)
    expect(submitBatchImpl.mock.calls[0][1]).toEqual([])
    expect(submitBatchImpl.mock.calls[1][1]).toHaveLength(6) // один submit на всі 6 файлів
    // T8 бенч (живий прогін проти omlx): без явного localProviders Rust local_cloud не
    // впізнає префікс "omlx/…" і тихо падає крізь cloud-гілку genai (типово вгадує Ollama
    // localhost:11434) — дефолтний конфіг ОБОВʼЯЗКОВО прокидається у submitBatchImpl.
    expect(submitBatchImpl.mock.calls[1][2]).toMatchObject({ localProviders: { omlx: expect.any(Object) } })
    expect(generateDocMock).not.toHaveBeenCalled() // послідовний шлях не зачеплено
  })

  test('помилка ОДНОГО item-у не валить решту batch-у (permanent → skip, err → errors)', async () => {
    prepareBatchItemMock.mockImplementation(prepOk)
    finishBatchItemMock.mockReturnValue({ md: '# doc\n', score: 90, issues: [], degraded: false, model: 'omlx/x' })
    const submitBatchImpl = vi.fn((model, items) =>
      Promise.resolve(
        items.map((it, i) => {
          if (i === 0) return { customId: it.customId, error: 'Prompt too long: занадто великий' }
          if (i === 1) return { customId: it.customId, error: 'omlx api: connection refused' }
          return { customId: it.customId, ok: 'ok' }
        })
      )
    )
    const code = await runGenerationBatch(targets(4), '/fake-root', { submitBatchImpl })
    expect(code).toBe(1) // є не-permanent помилка → exit 1, але не 2 (без circuit-breaker у batch-шляху)
    expect(submitBatchImpl).toHaveBeenCalledTimes(2) // availability-проба + реальний submit
  })

  test('deadlineAt заданий → фолбек на послідовний шлях (batch не викликається)', async () => {
    generateDocMock.mockImplementation(OK)
    const submitBatchImpl = vi.fn()
    const code = await runGenerationBatch(targets(2), '/fake-root', {
      deadlineAt: Date.now() + 60_000,
      submitBatchImpl
    })
    expect(code).toBe(0)
    expect(submitBatchImpl).not.toHaveBeenCalled()
    expect(generateDocMock).toHaveBeenCalledTimes(2)
  })

  test('forceSequential=true → фолбек на послідовний шлях навіть коли submitBatchImpl доступний', async () => {
    generateDocMock.mockImplementation(OK)
    const submitBatchImpl = vi.fn()
    const code = await runGenerationBatch(targets(2), '/fake-root', { forceSequential: true, submitBatchImpl })
    expect(code).toBe(0)
    expect(submitBatchImpl).not.toHaveBeenCalled()
    expect(generateDocMock).toHaveBeenCalledTimes(2)
  })

  test('native-аддон недоступний (submitBatchImpl кидає) → послідовний фолбек, файли все одно оброблені', async () => {
    generateDocMock.mockImplementation(OK)
    const submitBatchImpl = vi.fn(() => {
      throw new Error('napi addon not found: unsupported platform')
    })
    const code = await runGenerationBatch(targets(3), '/fake-root', { submitBatchImpl })
    expect(code).toBe(0)
    // submitBatchImpl викликається лише один раз для availability-проби (з порожніми items)
    expect(submitBatchImpl).toHaveBeenCalledTimes(1)
    expect(submitBatchImpl.mock.calls[0][1]).toEqual([])
    expect(generateDocMock).toHaveBeenCalledTimes(3) // усі 3 файли пройшли послідовним шляхом
  })
})

describe('runDocFilesGenCli — foreign-доки (захист людського змісту)', () => {
  beforeEach(() => {
    generateDocMock.mockReset()
    scanMock.mockReset()
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(console, 'log').mockImplementation(() => {
      // навмисний no-op: глушимо console.log у тесті
    })
  })

  test('docPath існує без docgen-frontmatter → skip із попередженням, генерація не викликається', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
      // навмисний no-op: глушимо console.warn у тесті
    })
    scanMock.mockReturnValue([
      { sourcePath: 'npm/index.js', docPath: 'npm/docs/index.md', stale: false, foreign: true }
    ])
    const code = await runDocFilesGenCli([])
    expect(code).toBe(0)
    expect(generateDocMock).not.toHaveBeenCalled()
    expect(warnSpy.mock.calls.flat().join('\n')).toContain('npm/docs/index.md')
  })
})

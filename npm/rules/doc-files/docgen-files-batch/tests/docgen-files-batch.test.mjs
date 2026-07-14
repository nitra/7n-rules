/**
 * Тести оркестратора docgen-files-batch: класифікація збоїв у циклі —
 *   - systemic ×K підряд → негайний abort (exit 2), решта файлів не чіпається;
 *   - permanent → skip (не «помилка»), прогін триває, exit 0;
 *   - ok між systemic скидає streak → без abort.
 *
 * generateDoc / scan / health / fs / crc мокаються; класифікатор — справжній.
 */
import { describe, expect, test, vi, beforeEach } from 'vitest'

const { generateDocMock, scanMock, readDocQualityMock, readDocTierMock } = vi.hoisted(() => ({
  generateDocMock: vi.fn(),
  scanMock: vi.fn(),
  readDocQualityMock: vi.fn(() => ({ score: null, issues: [], judgeModel: null })),
  readDocTierMock: vi.fn(() => null)
}))

vi.mock('../../docgen-gen/main.mjs', () => ({ generateDoc: generateDocMock, DEFAULT_LOCAL_MODEL: 'omlx/test-model' }))
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

const { runDocFilesGenCli, runGenerationBatch, selectTargets } = await import('../main.mjs')

/**
 * @param {number} n кількість stale-цілей.
 * @returns {Array<{sourcePath: string, docPath: string, stale: boolean}>} масив stale-цілей.
 */
const targets = n =>
  Array.from({ length: n }, (_, i) => ({ sourcePath: `src/f${i}.js`, docPath: `src/docs/f${i}.md`, stale: true }))

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

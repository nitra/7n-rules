/**
 * Тести оркестратора docgen-files-batch: класифікація збоїв у циклі —
 *   - systemic ×K підряд → негайний abort (exit 2), решта файлів не чіпається;
 *   - permanent → skip (не «помилка»), прогін триває, exit 0;
 *   - ok між systemic скидає streak → без abort.
 *
 * generateDoc / scan / health / fs / crc мокаються; класифікатор — справжній.
 */
import { describe, expect, test, vi, beforeEach } from 'vitest'

const { generateDocMock, scanMock, readDocQualityMock } = vi.hoisted(() => ({
  generateDocMock: vi.fn(),
  scanMock: vi.fn(),
  readDocQualityMock: vi.fn(() => ({ score: null, issues: [], retried: false, judgeModel: null }))
}))

vi.mock('../docgen-gen.mjs', () => ({ generateDoc: generateDocMock, DEFAULT_LOCAL_MODEL: 'omlx/test-model' }))
vi.mock('../docgen-scan.mjs', () => ({
  resolveRoot: () => '/fake-root',
  scanForDocFiles: scanMock,
  scanOrphanedDocs: () => [] // у batch-тестах orphan-перевірка незначима
}))
vi.mock('../docgen-crc.mjs', () => ({
  crc32: () => 'crc',
  stampDoc: md => md,
  readDocQuality: readDocQualityMock,
  readDocModel: () => null,
  QUALITY_THRESHOLD: 80
}))
vi.mock('../../../../lib/llm.mjs', async importOriginal => ({
  ...(await importOriginal()),
  preflightLocalModel: () => null // preflight завжди проходить — тестуємо circuit-breaker, не health-check
}))
vi.mock('node:fs', () => ({
  readFileSync: () => Buffer.from('x'),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  existsSync: () => false,
  statSync: () => ({ size: 100 })
}))

const { runDocFilesGenCli, selectTargets } = await import('../docgen-files-batch.mjs')

/** @param {number} n кількість stale-цілей */
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
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
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

describe('selectTargets — stale + degraded-once guard', () => {
  const mk = (sourcePath, docPath, stale) => ({ sourcePath, docPath, stale })

  test('default: stale | degraded-not-retried → обрано; good | degraded-retried → пропущено', () => {
    const all = [
      mk('src/stale.js', 'd/stale.md', true),
      mk('src/good.js', 'd/good.md', false),
      mk('src/deg.js', 'd/deg.md', false),
      mk('src/dret.js', 'd/dret.md', false)
    ]
    readDocQualityMock.mockImplementation(p => {
      if (p.includes('good')) return { score: 90, issues: [], retried: false, judgeModel: null } // ≥ поріг 80
      // degraded (score < 80); `dret` — уже доретраяний (retried:true), решта — ще ні
      return { score: 40, issues: [], retried: p.includes('dret'), judgeModel: null }
    })
    const sel = selectTargets('/root', all, {})
      .map(f => f.sourcePath)
      .toSorted()
    expect(sel).toEqual(['src/deg.js', 'src/stale.js'])
  })

  test('--overwrite → усі цілі незалежно від стану', () => {
    const all = [mk('a.js', 'd/a.md', false), mk('b.js', 'd/b.md', false)]
    expect(selectTargets('/root', all, { overwrite: true })).toHaveLength(2)
  })
})

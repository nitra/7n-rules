/**
 * Тести оркестратора docgen-files-batch: класифікація збоїв у циклі —
 *   - systemic ×K підряд → негайний abort (exit 2), решта файлів не чіпається;
 *   - permanent → skip (не «помилка»), прогін триває, exit 0;
 *   - ok між systemic скидає streak → без abort.
 *
 * generateDoc / scan / health / fs / crc мокаються; класифікатор — справжній.
 */
import { describe, expect, test, vi, beforeEach } from 'vitest'

const { generateDocMock, scanMock, healthMock } = vi.hoisted(() => ({
  generateDocMock: vi.fn(),
  scanMock: vi.fn(),
  healthMock: vi.fn(() => ({ ok: true, reason: null, detail: '' }))
}))

vi.mock('../docgen-gen.mjs', () => ({ generateDoc: generateDocMock, DEFAULT_LOCAL_MODEL: 'omlx/test-model' }))
vi.mock('../docgen-scan.mjs', () => ({ resolveRoot: () => '/fake-root', scanForDocFiles: scanMock }))
vi.mock('../docgen-crc.mjs', () => ({
  crc32: () => 'crc',
  stampDoc: md => md,
  readDocQuality: () => ({ score: null, issues: [] }),
  readDocModel: () => null,
  QUALITY_THRESHOLD: 80
}))
vi.mock('../../../../lib/llm.mjs', async importOriginal => ({
  ...(await importOriginal()),
  omlxHealthCheck: healthMock
}))
vi.mock('node:fs', () => ({
  readFileSync: () => Buffer.from('x'),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  existsSync: () => false,
  statSync: () => ({ size: 100 })
}))

const { runDocFilesGenCli } = await import('../docgen-files-batch.mjs')

/** @param {number} n кількість stale-цілей */
const targets = n => Array.from({ length: n }, (_, i) => ({ sourcePath: `src/f${i}.js`, docPath: `src/docs/f${i}.md`, stale: true }))

const SYSTEMIC = () => {
  throw new Error('omlx api: ... memory ceiling 11.84GB')
}
const PERMANENT = () => {
  throw new Error('omlx api: Prompt too long: 9177917 tokens exceeds max context window')
}
const OK = () => ({ md: '## Огляд\n', score: 90, degraded: false, issues: [], model: 'omlx/test-model', ms: 1, llmMs: 1, llmCalls: 1 })

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

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const resolveModelMock = vi.fn()
const resolveCmdMock = vi.fn()
const spawnAsyncMock = vi.fn()

vi.mock('@7n/llm-lib/model-tiers', () => ({
  resolveModel: resolveModelMock
}))
vi.mock('../../../../scripts/utils/resolve-cmd.mjs', () => ({
  resolveCmd: resolveCmdMock
}))
vi.mock('../../../../scripts/utils/spawn-async.mjs', () => ({
  spawnAsync: spawnAsyncMock
}))

const { classifyPrompt, detectCspell, fixModel, lint, parseClassify, runCspellText } = await import('../main.mjs')

describe('cspell-fix unit policy', () => {
  beforeEach(() => {
    resolveModelMock.mockReset()
    resolveCmdMock.mockReset()
    spawnAsyncMock.mockReset()
    resolveCmdMock.mockReturnValue('/mock/npx')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('fixModel делегує universal resolver від local-min selector', () => {
    resolveModelMock.mockReturnValue('openai/cloud-fallback')
    expect(fixModel()).toBe('openai/cloud-fallback')
    expect(resolveModelMock).toHaveBeenCalledWith('min')
  })

  test('classifyPrompt містить усі слова й bounded JSON contract', () => {
    const prompt = classifyPrompt(['omlx', 'аддон'])
    expect(prompt).toContain('Return ONLY a JSON array')
    expect(prompt).toContain('- omlx')
    expect(prompt).toContain('- аддон')
  })

  test.each([
    ['prefix [{"w":"omlx","verdict":"valid","fix":null}] suffix', [{ w: 'omlx', verdict: 'valid', fix: null }]],
    ['{"w":"not-an-array"}', null],
    ['без JSON', null],
    ['[invalid]', null]
  ])('parseClassify безпечно парсить bounded array: %s', (text, expected) => {
    expect(parseClassify(text)).toEqual(expected)
  })

  test('detectCspell формує quiet/verbose args і нормалізує відсутній exitCode', async () => {
    spawnAsyncMock
      .mockResolvedValueOnce({ stdout: 'out', stderr: 'err', exitCode: undefined })
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })

    await expect(detectCspell('/repo', '/mock/npx', ['a.md'])).resolves.toEqual({
      code: 1,
      out: ['out', 'err'].join('')
    })
    await detectCspell('/repo', '/mock/npx', undefined, true)

    expect(spawnAsyncMock.mock.calls[0][1]).toEqual(['cspell', '--no-progress', 'a.md'])
    expect(spawnAsyncMock.mock.calls[1][1]).toEqual(['cspell', '.'])
  })

  test('detectCspell трактує Files checked: 0 як чистий результат', async () => {
    spawnAsyncMock.mockResolvedValue({
      stdout: 'CSpell: Files checked: 0, Issues found: 0 in 0 files.',
      stderr: '',
      exitCode: 1
    })
    await expect(detectCspell('/repo', '/mock/npx', ['ignored.md'])).resolves.toEqual({
      code: 0,
      out: 'CSpell: Files checked: 0, Issues found: 0 in 0 files.'
    })
  })

  test('runCspellText fail-closed без npx', async () => {
    resolveCmdMock.mockReturnValue(null)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    await expect(runCspellText(['a.md'], '/repo')).resolves.toBe(1)
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('npx не знайдено'))
    expect(spawnAsyncMock).not.toHaveBeenCalled()
  })

  test('runCspellText повертає clean і сигналить підозрілий zero-file scope', async () => {
    spawnAsyncMock.mockResolvedValue({
      stdout: 'CSpell: Files checked: 0, Issues found: 0 in 0 files.',
      stderr: '',
      exitCode: 1
    })
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    await expect(runCspellText(['ignored.md'], '/repo')).resolves.toBe(0)
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('0 із 1 переданих файлів'))
  })

  test('runCspellText друкує findings і повертає cspell exit code', async () => {
    spawnAsyncMock.mockResolvedValue({ stdout: 'Unknown word (teh)', stderr: '', exitCode: 2 })
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await expect(runCspellText(['a.md'], '/repo')).resolves.toBe(2)
    expect(stdout).toHaveBeenCalledWith('Unknown word (teh)')
  })

  test('lint не запускає cspell для порожньої delta', async () => {
    await expect(lint({ concernId: 'text/cspell-fix', cwd: '/repo', files: [] })).resolves.toEqual({
      violations: []
    })
    expect(spawnAsyncMock).not.toHaveBeenCalled()
  })

  test('lint повертає violation для ненульового cspell exit code', async () => {
    spawnAsyncMock.mockResolvedValue({ stdout: 'Unknown word (teh)', stderr: '', exitCode: 1 })
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    const result = await lint({
      concernId: 'text/cspell-fix',
      cwd: '/repo',
      files: ['a.md'],
      verbose: false
    })

    expect(result.violations).toEqual([
      {
        reason: 'cspell',
        message: 'cspell знайшов порушення правопису (text.mdc)'
      }
    ])
  })
})

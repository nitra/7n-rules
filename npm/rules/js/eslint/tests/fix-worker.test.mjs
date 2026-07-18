/**
 * Тести `fix-worker.mjs` (js/eslint): цикл по файлах у межах дедлайну, окрема
 * `runAgentFix`-сесія на файл, дедлайн ріже цикл, один невдалий файл не обриває решту.
 * `runAgentFix`/`isLocalModel`/`extractContext`/`lint` — усі мокані, реальних LLM-викликів
 * і реального ESLint-прогону нема.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const runAgentFixMock = vi.fn()
const lintMock = vi.fn()

vi.mock('@7n/llm-lib/agent-fix', () => ({ runAgentFix: runAgentFixMock }))
vi.mock('@7n/llm-lib/model-tiers', () => ({ isLocalModel: () => false }))
vi.mock('../../../scripts/utils/ast-extract.mjs', () => ({ extractContext: () => ({}) }))
vi.mock('../main.mjs', () => ({ lint: lintMock }))

const { fixWorker } = await import('../fix-worker.mjs')

/**
 * @param {string} file posix-relative шлях
 * @param {string} reason machine-code причини
 * @returns {object} мінімальний LintViolation
 */
function v(file, reason) {
  return { ruleId: 'js', concernId: 'eslint', reason, message: 'm', file }
}

describe('js/eslint fixWorker', () => {
  beforeEach(() => {
    runAgentFixMock.mockReset()
    lintMock.mockReset()
    lintMock.mockResolvedValue({ violations: [] })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('без violations.file → touchedFiles: [], runAgentFix не викликається', async () => {
    const res = await fixWorker([{ ruleId: 'js', concernId: 'eslint', reason: 'x', message: 'm' }], {
      cwd: '/repo',
      ruleId: 'js',
      concernId: 'eslint',
      tier: 'cloud-min',
      model: 'openai-codex/gpt-5.4-mini',
      timeoutMs: 120_000,
      recordWrite: vi.fn()
    })
    expect(res).toEqual({ touchedFiles: [] })
    expect(runAgentFixMock).not.toHaveBeenCalled()
  })

  test('два файли, обидва успішні → runAgentFix викликається по разу на файл, targetFiles/caller коректні, touchedFiles з обох', async () => {
    runAgentFixMock
      .mockResolvedValueOnce({ applied: true, touchedFiles: ['/repo/a.js'], error: null })
      .mockResolvedValueOnce({ applied: true, touchedFiles: ['/repo/b.js'], error: null })

    const res = await fixWorker([v('a.js', 'r1'), v('a.js', 'r2'), v('b.js', 'r3')], {
      cwd: '/repo',
      ruleId: 'js',
      concernId: 'eslint',
      tier: 'cloud-min',
      model: 'openai-codex/gpt-5.4-mini',
      timeoutMs: 120_000,
      recordWrite: vi.fn()
    })

    expect(res.touchedFiles).toEqual(['/repo/a.js', '/repo/b.js'])
    expect(runAgentFixMock).toHaveBeenCalledTimes(2)
    expect(runAgentFixMock.mock.calls[0][2]).toBe('/repo')
    expect(runAgentFixMock.mock.calls[0][3].targetFiles).toEqual(['a.js'])
    expect(runAgentFixMock.mock.calls[0][3].caller).toBe('fix:js/eslint:cloud-min:a.js')
    expect(runAgentFixMock.mock.calls[1][3].targetFiles).toEqual(['b.js'])
  })

  test("перший файл з'їдає весь дедлайн → другий файл не обробляється", async () => {
    const nowSpy = vi.spyOn(Date, 'now')
    let elapsed = 0
    nowSpy.mockImplementation(() => 1_000_000 + elapsed)
    runAgentFixMock.mockImplementationOnce(() => {
      elapsed = 100_000 // "з'їдає" 100с із дедлайну (0.8 * 120000 = 96000мс)
      return { applied: true, touchedFiles: ['/repo/a.js'], error: null }
    })

    const res = await fixWorker([v('a.js', 'r1'), v('b.js', 'r2')], {
      cwd: '/repo',
      ruleId: 'js',
      concernId: 'eslint',
      tier: 'cloud-min',
      model: 'openai-codex/gpt-5.4-mini',
      timeoutMs: 120_000,
      recordWrite: vi.fn()
    })

    expect(runAgentFixMock).toHaveBeenCalledTimes(1)
    expect(res.touchedFiles).toEqual(['/repo/a.js'])
    nowSpy.mockRestore()
  })

  test('один файл повертає error → пропускається, цикл продовжується на решту файлів', async () => {
    runAgentFixMock
      .mockResolvedValueOnce({ applied: false, touchedFiles: [], error: 'fix timeout 45000ms' })
      .mockResolvedValueOnce({ applied: true, touchedFiles: ['/repo/b.js'], error: null })

    const res = await fixWorker([v('a.js', 'r1'), v('b.js', 'r2')], {
      cwd: '/repo',
      ruleId: 'js',
      concernId: 'eslint',
      tier: 'cloud-min',
      model: 'openai-codex/gpt-5.4-mini',
      timeoutMs: 120_000,
      recordWrite: vi.fn()
    })

    expect(runAgentFixMock).toHaveBeenCalledTimes(2)
    expect(res.touchedFiles).toEqual(['/repo/b.js'])
  })

  test('verify-опція викликає item-scoped lint() і повертає ok/output', async () => {
    lintMock.mockResolvedValue({ violations: [] })
    runAgentFixMock.mockImplementationOnce(async (ruleId, violationText, cwd, opts) => {
      const verdict = await opts.verify()
      expect(verdict).toEqual({ ok: true, output: '' })
      expect(lintMock).toHaveBeenCalledWith({ cwd: '/repo', ruleId: 'js', concernId: 'eslint', files: ['a.js'] })
      return { applied: true, touchedFiles: ['/repo/a.js'], error: null }
    })

    await fixWorker([v('a.js', 'r1')], {
      cwd: '/repo',
      ruleId: 'js',
      concernId: 'eslint',
      tier: 'cloud-min',
      model: 'openai-codex/gpt-5.4-mini',
      timeoutMs: 120_000,
      recordWrite: vi.fn()
    })
  })
})

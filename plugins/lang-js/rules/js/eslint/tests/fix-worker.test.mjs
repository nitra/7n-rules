/**
 * Тести `fix-worker.mjs` (js/eslint): обмежений пул паралельних `runAgentFix`-сесій
 * (не більше MAX_PARALLEL_FILES=4 одночасно), дедлайн гейтить лише старт НОВОГО файлу
 * з черги (не зупиняє вже запущені), один невдалий/винятковий файл не обриває решту пулу.
 * `runAgentFix`/`isLocalModel`/`extractContext`/`lint` — усі мокані, реальних LLM-викликів
 * і реального ESLint-прогону нема.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const runAgentFixMock = vi.fn()
const lintMock = vi.fn()

vi.mock('@7n/llm-lib/agent-fix', () => ({ runAgentFix: runAgentFixMock }))
vi.mock('@7n/llm-lib/model-tiers', () => ({ isLocalModel: () => false }))
vi.mock('@7n/rules/scripts/utils/ast-extract.mjs', () => ({ extractContext: () => ({}) }))
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

  test('два файли — обидва стартують одразу (пул ≥ 2), "повільний" перший не блокує другий', async () => {
    const nowSpy = vi.spyOn(Date, 'now')
    let elapsed = 0
    nowSpy.mockImplementation(() => 1_000_000 + elapsed)
    // await-крок ДО побічного ефекту — імітує реальний runAgentFix (мережевий I/O), що
    // звільняє event loop одразу на вході, а не виконує все синхронно перед першим await.
    // Без цього кроку mock мутував би elapsed раніше, ніж другий runner встигне
    // дедлайн-перевіркою пройти свій старт — артефакт тесту, не поведінка реального коду.
    runAgentFixMock.mockImplementation(async () => {
      await Promise.resolve()
      elapsed = 100_000 // "займає" 100с — за старою послідовною семантикою з'їло б увесь дедлайн
      return { applied: true, touchedFiles: [], error: null }
    })

    await fixWorker([v('a.js', 'r1'), v('b.js', 'r2')], {
      cwd: '/repo',
      ruleId: 'js',
      concernId: 'eslint',
      tier: 'cloud-min',
      model: 'openai-codex/gpt-5.4-mini',
      timeoutMs: 120_000,
      recordWrite: vi.fn()
    })

    // Обидва файли встигають дістатись до виклику runAgentFix ДО того, як elapsed зміниться —
    // дедлайн-перевірка для другого файлу відбувається синхронно на старті пулу, не після
    // завершення першого.
    expect(runAgentFixMock).toHaveBeenCalledTimes(2)
    nowSpy.mockRestore()
  })

  test('черга з > MAX_PARALLEL_FILES: файл поза першою хвилею не стартує, якщо дедлайн уже настав', async () => {
    const nowSpy = vi.spyOn(Date, 'now')
    let elapsed = 0
    nowSpy.mockImplementation(() => 1_000_000 + elapsed)
    // Перші 4 виклики (перша хвиля) — миттєво успішні, крім одного, що "з'їдає" дедлайн.
    // await-крок ДО побічного ефекту — див. коментар у попередньому тесті (імітація
    // реального асинхронного I/O, щоб інші runner-и встигли дедлайн-перевіркою пройти старт).
    runAgentFixMock
      .mockImplementationOnce(async () => {
        await Promise.resolve()
        elapsed = 100_000 // з'їдає дедлайн (0.8 * 120000 = 96000мс) — до звільнення слоту
        return { applied: true, touchedFiles: [], error: null }
      })
      .mockResolvedValueOnce({ applied: true, touchedFiles: [], error: null })
      .mockResolvedValueOnce({ applied: true, touchedFiles: [], error: null })
      .mockResolvedValueOnce({ applied: true, touchedFiles: [], error: null })

    await fixWorker([v('a.js', 'r1'), v('b.js', 'r2'), v('c.js', 'r3'), v('d.js', 'r4'), v('e.js', 'r5')], {
      cwd: '/repo',
      ruleId: 'js',
      concernId: 'eslint',
      tier: 'cloud-min',
      model: 'openai-codex/gpt-5.4-mini',
      timeoutMs: 120_000,
      recordWrite: vi.fn()
    })

    // 5 файлів, пул=4 — перша хвиля (a-d) стартує вся; п'ятий (e.js) чекає слот, і коли
    // той звільняється (після "повільного" a.js), дедлайн уже вичерпано — e.js не стартує.
    expect(runAgentFixMock).toHaveBeenCalledTimes(4)
    nowSpy.mockRestore()
  })

  test('файл, що кидає виняток (не структурований error) — не валить решту пулу', async () => {
    runAgentFixMock
      .mockRejectedValueOnce(new Error('unexpected crash'))
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

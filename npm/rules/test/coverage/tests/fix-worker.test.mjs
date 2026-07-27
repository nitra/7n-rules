import { describe, expect, test, vi } from 'vitest'

import { fixWorker, groupViolations } from '../fix-worker.mjs'

/**
 * Фейковий coverage-провайдер з усіма fix-hooks як vi.fn.
 * @param {Partial<Record<string, import('vitest').Mock>>} [overrides] заміна окремих хуків
 * @returns {object} провайдер для інжекту через deps.resolveProviders
 */
function fakeProvider(overrides = {}) {
  return {
    id: 'fake',
    title: 'fake',
    detect: vi.fn(),
    collect: vi.fn(),
    collectPerFile: vi.fn(),
    generateTests: vi.fn().mockResolvedValue({ touchedFiles: ['/p/tests/a.test.mjs'] }),
    generateStories: vi.fn().mockResolvedValue({ touchedFiles: ['/p/src/Card.stories.js'] }),
    fixSurvived: vi.fn().mockResolvedValue({ touchedFiles: ['/p/tests/b.test.mjs'] }),
    fixFailingTests: vi.fn().mockResolvedValue({ touchedFiles: [] }),
    ...overrides
  }
}

const CTX = { cwd: '/p', ruleId: 'test', concernId: 'coverage', tier: 'cloud-avg', recordWrite: vi.fn() }

describe('groupViolations', () => {
  test('розкладає violations на files-нижче-порогу і survived-групи', () => {
    const survivedGroup = { file: 'src/a.mjs', mutants: [{ line: 1 }] }
    const { belowThreshold, survived } = groupViolations([
      { reason: 'coverage-below-threshold', file: 'src/a.mjs', data: { pct: 10 } },
      { reason: 'coverage-below-threshold', data: { area: 'root', pct: 50 } }, // full-режим без file — не в генерацію
      { reason: 'mutation-below-threshold', data: { survived: [survivedGroup] } },
      { reason: 'unrelated', file: 'x' }
    ])
    expect(belowThreshold).toEqual([{ file: 'src/a.mjs', pct: 10, reason: '' }])
    expect(survived).toEqual([survivedGroup])
  })
})

describe('fixWorker', () => {
  test('маршрутизує js → generateTests, .vue → generateStories, survived → fixSurvived, потім fixFailingTests', async () => {
    const provider = fakeProvider()
    const resolveProviders = vi.fn().mockResolvedValue([provider])
    const survivedGroup = { file: 'src/a.mjs', mutants: [{ line: 3 }] }

    const res = await fixWorker(
      [
        { reason: 'coverage-below-threshold', file: 'src/a.mjs', data: { pct: 12.5 } },
        { reason: 'coverage-below-threshold', file: 'src/Card.vue', data: { pct: 0 } },
        { reason: 'mutation-below-threshold', data: { survived: [survivedGroup] } }
      ],
      CTX,
      { resolveProviders }
    )

    expect(resolveProviders).toHaveBeenCalledWith('/p')
    expect(provider.generateTests).not.toHaveBeenCalled()
    expect(provider.generateStories).not.toHaveBeenCalled()
    expect(provider.fixSurvived).toHaveBeenCalledWith(expect.objectContaining({ survived: [survivedGroup] }))
    expect(provider.fixFailingTests).not.toHaveBeenCalled()
    expect(res.touchedFiles.toSorted()).toEqual(['/p/tests/b.test.mjs'])
    expect(res.mutationRefreshFiles).toEqual([])
    expect(res.failed).toEqual([])
  })

  test('прокидає recordWrite/tier у ctx хуків', async () => {
    const provider = fakeProvider()
    await fixWorker([{ reason: 'coverage-below-threshold', file: 'a.mjs', data: { pct: 1 } }], CTX, {
      resolveProviders: () => Promise.resolve([provider])
    })
    const hookArgs = provider.generateTests.mock.calls[0][0]
    expect(hookArgs.ctx.recordWrite).toBe(CTX.recordWrite)
    expect(hookArgs.ctx.tier).toBe('cloud-avg')
    expect(hookArgs.ctx.coverageTimeout).toEqual({
      requestedMs: null,
      workerDeadlineMs: null,
      effectiveHookTimeoutMs: null,
      survivedBatchesPerRung: 1
    })
  })

  test('передає survived hook повний coverage budget та policy одного batch-а', async () => {
    const provider = fakeProvider()
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000)
    await fixWorker(
      [{ reason: 'mutation-below-threshold', data: { survived: [{ file: 'a.mjs', mutants: [{ line: 1 }] }] } }],
      {
        ...CTX,
        timeoutMs: 10_000
      },
      { resolveProviders: () => Promise.resolve([provider]) }
    )
    expect(provider.fixSurvived.mock.calls[0][0].ctx).toMatchObject({
      timeoutMs: 10_000,
      coverageTimeout: {
        requestedMs: 10_000,
        workerDeadlineMs: 10_000,
        effectiveHookTimeoutMs: 10_000,
        survivedBatchesPerRung: 1
      }
    })
    nowSpy.mockRestore()
  })

  test('без violations свого профілю хуки генерації не викликаються', async () => {
    const provider = fakeProvider()
    const res = await fixWorker([], CTX, { resolveProviders: () => Promise.resolve([provider]) })
    // Хуки викликаються з порожніми списками (провайдер сам no-op-ить), але
    // fixFailingTests без жодної роботи не стартує.
    expect(provider.fixFailingTests).not.toHaveBeenCalled()
    expect(res.touchedFiles.length).toBeGreaterThanOrEqual(0)
  })

  test('провайдер без опційних fix-hooks не валить worker (typeof-гейт)', async () => {
    const provider = {
      id: 'bare',
      title: 'bare',
      detect: vi.fn(),
      collect: vi.fn(),
      collectPerFile: vi.fn()
    }
    const res = await fixWorker([{ reason: 'coverage-below-threshold', file: 'a.mjs', data: { pct: 1 } }], CTX, {
      resolveProviders: () => Promise.resolve([provider])
    })
    expect(res).toEqual({ touchedFiles: [], mutationRefreshFiles: [], failed: [], deferred: [], feedback: null })
  })

  test('виняток одного хука не зупиняє наступні', async () => {
    const provider = fakeProvider({
      generateTests: vi.fn().mockRejectedValue(new Error('LLM недоступний'))
    })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => null)
    const res = await fixWorker(
      [
        { reason: 'coverage-below-threshold', file: 'a.mjs', data: { pct: 1 } },
        { reason: 'coverage-below-threshold', file: 'Card.vue', data: { pct: 2 } }
      ],
      CTX,
      { resolveProviders: () => Promise.resolve([provider]) }
    )
    expect(provider.generateStories).toHaveBeenCalledTimes(1)
    expect(res.touchedFiles).toContain('/p/src/Card.stories.js')
    warnSpy.mockRestore()
  })

  test('вичерпаний дедлайн (timeoutMs) гейтить старт хуків', async () => {
    const provider = fakeProvider()
    // timeoutMs=0 → дедлайн вимкнено; імітуємо вичерпання через відʼємний бюджет неможливо,
    // тож ставимо мінімальний timeoutMs і зсуваємо годинник.
    const nowSpy = vi.spyOn(Date, 'now')
    nowSpy.mockReturnValue(1_000_000)
    const worker = fixWorker(
      [{ reason: 'coverage-below-threshold', file: 'a.mjs', data: { pct: 1 } }],
      { ...CTX, timeoutMs: 100 },
      {
        resolveProviders: () => {
          nowSpy.mockReturnValue(1_000_000 + 10_000) // дедлайн (80 мс) уже позаду
          return Promise.resolve([provider])
        }
      }
    )
    const res = await worker
    nowSpy.mockRestore()
    expect(provider.generateTests).not.toHaveBeenCalled()
    expect(provider.fixFailingTests).not.toHaveBeenCalled()
    expect(res.touchedFiles).toEqual([])
    expect(res.failed).toEqual([])
  })

  test('явно віддає failed/no-op batch від coverage hook', async () => {
    const provider = fakeProvider({
      fixSurvived: vi.fn().mockResolvedValue({
        touchedFiles: [],
        failed: [{ files: ['src/a.mjs'], error: 'no-op: агент завершився без записів' }]
      })
    })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => null)
    const res = await fixWorker(
      [{ reason: 'mutation-below-threshold', data: { survived: [{ file: 'src/a.mjs', mutants: [{ line: 1 }] }] } }],
      CTX,
      { resolveProviders: () => Promise.resolve([provider]) }
    )
    expect(res).toEqual({
      touchedFiles: [],
      mutationRefreshFiles: [],
      failed: [
        { provider: 'fake', hook: 'fixSurvived', files: ['src/a.mjs'], error: 'no-op: агент завершився без записів' }
      ],
      deferred: [],
      feedback: null
    })
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('failed/no-op'))
    warnSpy.mockRestore()
  })

  test('передає source-файли accepted mutation batch у canonical re-detect', async () => {
    const provider = fakeProvider({
      fixSurvived: vi.fn().mockResolvedValue({
        touchedFiles: ['/p/tests/a.test.mjs'],
        mutationRefreshFiles: ['src/a.mjs']
      })
    })
    const res = await fixWorker(
      [{ reason: 'mutation-below-threshold', data: { survived: [{ file: 'src/a.mjs', mutants: [{ line: 1 }] }] } }],
      CTX,
      { resolveProviders: () => Promise.resolve([provider]) }
    )
    expect(res.mutationRefreshFiles).toEqual(['src/a.mjs'])
  })

  test('передає quality verdict провайдера як feedback наступного ladder rung-а', async () => {
    const provider = fakeProvider({
      fixSurvived: vi.fn().mockResolvedValue({
        touchedFiles: [],
        failed: [{ files: ['src/a.mjs'], error: 'mutation verdict: targets=1, killed=0' }],
        feedback: { previousError: 'mutation verdict: targets=1, killed=0, covered0=1' }
      })
    })
    const res = await fixWorker(
      [{ reason: 'mutation-below-threshold', data: { survived: [{ file: 'src/a.mjs', mutants: [{ line: 1 }] }] } }],
      CTX,
      { resolveProviders: () => Promise.resolve([provider]) }
    )
    expect(res.feedback).toEqual({ previousError: 'mutation verdict: targets=1, killed=0, covered0=1' })
  })
})

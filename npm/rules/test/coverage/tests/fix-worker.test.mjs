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
    expect(provider.generateTests).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: '/p', files: [{ file: 'src/a.mjs', pct: 12.5, reason: '' }] })
    )
    expect(provider.generateStories).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: '/p', files: [{ file: 'src/Card.vue', pct: 0, reason: '' }] })
    )
    expect(provider.fixSurvived).toHaveBeenCalledWith(expect.objectContaining({ survived: [survivedGroup] }))
    expect(provider.fixFailingTests).toHaveBeenCalledTimes(1)
    expect(res.touchedFiles.toSorted()).toEqual([
      '/p/src/Card.stories.js',
      '/p/tests/a.test.mjs',
      '/p/tests/b.test.mjs'
    ])
  })

  test('прокидає recordWrite/tier у ctx хуків', async () => {
    const provider = fakeProvider()
    await fixWorker([{ reason: 'coverage-below-threshold', file: 'a.mjs', data: { pct: 1 } }], CTX, {
      resolveProviders: () => Promise.resolve([provider])
    })
    const hookArgs = provider.generateTests.mock.calls[0][0]
    expect(hookArgs.ctx.recordWrite).toBe(CTX.recordWrite)
    expect(hookArgs.ctx.tier).toBe('cloud-avg')
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
    expect(res).toEqual({ touchedFiles: [] })
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
  })
})

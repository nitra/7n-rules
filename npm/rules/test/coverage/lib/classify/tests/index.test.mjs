import { vi, describe, it, expect, beforeEach } from 'vitest'
import { classify } from '../index.mjs'
import { deriveCacheKey, readCache } from '../cache.mjs'

vi.mock('../cache.mjs', () => ({
  readCache: vi.fn(),
  writeCache: vi.fn(),
  deriveCacheKey: vi.fn()
}))

const mockCwd = '/mock/root'
const mockSurvived = [
  {
    file: 'src/test.js',
    mutants: [{ file: 'src/test.js', line: 10, col: 1, replacement: 'R1' }],
    exampleTest: null
  }
]

const VALID_VERDICT = JSON.stringify({
  verdict: 'worth-testing',
  confidence: 0.8,
  reason: 'This mutant changes core logic and needs a dedicated test to verify',
  suggestedTest: 'check it'
})

/**
 * Фейковий `submitBatchImpl`: маршрутизує відповідь за customId через
 * передану функцію `responder(customId) => {ok}|{error}|undefined`
 * (undefined — customId відсутній у результаті, як реальний `submitBatch`
 * на невдалий item).
 * @param {(customId: string) => {ok?: string, error?: string}|undefined} responder функція відповіді за customId
 * @returns {(model: string, items: Array<object>) => Promise<Array<object>>} fake submitBatch
 */
function fakeSubmitBatch(responder) {
  return vi.fn((model, items) =>
    Promise.resolve(
      items
        .map(item => {
          const r = responder(item.customId)
          return r ? { customId: item.customId, ...r } : null
        })
        .filter(Boolean)
    )
  )
}

describe('classify', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(deriveCacheKey).mockReturnValue('mock_key')
    vi.mocked(readCache).mockReturnValue({ version: 1, model: 'default+cloud', entries: {} })
  })

  it('should use cached verdict if available', async () => {
    vi.mocked(readCache).mockReturnValue({
      version: 1,
      model: 'x/a+x/b',
      entries: { mock_key: { verdict: 'ok', confidence: 1, reason: 'Cached' } }
    })
    const submitBatchImpl = vi.fn()

    const results = await classify(mockSurvived, mockCwd, { tier1: 'x/a', tier2: 'x/b', submitBatchImpl })

    expect(submitBatchImpl).not.toHaveBeenCalled()
    expect(results[0].verdict.verdict).toBe('ok')
  })

  it('should run tier1 classification for a cache miss in one submitBatch call', async () => {
    const submitBatchImpl = fakeSubmitBatch(() => ({ ok: VALID_VERDICT }))

    const results = await classify(mockSurvived, mockCwd, { tier1: 'x/a', tier2: 'x/b', submitBatchImpl })

    expect(submitBatchImpl).toHaveBeenCalledTimes(1)
    expect(submitBatchImpl.mock.calls[0][0]).toBe('x/a')
    expect(results[0].verdict.verdict).toBe('worth-testing')
  })

  it('N мутантів — один submitBatchImpl-виклик на хвилю, не по одному на мутанта', async () => {
    const survived = [
      {
        file: 'src/test.js',
        mutants: Array.from({ length: 4 }, (_, i) => ({ file: 'src/test.js', line: i, col: 1, replacement: `R${i}` }))
      }
    ]
    const submitBatchImpl = fakeSubmitBatch(() => ({ ok: VALID_VERDICT }))

    const results = await classify(survived, mockCwd, { tier1: 'x/a', tier2: 'x/b', submitBatchImpl })

    expect(submitBatchImpl).toHaveBeenCalledTimes(1)
    expect(submitBatchImpl.mock.calls[0][1]).toHaveLength(4)
    expect(results).toHaveLength(4)
  })

  it('should run tier2 classification on tier1 failure (second wave)', async () => {
    let call = 0
    const submitBatchImpl = vi.fn((model, items) => {
      call++
      if (call === 1) return Promise.resolve(items.map(i => ({ customId: i.customId, error: 'tier1 fail' })))
      return Promise.resolve(items.map(i => ({ customId: i.customId, ok: VALID_VERDICT })))
    })

    const results = await classify(mockSurvived, mockCwd, { tier1: 'x/a', tier2: 'x/b', submitBatchImpl })

    expect(submitBatchImpl).toHaveBeenCalledTimes(2)
    expect(submitBatchImpl.mock.calls[0][0]).toBe('x/a')
    expect(submitBatchImpl.mock.calls[1][0]).toBe('x/b')
    expect(results[0].verdict.verdict).toBe('worth-testing')
    expect(results[0].verdict.confidence).toBe(0.8)
  })

  it('should fallback to conservative verdict if both tiers fail', async () => {
    const submitBatchImpl = fakeSubmitBatch(() => ({ error: 'boom' }))

    const results = await classify(mockSurvived, mockCwd, { tier1: 'x/a', tier2: 'x/b', submitBatchImpl })

    expect(submitBatchImpl).toHaveBeenCalledTimes(2)
    expect(results[0].verdict.verdict).toBe('worth-testing')
    expect(results[0].verdict.confidence).toBe(0)
  })

  it('should fallback when tier1 response is unparsable JSON (no tier2 needed if it too fails)', async () => {
    let call = 0
    const submitBatchImpl = vi.fn((model, items) => {
      call++
      if (call === 1) return Promise.resolve(items.map(i => ({ customId: i.customId, ok: 'not json at all' })))
      return Promise.resolve(items.map(i => ({ customId: i.customId, error: 'still bad' })))
    })

    const results = await classify(mockSurvived, mockCwd, { tier1: 'x/a', tier2: 'x/b', submitBatchImpl })

    expect(submitBatchImpl).toHaveBeenCalledTimes(2)
    expect(results[0].verdict.verdict).toBe('worth-testing')
    expect(results[0].verdict.confidence).toBe(0)
  })

  it('submitBatchImpl сам кидає помилку (напр. невалідний model-spec) — graceful fallback, не throw', async () => {
    const submitBatchImpl = vi.fn(() => Promise.reject(new Error('invalid model spec')))

    const results = await classify(mockSurvived, mockCwd, { tier1: 'x/a', tier2: 'x/b', submitBatchImpl })

    expect(results[0].verdict.verdict).toBe('worth-testing')
    expect(results[0].verdict.confidence).toBe(0)
  })

  it('порожній tier2 — хвилю 2 не викликає (submitBatchImpl лише раз)', async () => {
    const submitBatchImpl = fakeSubmitBatch(() => ({ error: 'tier1 fail' }))

    const results = await classify(mockSurvived, mockCwd, { tier1: 'x/a', tier2: '', submitBatchImpl })

    expect(submitBatchImpl).toHaveBeenCalledTimes(1)
    expect(results[0].verdict.confidence).toBe(0)
  })

  it('порядок повернення відповідає вхідному порядку мутантів, незалежно від порядку в результаті батчу', async () => {
    const survived = [
      {
        file: 'src/test.js',
        mutants: [
          { file: 'src/test.js', line: 1, col: 1, replacement: 'A' },
          { file: 'src/test.js', line: 2, col: 1, replacement: 'B' }
        ]
      }
    ]
    // submitBatch повертає результати у зворотному порядку — реалістично для конкурентного виконання.
    const submitBatchImpl = vi.fn((model, items) =>
      Promise.resolve(items.toReversed().map(i => ({ customId: i.customId, ok: VALID_VERDICT })))
    )

    const results = await classify(survived, mockCwd, { tier1: 'x/a', tier2: 'x/b', submitBatchImpl })

    expect(results.map(r => r.key)).toEqual(['src/test.js:1:1:A', 'src/test.js:2:1:B'])
  })
})

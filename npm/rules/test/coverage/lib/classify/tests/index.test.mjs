import { vi, describe, it, expect, beforeEach } from 'vitest'
import { classify } from '../index.mjs'
import { deriveCacheKey, readCache } from '../cache.mjs'

vi.mock('../cache.mjs', () => ({
  readCache: vi.fn(),
  writeCache: vi.fn(),
  deriveCacheKey: vi.fn()
}))

const fakeChainFactory = () => ({
  nextStep: vi.fn(),
  note: vi.fn(),
  headers: () => ({}),
  traceFields: () => ({}),
  end: vi.fn()
})

describe('classify', () => {
  const mockCwd = '/mock/root'
  const mockSurvived = [
    {
      file: 'src/test.js',
      mutants: [{ file: 'src/test.js', line: 10, col: 1, replacement: 'R1' }],
      exampleTest: null
    }
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('N_LOCAL_MIN_MODEL', '')
    vi.stubEnv('N_CLOUD_MIN_MODEL', '')
    vi.mocked(deriveCacheKey).mockReturnValue('mock_key')
    vi.mocked(readCache).mockReturnValue({ version: 1, model: 'default+cloud', entries: {} })
  })

  it('should use cached verdict if available', async () => {
    vi.mocked(readCache).mockReturnValue({
      version: 1,
      model: 'default+cloud',
      entries: { mock_key: { verdict: 'ok', confidence: 1, reason: 'Cached' } }
    })

    const results = await classify(mockSurvived, mockCwd, { tier1: '', tier2: '', startChain: fakeChainFactory })

    expect(vi.mocked(deriveCacheKey)).toHaveBeenCalled()
    expect(results[0].verdict.verdict).toBe('ok')
  })

  it('should run Tier 1 classification if cache misses', async () => {
    const validVerdict = JSON.stringify({
      verdict: 'worth-testing',
      confidence: 0.8,
      reason: 'This mutant changes core logic and needs a dedicated test to verify',
      suggestedTest: 'check it'
    })
    const mockCallModel = vi.fn().mockResolvedValue(validVerdict)

    await classify(mockSurvived, mockCwd, {
      callModel: mockCallModel,
      tier1: '',
      tier2: '',
      startChain: fakeChainFactory
    })

    expect(mockCallModel).toHaveBeenCalledWith(expect.any(String), '', mockCwd, { chain: expect.anything() })
    expect(mockCallModel).toHaveBeenCalledTimes(1)
  })

  it('should run Tier 2 classification on Tier 1 failure', async () => {
    const validVerdict = JSON.stringify({
      verdict: 'equivalent',
      confidence: 0.9,
      reason: 'This mutant is semantically equivalent to the original code'
    })
    const mockCallModel = vi.fn().mockRejectedValueOnce(new Error('Tier 1 Fail')).mockResolvedValueOnce(validVerdict)

    await classify(mockSurvived, mockCwd, {
      callModel: mockCallModel,
      tier1: '',
      tier2: '',
      startChain: fakeChainFactory
    })

    expect(mockCallModel).toHaveBeenCalledTimes(2)
    expect(mockCallModel).toHaveBeenNthCalledWith(1, expect.any(String), '', mockCwd, { chain: expect.anything() })
    expect(mockCallModel).toHaveBeenNthCalledWith(2, expect.any(String), '', mockCwd, { chain: expect.anything() })
  })

  it('should fallback to conservative verdict if both tiers fail', async () => {
    const mockCallModel = vi.fn().mockRejectedValue(new Error('Both Tiers Fail'))

    const results = await classify(mockSurvived, mockCwd, {
      callModel: mockCallModel,
      tier1: '',
      tier2: '',
      startChain: fakeChainFactory
    })

    expect(results[0].verdict.verdict).toBe('worth-testing')
    expect(results[0].verdict.confidence).toBe(0)
  })
})

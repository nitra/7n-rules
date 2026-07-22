import { vi, describe, it, expect, beforeEach } from 'vitest'
import { buildFixTestsBatch } from '../fix/fix-tests.mjs'

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn()
}))
vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }))
vi.mock('../fix/gen-tests.mjs', () => ({ findTestRules: vi.fn().mockReturnValue(null) }))
vi.mock('../per-file.mjs', () => ({ parseFailingTests: vi.fn() }))
// MEMORY_ERROR_RE тут не використовується buildFixTestsBatch — стаб із .test()
// замість regex-літерала (prefer-static-regex у hoisted-фабриці неможливий).
vi.mock('@7n/rules/rules/test/coverage/lib/llm.mjs', () => ({
  callText: vi.fn(),
  MEMORY_ERROR_RE: { test: () => false }
}))

describe('buildFixTestsBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('includes all files when everything fits the budget', () => {
    const failures = [
      { file: 'a.test.mjs', errors: ['fail A'] },
      { file: 'b.test.mjs', errors: ['fail B'] }
    ]
    const { prompt, included, deferred } = buildFixTestsBatch(failures, '/proj')
    expect(included.toSorted()).toEqual(['a.test.mjs', 'b.test.mjs'])
    expect(deferred).toEqual([])
    expect(prompt).toContain('### `a.test.mjs`')
    expect(prompt).toContain('### `b.test.mjs`')
  })

  it('defers files that do not fit and keeps the prompt under the fix budget', () => {
    const bigError = 'x'.repeat(40_000)
    const failures = [
      { file: 'big1.test.mjs', errors: [bigError] },
      { file: 'big2.test.mjs', errors: [bigError] },
      { file: 'small.test.mjs', errors: ['tiny'] }
    ]
    const { prompt, included, deferred } = buildFixTestsBatch(failures, '/proj')
    expect(included).toContain('small.test.mjs')
    expect(included.length + deferred.length).toBe(3)
    expect(deferred.length).toBeGreaterThanOrEqual(1)
    expect(prompt.length).toBeLessThanOrEqual(60_000)
  })

  it('falls back to a truncated solo prompt when even the smallest file exceeds the budget', () => {
    const hugeError = 'e'.repeat(120_000)
    const failures = [
      { file: 'huge.test.mjs', errors: [hugeError] },
      { file: 'huge2.test.mjs', errors: [hugeError + 'y'] }
    ]
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => null)
    const { prompt, included, deferred } = buildFixTestsBatch(failures, '/proj')
    expect(included).toHaveLength(1)
    expect(deferred).toHaveLength(1)
    expect(prompt).toContain('обрізано')
    expect(prompt.length).toBeLessThanOrEqual(60_000)
    logSpy.mockRestore()
  })
})

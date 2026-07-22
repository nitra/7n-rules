import { vi, describe, it, expect, beforeEach } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { assessNeed } from '../fix/assess-need.mjs'
import { quickClassify } from '../lib/quick-classify.mjs'

vi.mock('node:fs', () => ({ existsSync: vi.fn(), readFileSync: vi.fn() }))
vi.mock('node:path', () => ({ join: vi.fn((...a) => a.join('/')) }))
vi.mock('@7n/rules/rules/test/coverage/lib/llm.mjs', () => ({ callText: vi.fn() }))

const DIR = '/proj'
const mockCallText = vi.fn()

describe('quickClassify', () => {
  it('returns false for pure re-export file', () => {
    const result = quickClassify('export { x } from "./x.mjs"\nexport * from "./y.mjs"')
    expect(result).toEqual({ needsTests: false, reason: 'лише імпорти/реекспорти без логіки' })
  })

  it('returns false for import-only file', () => {
    const result = quickClassify('import "./side-effect.js"\nimport { foo } from "./foo.js"')
    expect(result).toEqual({ needsTests: false, reason: 'лише імпорти/реекспорти без логіки' })
  })

  it('returns true for file with branches and function bodies', () => {
    const result = quickClassify(`
      export function add(a, b) {
        if (a < 0) return 0
        return a + b
      }
    `)
    expect(result).toEqual({ needsTests: true, reason: 'містить функції з розгалуженнями' })
  })

  it('returns true for arrow functions with branches', () => {
    const result = quickClassify(`
      export const resolve = (val) => {
        if (!val) return null
        return val.trim()
      }
    `)
    expect(result?.needsTests).toBe(true)
  })

  it('returns null for ambiguous file (function without branches)', () => {
    const result = quickClassify('export const greet = name => `Hello, ${name}!`')
    expect(result).toBeNull()
  })

  it('returns null for constants file', () => {
    const result = quickClassify('export const MAX = 100\nexport const MIN = 0')
    expect(result).toBeNull()
  })

  it('ignores single-line comments when classifying', () => {
    const result = quickClassify('// This file only re-exports\nexport { foo } from "./foo.mjs"')
    expect(result?.needsTests).toBe(false)
  })

  it('ignores block comments when classifying', () => {
    const result = quickClassify('/* re-exports */\nexport * from "./bar.mjs"')
    expect(result?.needsTests).toBe(false)
  })
})

describe('assessNeed', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns needsTests:false when file not found', async () => {
    vi.mocked(existsSync).mockReturnValue(false)
    const result = await assessNeed([{ file: 'src/a.mjs', pct: 0 }], DIR, { callText: mockCallText })
    expect(result[0].needsTests).toBe(false)
    expect(result[0].reason).toBe('файл недоступний')
    expect(mockCallText).not.toHaveBeenCalled()
  })

  it('skips LLM for re-export files', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue('export { x } from "./x.mjs"')

    const result = await assessNeed([{ file: 'src/b.mjs', pct: 0 }], DIR, { callText: mockCallText })
    expect(result[0].needsTests).toBe(false)
    expect(result[0].reason).toContain('реекспорти')
    expect(mockCallText).not.toHaveBeenCalled()
  })

  it('skips LLM for files with obvious branches+functions', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue(`
      export function parse(x) {
        if (!x) return null
        return x.trim()
      }
    `)

    const result = await assessNeed([{ file: 'src/c.mjs', pct: 0 }], DIR, { callText: mockCallText })
    expect(result[0].needsTests).toBe(true)
    expect(mockCallText).not.toHaveBeenCalled()
  })

  it('calls LLM for ambiguous files', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue('export const x = 1')
    mockCallText.mockResolvedValue('{"needsTests": true, "reason": "має логіку"}')

    const result = await assessNeed([{ file: 'src/a.mjs', pct: 20 }], DIR, { callText: mockCallText })
    expect(mockCallText).toHaveBeenCalledOnce()
    expect(result[0].needsTests).toBe(true)
    expect(result[0].reason).toBe('має логіку')
  })

  it('returns needsTests:false when LLM says false', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue('const x = 1')
    mockCallText.mockResolvedValue('{"needsTests": false, "reason": "лише константа"}')

    const result = await assessNeed([{ file: 'src/b.mjs', pct: 0 }], DIR, { callText: mockCallText })
    expect(result[0].needsTests).toBe(false)
  })

  it('defaults needsTests:true on LLM parse error', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue('const x = 1')
    mockCallText.mockResolvedValue('not json')

    const result = await assessNeed([{ file: 'src/c.mjs', pct: 10 }], DIR, { callText: mockCallText })
    expect(result[0].needsTests).toBe(true)
  })

  it('defaults needsTests:true when callText throws', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue('const x = 1')
    mockCallText.mockRejectedValue(new Error('network error'))

    const result = await assessNeed([{ file: 'src/d.mjs', pct: 5 }], DIR, { callText: mockCallText })
    expect(result[0].needsTests).toBe(true)
  })

  it('truncates large files before sending to LLM', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue('x'.repeat(10000))
    mockCallText.mockResolvedValue('{"needsTests": false, "reason": "test"}')

    await assessNeed([{ file: 'src/big.mjs', pct: 0 }], DIR, { callText: mockCallText })
    const prompt = mockCallText.mock.calls[0][0]
    expect(prompt).toContain('truncated')
  })

  it('processes multiple files: local for obvious, LLM for ambiguous', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync)
      .mockReturnValueOnce('export { foo } from "./foo.mjs"') // obvious false
      .mockReturnValueOnce('const x = 1') // ambiguous → LLM
    mockCallText.mockResolvedValue('{"needsTests": true, "reason": "logic"}')

    const files = [
      { file: 'src/a.mjs', pct: 0 },
      { file: 'src/b.mjs', pct: 20 }
    ]
    const result = await assessNeed(files, DIR, { callText: mockCallText })
    expect(result).toHaveLength(2)
    expect(result[0].needsTests).toBe(false) // local
    expect(result[1].needsTests).toBe(true) // LLM
    expect(mockCallText).toHaveBeenCalledTimes(1) // only 1 LLM call, not 2
  })
})

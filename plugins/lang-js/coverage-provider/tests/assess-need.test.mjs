import { vi, describe, it, expect, beforeEach } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { assessNeed } from '../fix/assess-need.mjs'
import { quickClassify } from '../lib/quick-classify.mjs'

vi.mock('node:fs', () => ({ existsSync: vi.fn(), readFileSync: vi.fn() }))

const DIR = '/proj'

const VALID_VERDICT = JSON.stringify({ needsTests: true, reason: 'має логіку' })

/**
 * Фейковий `submitBatchImpl`: маршрутизує відповідь за customId (тут —
 * `fileInfo.file`) через передану функцію `responder(customId) => {ok}|{error}`.
 * @param {(customId: string) => {ok?: string, error?: string}} responder функція відповіді за customId
 * @returns {(model: string, items: Array<object>) => Promise<Array<object>>} fake submitBatch
 */
function fakeSubmitBatch(responder) {
  return vi.fn((model, items) =>
    Promise.resolve(items.map(item => ({ customId: item.customId, ...responder(item.customId) })))
  )
}

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
    const result = quickClassify('export const greet = name => `Hello, ` + name')
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
    const submitBatchImpl = vi.fn()
    const result = await assessNeed([{ file: 'src/a.mjs', pct: 0 }], DIR, { submitBatchImpl })
    expect(result[0].needsTests).toBe(false)
    expect(result[0].reason).toBe('файл недоступний')
    expect(submitBatchImpl).not.toHaveBeenCalled()
  })

  it('skips LLM for re-export files', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue('export { x } from "./x.mjs"')
    const submitBatchImpl = vi.fn()

    const result = await assessNeed([{ file: 'src/b.mjs', pct: 0 }], DIR, { submitBatchImpl })
    expect(result[0].needsTests).toBe(false)
    expect(result[0].reason).toContain('реекспорти')
    expect(submitBatchImpl).not.toHaveBeenCalled()
  })

  it('skips LLM for files with obvious branches+functions', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue(`
      export function parse(x) {
        if (!x) return null
        return x.trim()
      }
    `)
    const submitBatchImpl = vi.fn()

    const result = await assessNeed([{ file: 'src/c.mjs', pct: 0 }], DIR, { submitBatchImpl })
    expect(result[0].needsTests).toBe(true)
    expect(submitBatchImpl).not.toHaveBeenCalled()
  })

  it('calls LLM (one batch wave) for ambiguous files', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue('export const x = 1')
    const submitBatchImpl = fakeSubmitBatch(() => ({ ok: VALID_VERDICT }))

    const result = await assessNeed([{ file: 'src/a.mjs', pct: 20 }], DIR, {
      tier1: 'x/a',
      tier2: 'x/b',
      submitBatchImpl
    })
    expect(submitBatchImpl).toHaveBeenCalledTimes(1)
    expect(submitBatchImpl.mock.calls[0][0]).toBe('x/a')
    expect(result[0].needsTests).toBe(true)
    expect(result[0].reason).toBe('має логіку')
  })

  it('returns needsTests:false when LLM says false', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue('const x = 1')
    const submitBatchImpl = fakeSubmitBatch(() => ({
      ok: JSON.stringify({ needsTests: false, reason: 'лише константа' })
    }))

    const result = await assessNeed([{ file: 'src/b.mjs', pct: 0 }], DIR, {
      tier1: 'x/a',
      tier2: 'x/b',
      submitBatchImpl
    })
    expect(result[0].needsTests).toBe(false)
  })

  it('defaults needsTests:true on LLM parse error', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue('const x = 1')
    const submitBatchImpl = fakeSubmitBatch(() => ({ ok: 'not json' }))

    const result = await assessNeed([{ file: 'src/c.mjs', pct: 10 }], DIR, {
      tier1: 'x/a',
      tier2: 'x/b',
      submitBatchImpl
    })
    expect(result[0].needsTests).toBe(true)
  })

  it('escalates to tier2 when tier1 wave fails, defaults needsTests:true if tier2 also fails', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue('const x = 1')
    const submitBatchImpl = fakeSubmitBatch(() => ({ error: 'network error' }))

    const result = await assessNeed([{ file: 'src/d.mjs', pct: 5 }], DIR, {
      tier1: 'x/a',
      tier2: 'x/b',
      submitBatchImpl
    })
    expect(submitBatchImpl).toHaveBeenCalledTimes(2)
    expect(result[0].needsTests).toBe(true)
    expect(result[0].reason).toBe('оцінка не вдалась — вважаємо що потрібні тести')
  })

  it('truncates large files before sending to LLM', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue('x'.repeat(10000))
    const submitBatchImpl = fakeSubmitBatch(() => ({ ok: JSON.stringify({ needsTests: false, reason: 'test' }) }))

    await assessNeed([{ file: 'src/big.mjs', pct: 0 }], DIR, { tier1: 'x/a', tier2: 'x/b', submitBatchImpl })
    const prompt = submitBatchImpl.mock.calls[0][1][0].prompt
    expect(prompt).toContain('truncated')
  })

  it('processes multiple files: local for obvious, one batch call for ambiguous', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync)
      .mockReturnValueOnce('export { foo } from "./foo.mjs"') // obvious false
      .mockReturnValueOnce('const x = 1') // ambiguous → LLM
    const submitBatchImpl = fakeSubmitBatch(() => ({ ok: VALID_VERDICT }))

    const files = [
      { file: 'src/a.mjs', pct: 0 },
      { file: 'src/b.mjs', pct: 20 }
    ]
    const result = await assessNeed(files, DIR, { tier1: 'x/a', tier2: 'x/b', submitBatchImpl })
    expect(result).toHaveLength(2)
    expect(result[0].needsTests).toBe(false) // local
    expect(result[1].needsTests).toBe(true) // LLM
    expect(submitBatchImpl).toHaveBeenCalledTimes(1) // one batch wave, not per-file
    expect(submitBatchImpl.mock.calls[0][1]).toHaveLength(1) // only the ambiguous file went to LLM
  })

  it('N неоднозначних файлів — один submitBatchImpl-виклик на хвилю, не по файлу', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue('const x = 1')
    const submitBatchImpl = fakeSubmitBatch(() => ({ ok: VALID_VERDICT }))

    const files = Array.from({ length: 4 }, (_, i) => ({ file: `src/f${i}.mjs`, pct: i }))
    const result = await assessNeed(files, DIR, { tier1: 'x/a', tier2: 'x/b', submitBatchImpl })
    expect(submitBatchImpl).toHaveBeenCalledTimes(1)
    expect(submitBatchImpl.mock.calls[0][1]).toHaveLength(4)
    expect(result).toHaveLength(4)
  })

  it('порядок повернення відповідає вхідному порядку файлів, незалежно від порядку в результаті батчу', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue('const x = 1')
    // submitBatch повертає результати у зворотному порядку — реалістично для конкурентного виконання.
    const submitBatchImpl = vi.fn((model, items) =>
      Promise.resolve(items.toReversed().map(i => ({ customId: i.customId, ok: VALID_VERDICT })))
    )

    const files = [
      { file: 'src/a.mjs', pct: 1 },
      { file: 'src/b.mjs', pct: 2 }
    ]
    const result = await assessNeed(files, DIR, { tier1: 'x/a', tier2: 'x/b', submitBatchImpl })
    expect(result.map(r => r.file)).toEqual(['src/a.mjs', 'src/b.mjs'])
  })

  it('submitBatchImpl сам кидає помилку (напр. невалідний model-spec) — graceful fallback, не throw', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue('const x = 1')
    const submitBatchImpl = vi.fn(() => Promise.reject(new Error('invalid model spec')))

    const result = await assessNeed([{ file: 'src/e.mjs', pct: 5 }], DIR, {
      tier1: 'x/a',
      tier2: 'x/b',
      submitBatchImpl
    })
    expect(result[0].needsTests).toBe(true)
    expect(result[0].reason).toBe('оцінка не вдалась — вважаємо що потрібні тести')
  })
})

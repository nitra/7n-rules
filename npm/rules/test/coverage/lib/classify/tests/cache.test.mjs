import { vi, describe, it, expect, beforeEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { deriveBlobHash, deriveCacheKey, readCache, writeCache } from '../cache.mjs'

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }))
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn()
}))
vi.mock('node:path', () => ({
  join: vi.fn((...a) => a.join('/')),
  dirname: vi.fn(p => p.split('/').slice(0, -1).join('/'))
}))

const FILE = '/proj/src/util.js'
const MUTANT = { line: 3, col: 1, replacement: 'false' }

describe('cache.mjs', () => {
  beforeEach(() => vi.clearAllMocks())

  describe('deriveBlobHash', () => {
    it('uses git hash-object when available', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(execFileSync).mockReturnValue('abc123\n')
      expect(deriveBlobHash(FILE)).toBe('abc123')
    })

    it('falls back to sha256 when git fails', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(execFileSync).mockImplementation(() => {
        throw new Error('git error')
      })
      vi.mocked(readFileSync).mockReturnValue('content')
      const hash = deriveBlobHash(FILE)
      expect(typeof hash).toBe('string')
      expect(hash.length).toBe(64)
    })

    it('returns null when file does not exist', () => {
      vi.mocked(existsSync).mockReturnValue(false)
      expect(deriveBlobHash('/nonexistent')).toBeNull()
    })
  })

  describe('deriveCacheKey', () => {
    it('returns null when file does not exist', () => {
      vi.mocked(existsSync).mockReturnValue(false)
      expect(deriveCacheKey('/nonexistent', MUTANT)).toBeNull()
    })
  })

  describe('readCache', () => {
    it('returns default empty cache when file missing', () => {
      vi.mocked(existsSync).mockReturnValue(false)
      expect(readCache('/cache.json')).toEqual({ version: 1, model: null, entries: {} })
    })

    it('returns default on invalid JSON', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue('{bad json')
      expect(readCache('/cache.json')).toEqual({ version: 1, model: null, entries: {} })
    })

    it('returns default on version mismatch', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ version: 0, model: null, entries: {} }))
      expect(readCache('/cache.json')).toEqual({ version: 1, model: null, entries: {} })
    })

    it('returns loaded cache on success', () => {
      const data = { version: 1, model: 'test', entries: { k: { verdict: 'ok' } } }
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(data))
      expect(readCache('/cache.json')).toEqual(data)
    })
  })

  describe('writeCache', () => {
    it('creates directory and writes JSON', () => {
      writeCache('/path/to/cache.json', { version: 1, model: 'x', entries: {} })
      expect(vi.mocked(mkdirSync)).toHaveBeenCalledWith('/path/to', { recursive: true })
      expect(vi.mocked(writeFileSync)).toHaveBeenCalledWith(
        '/path/to/cache.json',
        expect.stringContaining('"version"'),
        'utf8'
      )
    })
  })
})

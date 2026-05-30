/**
 * Тести cache.mjs: file-hash-keyed cache для verdicts.
 *   - deriveBlobHash: git hash-object для існуючого файла, sha1 fallback;
 *   - deriveCacheKey: blobHash:line:col:base64url(replacement);
 *   - readCache/writeCache: round-trip, схема, інвалідація.
 */
import { describe, expect, test } from 'vitest'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'

import { deriveBlobHash, deriveCacheKey, readCache, writeCache } from '../cache.mjs'
import { withTmpDir } from '../../utils/test-helpers.mjs'

describe('deriveBlobHash', () => {
  test('повертає sha1 для існуючого файла (через git hash-object або fallback)', async () => {
    await withTmpDir(async dir => {
      const f = join(dir, 'a.txt')
      await writeFile(f, 'hello world\n', 'utf8')
      const hash = deriveBlobHash(f)
      expect(hash).toMatch(/^[a-f0-9]{40}$/u)
    })
  })

  test('повертає null для неіснуючого файла', () => {
    expect(deriveBlobHash('/no/such/file/12345')).toBeNull()
  })

  test('стабільний хеш — той самий контент → той самий хеш', async () => {
    await withTmpDir(async dir => {
      const a = join(dir, 'a.txt')
      const b = join(dir, 'b.txt')
      await writeFile(a, 'same content\n', 'utf8')
      await writeFile(b, 'same content\n', 'utf8')
      expect(deriveBlobHash(a)).toBe(deriveBlobHash(b))
    })
  })

  test('різний контент → різний хеш', async () => {
    await withTmpDir(async dir => {
      const a = join(dir, 'a.txt')
      const b = join(dir, 'b.txt')
      await writeFile(a, 'content A\n', 'utf8')
      await writeFile(b, 'content B\n', 'utf8')
      expect(deriveBlobHash(a)).not.toBe(deriveBlobHash(b))
    })
  })
})

describe('deriveCacheKey', () => {
  test('повертає null коли файл недоступний', () => {
    const mutant = { line: 1, col: 1, replacement: 'true' }
    expect(deriveCacheKey('/no/such/file', mutant)).toBeNull()
  })

  test('формат: <blobHash>:<line>:<col>:<base64url(replacement)>', async () => {
    await withTmpDir(async dir => {
      const f = join(dir, 'a.mjs')
      await writeFile(f, 'export const x = 1\n', 'utf8')
      const mutant = { line: 1, col: 17, replacement: '2' }
      const key = deriveCacheKey(f, mutant)
      expect(key).toMatch(/^[a-f0-9]{40}:1:17:[A-Za-z0-9_-]+$/u)
    })
  })

  test('replacement з спецсимволами (:, /) кодується безпечно', async () => {
    await withTmpDir(async dir => {
      const f = join(dir, 'a.mjs')
      await writeFile(f, 'x\n', 'utf8')
      const mutant = { line: 1, col: 1, replacement: 'a:b/c\n' }
      const key = deriveCacheKey(f, mutant)
      // base64url не містить +, /, =, тільки A-Z a-z 0-9 - _
      const parts = key.split(':')
      expect(parts).toHaveLength(4)
      expect(parts[3]).toMatch(/^[A-Za-z0-9_-]+$/u)
    })
  })
})

describe('readCache / writeCache', () => {
  test('пустий cache при відсутньому файлі', async () => {
    await withTmpDir(dir => {
      const cachePath = join(dir, 'cache.json')
      const c = readCache(cachePath)
      expect(c).toEqual({ version: 1, model: null, entries: {} })
    })
  })

  test('round-trip: write → read той самий вміст', async () => {
    await withTmpDir(dir => {
      const cachePath = join(dir, 'cache.json')
      const entry = {
        verdict: 'glue',
        confidence: 0.8,
        reason: 'Branch covered by integration',
        classifiedAt: '2026-05-30T12:00:00Z'
      }
      const c = { version: 1, model: 'claude-sonnet-4-6', entries: { abc: entry } }
      writeCache(cachePath, c)
      expect(readCache(cachePath)).toEqual(c)
    })
  })

  test('corrupted JSON → empty cache (recover)', async () => {
    await withTmpDir(async dir => {
      const cachePath = join(dir, 'cache.json')
      await writeFile(cachePath, '{ broken json', 'utf8')
      expect(readCache(cachePath)).toEqual({ version: 1, model: null, entries: {} })
    })
  })

  test('version mismatch → empty cache (invalidate)', async () => {
    await withTmpDir(async dir => {
      const cachePath = join(dir, 'cache.json')
      await writeFile(cachePath, JSON.stringify({ version: 99, entries: { x: {} } }), 'utf8')
      expect(readCache(cachePath)).toEqual({ version: 1, model: null, entries: {} })
    })
  })

  test('writeCache створює батьківські директорії', async () => {
    await withTmpDir(dir => {
      const cachePath = join(dir, 'nested/deep/cache.json')
      writeCache(cachePath, { version: 1, model: 'x', entries: {} })
      expect(existsSync(cachePath)).toBe(true)
    })
  })

  test('entries не object → empty cache', async () => {
    await withTmpDir(async dir => {
      const cachePath = join(dir, 'cache.json')
      await writeFile(cachePath, JSON.stringify({ version: 1, entries: 'not an object' }), 'utf8')
      expect(readCache(cachePath).entries).toEqual({})
    })
  })
})

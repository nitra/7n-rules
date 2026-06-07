/**
 * Тести index.mjs (classify orchestrator):
 *   - Tier 1 (LOCAL_MIN) → valid → використати verdict
 *   - Tier 1 fail → Tier 2 (CLOUD_MIN) → valid → використати
 *   - обидва тири fail → FALLBACK_VERDICT
 *   - cache hit/miss/write
 *   - cache model mismatch → entries очищаються
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'

import { withTmpDir } from '../../utils/test-helpers.mjs'
import { classify } from '../index.mjs'

const REASON = 'Branch is covered by integration test runStandardRule wrapper'

const SAMPLE = `export function foo() {
  if (x === 1) return 'a'
  return 'b'
}
`

/**
 * Будує survived-фікстуру з одним EqualityOperator-мутантом для вказаного файлу.
 * @param {string} file шлях до source-файлу мутанта
 * @returns {object[]}
 */
function survivedFixture(file) {
  return [
    {
      file,
      mutants: [{ line: 2, col: 7, mutantType: 'EqualityOperator', original: '===', replacement: '!==' }],
      exampleTest: null,
      recommendationText: null
    }
  ]
}

/**
 * Повертає JSON-рядок verdict для передачі у mock callPi.
 * @param {object} verdictJson
 * @returns {string}
 */
function verdictText(verdictJson) {
  return JSON.stringify(verdictJson)
}

describe('classify', () => {
  let mockCallPi

  beforeEach(() => {
    mockCallPi = vi.fn()
    vi.spyOn(console, 'warn').mockReturnValue()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('Tier 1 валідний → verdict повертається, Tier 2 не викликається', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'foo.mjs'), SAMPLE, 'utf8')
      mockCallPi.mockReturnValueOnce(verdictText({ verdict: 'worth-testing', confidence: 0.85, reason: REASON }))
      const result = await classify(survivedFixture('foo.mjs'), dir, {
        cachePath: join(dir, 'cache.json'),
        callPi: mockCallPi
      })
      expect(result).toHaveLength(1)
      expect(result[0].key).toBe('foo.mjs:2:7:!==')
      expect(result[0].verdict.verdict).toBe('worth-testing')
      expect(mockCallPi).toHaveBeenCalledTimes(1)
    })
  })

  test('Tier 1 bad JSON → Tier 2 викликається → valid verdict', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'foo.mjs'), SAMPLE, 'utf8')
      mockCallPi
        .mockReturnValueOnce('not json')
        .mockReturnValueOnce(verdictText({ verdict: 'equivalent', confidence: 0.9, reason: REASON }))
      const result = await classify(survivedFixture('foo.mjs'), dir, {
        cachePath: join(dir, 'cache.json'),
        callPi: mockCallPi
      })
      expect(result[0].verdict.verdict).toBe('equivalent')
      expect(mockCallPi).toHaveBeenCalledTimes(2)
    })
  })

  test('обидва тири fail → FALLBACK_VERDICT (worth-testing / confidence=0)', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'foo.mjs'), SAMPLE, 'utf8')
      mockCallPi.mockImplementation(() => { throw new Error('pi not found') })
      const result = await classify(survivedFixture('foo.mjs'), dir, {
        cachePath: join(dir, 'cache.json'),
        callPi: mockCallPi
      })
      expect(result).toHaveLength(1)
      expect(result[0].verdict.verdict).toBe('worth-testing')
      expect(result[0].verdict.confidence).toBe(0)
    })
  })

  test('cache hit → callPi не викликається', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'foo.mjs'), SAMPLE, 'utf8')
      const cachePath = join(dir, 'cache.json')
      mockCallPi.mockReturnValue(verdictText({ verdict: 'equivalent', confidence: 0.9, reason: REASON }))

      await classify(survivedFixture('foo.mjs'), dir, { cachePath, callPi: mockCallPi })
      expect(mockCallPi).toHaveBeenCalledTimes(1)

      const r2 = await classify(survivedFixture('foo.mjs'), dir, { cachePath, callPi: mockCallPi })
      expect(mockCallPi).toHaveBeenCalledTimes(1) // не змінилося
      expect(r2[0].verdict.verdict).toBe('equivalent')
    })
  })

  test('verdict записується у cache', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'foo.mjs'), SAMPLE, 'utf8')
      const cachePath = join(dir, 'cache.json')
      mockCallPi.mockReturnValueOnce(verdictText({ verdict: 'glue', confidence: 0.8, reason: REASON }))
      await classify(survivedFixture('foo.mjs'), dir, { cachePath, callPi: mockCallPi })
      const { readFileSync } = await import('node:fs')
      const cached = JSON.parse(readFileSync(cachePath, 'utf8'))
      expect(Object.keys(cached.entries)).toHaveLength(1)
      const entry = Object.values(cached.entries)[0]
      expect(entry.verdict).toBe('glue')
      expect(entry.confidence).toBe(0.8)
      expect(entry.classifiedAt).toBeTruthy()
    })
  })

  test('cache model mismatch → entries очищаються', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'foo.mjs'), SAMPLE, 'utf8')
      const cachePath = join(dir, 'cache.json')
      const { writeFileSync } = await import('node:fs')
      writeFileSync(
        cachePath,
        JSON.stringify({
          version: 1,
          model: 'old-model',
          entries: { 'fake-key': { verdict: 'glue', confidence: 0.9, reason: REASON, classifiedAt: 'x' } }
        }),
        'utf8'
      )
      mockCallPi.mockReturnValueOnce(verdictText({ verdict: 'equivalent', confidence: 0.9, reason: REASON }))
      await classify(survivedFixture('foo.mjs'), dir, { cachePath, callPi: mockCallPi })
      expect(mockCallPi).toHaveBeenCalledTimes(1) // не cache hit — model змінилася
    })
  })

  test('кілька груп / мутантів — обробляються послідовно', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'a.mjs'), SAMPLE, 'utf8')
      await writeFile(join(dir, 'b.mjs'), SAMPLE, 'utf8')
      const cachePath = join(dir, 'cache.json')
      mockCallPi.mockReturnValue(verdictText({ verdict: 'worth-testing', confidence: 0.8, reason: REASON }))
      const survived = [...survivedFixture('a.mjs'), ...survivedFixture('b.mjs')]
      const result = await classify(survived, dir, { cachePath, callPi: mockCallPi })
      expect(result).toHaveLength(2)
      expect(result[0].key.startsWith('a.mjs:')).toBe(true)
      expect(result[1].key.startsWith('b.mjs:')).toBe(true)
    })
  })
})

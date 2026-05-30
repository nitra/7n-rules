/**
 * Тести index.mjs (classify orchestrator):
 *   - Anthropic SDK мокається через vi.mock
 *   - cache hit/miss/write
 *   - graceful skip без API key / без SDK
 *   - retry на API error → conservative fallback
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { env } from 'node:process'

import { withTmpDir } from '../../utils/test-helpers.mjs'

const REASON = 'Branch is covered by integration test runStandardRule wrapper'

let mockCreate
vi.mock('@anthropic-ai/sdk', () => {
  const fn = (...args) => mockCreate(...args)
  class Anthropic {
    constructor() {
      this.messages = { create: fn }
    }
  }
  return { default: Anthropic }
})

const { classify } = await import('../index.mjs')

const SAMPLE = `export function foo() {
  if (x === 1) return 'a'
  return 'b'
}
`

/**
 * Будує survived-фікстуру з одним EqualityOperator-мутантом для вказаного файлу.
 * @param {string} file шлях до source-файлу мутанта
 * @returns {object[]} список survived-записів для applyVerdicts
 */
function survivedFixture(file) {
  return [
    {
      file,
      mutants: [
        { line: 2, col: 7, mutantType: 'EqualityOperator', original: '===', replacement: '!==' }
      ],
      exampleTest: null,
      recommendationText: null
    }
  ]
}

/**
 * Будує Anthropic-style response з text-content, що містить JSON verdict.
 * @param {object} verdictJson об'єкт verdict, серіалізований у text
 * @returns {object} mock Anthropic response
 */
function mockResponse(verdictJson) {
  return {
    content: [{ type: 'text', text: JSON.stringify(verdictJson) }]
  }
}

describe('classify', () => {
  beforeEach(() => {
    mockCreate = vi.fn()
    env.ANTHROPIC_API_KEY = 'test-key'
    vi.spyOn(console, 'warn').mockReturnValue()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete env.ANTHROPIC_API_KEY
  })

  test('класифікує один мутант → повертає verdict з key', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'foo.mjs'), SAMPLE, 'utf8')
      const cachePath = join(dir, 'cache.json')
      mockCreate.mockResolvedValueOnce(
        mockResponse({ verdict: 'worth-testing', confidence: 0.85, reason: REASON })
      )
      const result = await classify(survivedFixture('foo.mjs'), dir, { cachePath })
      expect(result).toHaveLength(1)
      expect(result[0].key).toBe('foo.mjs:2:7:!==')
      expect(result[0].verdict.verdict).toBe('worth-testing')
    })
  })

  test('cache hit на 2-му виклику → SDK не викликається', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'foo.mjs'), SAMPLE, 'utf8')
      const cachePath = join(dir, 'cache.json')
      mockCreate.mockResolvedValueOnce(
        mockResponse({ verdict: 'equivalent', confidence: 0.9, reason: REASON })
      )
      await classify(survivedFixture('foo.mjs'), dir, { cachePath })
      expect(mockCreate).toHaveBeenCalledTimes(1)

      // другий запуск — той самий source, той самий mutant → cache hit
      const r2 = await classify(survivedFixture('foo.mjs'), dir, { cachePath })
      expect(mockCreate).toHaveBeenCalledTimes(1) // не змінилося
      expect(r2[0].verdict.verdict).toBe('equivalent')
    })
  })

  test('ANTHROPIC_API_KEY unset → warn-and-skip, повертає []', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'foo.mjs'), SAMPLE, 'utf8')
      delete env.ANTHROPIC_API_KEY
      const result = await classify(survivedFixture('foo.mjs'), dir, { cachePath: join(dir, 'c.json') })
      expect(result).toEqual([])
      expect(mockCreate).not.toHaveBeenCalled()
    })
  })

  test('API throws → retry → fallback verdict worth-testing (conservative)', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'foo.mjs'), SAMPLE, 'utf8')
      mockCreate.mockRejectedValue(new Error('500 server error'))
      const result = await classify(survivedFixture('foo.mjs'), dir, {
        cachePath: join(dir, 'c.json'),
        retryDelayMs: 0
      })
      expect(result).toHaveLength(1)
      expect(result[0].verdict.verdict).toBe('worth-testing')
      expect(result[0].verdict.confidence).toBe(0)
      // повторено 3 рази (initial + 2 retries) перед fallback
      expect(mockCreate).toHaveBeenCalledTimes(3)
    })
  })

  test('invalid JSON у відповіді → один retry → якщо знову bad — fallback', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'foo.mjs'), SAMPLE, 'utf8')
      mockCreate
        .mockResolvedValueOnce({ content: [{ type: 'text', text: 'not json' }] })
        .mockResolvedValueOnce({ content: [{ type: 'text', text: 'still not json' }] })
        .mockResolvedValueOnce({ content: [{ type: 'text', text: 'never json' }] })
      const result = await classify(survivedFixture('foo.mjs'), dir, {
        cachePath: join(dir, 'c.json'),
        retryDelayMs: 0
      })
      expect(result[0].verdict.verdict).toBe('worth-testing')
      expect(result[0].verdict.confidence).toBe(0)
    })
  })

  test('class з кеш-міс і ще раз — записує verdict у cache', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'foo.mjs'), SAMPLE, 'utf8')
      const cachePath = join(dir, 'cache.json')
      mockCreate.mockResolvedValueOnce(
        mockResponse({ verdict: 'glue', confidence: 0.8, reason: REASON })
      )
      await classify(survivedFixture('foo.mjs'), dir, { cachePath })
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
      mockCreate.mockResolvedValueOnce(
        mockResponse({ verdict: 'equivalent', confidence: 0.9, reason: REASON })
      )
      await classify(survivedFixture('foo.mjs'), dir, { cachePath })
      expect(mockCreate).toHaveBeenCalledTimes(1) // не cache hit бо model змінилася
    })
  })

  test('кілька груп / мутантів — обробляються послідовно', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'a.mjs'), SAMPLE, 'utf8')
      await writeFile(join(dir, 'b.mjs'), SAMPLE, 'utf8')
      const cachePath = join(dir, 'cache.json')
      mockCreate.mockResolvedValue(
        mockResponse({ verdict: 'worth-testing', confidence: 0.8, reason: REASON })
      )
      const survived = [...survivedFixture('a.mjs'), ...survivedFixture('b.mjs')]
      const result = await classify(survived, dir, { cachePath })
      expect(result).toHaveLength(2)
      expect(result[0].key.startsWith('a.mjs:')).toBe(true)
      expect(result[1].key.startsWith('b.mjs:')).toBe(true)
    })
  })
})

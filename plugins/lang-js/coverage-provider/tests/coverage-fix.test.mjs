import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFile } from 'node:fs/promises'
import { env } from 'node:process'
import { fixSurvivedMutants, buildFixPrompt, batchSurvived } from '../fix/coverage-fix.mjs'

vi.mock('node:fs/promises', () => ({ readFile: vi.fn() }))

const ROOT = '/proj'
const survived = [
  {
    file: 'src/util.js',
    mutants: [{ line: 5, col: 2, mutantType: 'BooleanLiteral', original: 'true', replacement: 'false' }],
    exampleTest: null,
    recommendationText: null
  }
]

/**
 * Будує SurvivedFileGroup з `n` однаковими мутантами — для тестів batching-логіки,
 * де важлива лише кількість мутантів на файл, не їхній вміст.
 * @param {string} file відносний шлях файлу
 * @param {number} n кількість мутантів
 * @returns {object} SurvivedFileGroup
 */
function groupWith(file, n) {
  return {
    file,
    mutants: Array.from({ length: n }, (_, i) => ({
      line: i + 1,
      col: 0,
      mutantType: 'BooleanLiteral',
      original: 'true',
      replacement: 'false'
    })),
    exampleTest: null,
    recommendationText: null
  }
}

describe('coverage-fix.mjs', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => {
    delete env.N_CURSOR_COVERAGE_FIX_BATCH_MUTANTS
  })

  describe('batchSurvived', () => {
    it('returns empty array for empty input', () => {
      expect(batchSurvived([], 40)).toEqual([])
    })

    it('keeps groups under budget in a single batch', () => {
      const groups = [groupWith('a.js', 5), groupWith('b.js', 5)]
      expect(batchSurvived(groups, 40)).toEqual([groups])
    })

    it('splits into new batch once budget would be exceeded', () => {
      const a = groupWith('a.js', 25)
      const b = groupWith('b.js', 20)
      expect(batchSurvived([a, b], 40)).toEqual([[a], [b]])
    })

    it('splits an oversized source-file into isolated 20-mutant sub-batches', () => {
      const big = groupWith('big.js', 82)
      const batches = batchSurvived([big], 40)
      expect(batches.map(batch => batch[0].mutants.length)).toEqual([20, 20, 20, 20, 2])
      expect(batches.every(batch => batch.length === 1)).toBe(true)
      expect(batches.map(batch => batch[0].sourceMutantCount)).toEqual([82, 82, 82, 82, 82])
    })
  })

  describe('fixSurvivedMutants', () => {
    it('logs and returns early when survived is empty', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {
        return
      })
      const runAgentFix = vi.fn()
      const result = await fixSurvivedMutants([], ROOT, { runAgentFix })
      expect(logSpy).toHaveBeenCalledWith('✓ Всі мутанти вбиті — доповнення тестів не потрібне')
      expect(runAgentFix).not.toHaveBeenCalled()
      expect(result).toEqual({
        fixed: [],
        failed: [],
        deferred: [],
        touchedFiles: [],
        mutationRefreshFiles: [],
        batches: []
      })
      logSpy.mockRestore()
    })

    it('calls agent-fix session for non-empty survived list with ladder ctx fields', async () => {
      readFile.mockResolvedValue('const x = true')
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {
        return
      })
      const recordWrite = vi.fn()
      const recordDurableWrite = vi.fn()
      const verifyMutation = vi.fn(() =>
        Promise.resolve({
          ok: true,
          targetCount: 1,
          killed: 1,
          remaining: 0,
          covered0: 0,
          cacheIndependent: true,
          reason: null
        })
      )
      const runAgentFix = vi.fn(async (_rule, _prompt, _cwd, options) => {
        await options.verify({ touchedFiles: ['/proj/tests/util.test.mjs'] })
        return { touchedFiles: ['/proj/tests/util.test.mjs'], rollback: vi.fn() }
      })

      const result = await fixSurvivedMutants(survived, ROOT, {
        runAgentFix,
        verifyMutation,
        recordWrite,
        recordDurableWrite,
        tier: 'cloud-min'
      })

      expect(runAgentFix).toHaveBeenCalledWith(
        'test',
        expect.any(String),
        ROOT,
        expect.objectContaining({
          recordWrite,
          tier: 'cloud-min',
          editMode: 'test-generation',
          sourceFiles: ['src/util.js']
        })
      )
      expect(runAgentFix.mock.calls[0][3]).not.toHaveProperty('targetFiles')
      expect(result).toMatchObject({
        fixed: ['/proj/tests/util.test.mjs'],
        failed: [],
        touchedFiles: ['/proj/tests/util.test.mjs'],
        mutationRefreshFiles: ['src/util.js']
      })
      expect(result.batches[0]).toMatchObject({
        batch: 1,
        configuredBudget: 40,
        promptChars: expect.any(Number),
        verdict: {
          allowedTestWrites: 1,
          blockedWrites: 0,
          backstopHit: false,
          mutation: { targetCount: 1, killed: 1, remaining: 0, covered0: 0, cacheIndependent: true }
        }
      })
      expect(verifyMutation).toHaveBeenCalledWith({ cwd: ROOT, batch: survived })
      expect(recordDurableWrite).toHaveBeenCalledWith('/proj/tests/util.test.mjs')
      logSpy.mockRestore()
    })

    it('marks an agent completion without writes as failed/no-op', async () => {
      readFile.mockResolvedValue('const x = true')
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {
        return
      })
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {
        return
      })
      const runAgentFix = vi.fn(() => Promise.resolve({ touchedFiles: [] }))
      const big = [groupWith('a.js', 25), groupWith('b.js', 20)]

      const result = await fixSurvivedMutants(big, ROOT, { runAgentFix })

      expect(runAgentFix).toHaveBeenCalledTimes(2)
      expect(result).toMatchObject({
        fixed: [],
        failed: [
          {
            files: ['a.js'],
            error: 'no-op: агент завершився без записів (turnCount=0, toolCallCount=0, stopReason=-, blockedWrites=0)'
          },
          {
            files: ['b.js'],
            error: 'no-op: агент завершився без записів (turnCount=0, toolCallCount=0, stopReason=-, blockedWrites=0)'
          }
        ],
        touchedFiles: []
      })
      logSpy.mockRestore()
      errSpy.mockRestore()
    })

    it('one failing batch does not block the others and is reported, not thrown', async () => {
      readFile.mockResolvedValue('const x = true')
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {
        return
      })
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {
        return
      })
      const verifyMutation = vi.fn(() =>
        Promise.resolve({ ok: true, targetCount: 20, killed: 1, remaining: 19, covered0: 0, reason: null })
      )
      const runAgentFix = vi
        .fn()
        .mockResolvedValueOnce({ error: 'skill timeout 900000ms' })
        .mockImplementationOnce(async (_rule, _prompt, _cwd, options) => {
          await options.verify({ touchedFiles: ['/proj/tests/b.test.mjs'] })
          return { touchedFiles: ['/proj/tests/b.test.mjs'], rollback: vi.fn() }
        })
      const big = [groupWith('a.js', 25), groupWith('b.js', 20)]

      const result = await fixSurvivedMutants(big, ROOT, { runAgentFix, verifyMutation })

      expect(result).toMatchObject({
        fixed: ['/proj/tests/b.test.mjs'],
        failed: [{ files: ['a.js'], error: 'skill timeout 900000ms' }],
        touchedFiles: ['/proj/tests/b.test.mjs']
      })
      expect(runAgentFix).toHaveBeenCalledTimes(2)
      logSpy.mockRestore()
      errSpy.mockRestore()
    })

    it('відкочує зелений, але mutation-irrelevant test і повертає useful quality feedback', async () => {
      readFile.mockResolvedValue('const x = true')
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => null)
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => null)
      const rollback = vi.fn()
      const verifyMutation = vi.fn(() =>
        Promise.resolve({
          ok: false,
          targetCount: 1,
          killed: 0,
          remaining: 1,
          covered0: 1,
          reason: 'covered 0: target mutants лишились без покриття'
        })
      )
      const runAgentFix = vi.fn(async (_rule, _prompt, _cwd, options) => {
        await options.verify({ touchedFiles: ['/proj/tests/util.test.mjs'] })
        return { touchedFiles: ['/proj/tests/util.test.mjs'], rollback }
      })

      const result = await fixSurvivedMutants(survived, ROOT, { runAgentFix, verifyMutation })

      expect(result).toMatchObject({
        fixed: [],
        touchedFiles: [],
        failed: [{ files: ['src/util.js'], error: expect.stringContaining('covered 0') }]
      })
      expect(result.batches[0].verdict.mutation).toMatchObject({ targetCount: 1, killed: 0, remaining: 1, covered0: 1 })
      expect(rollback).toHaveBeenCalledOnce()
      logSpy.mockRestore()
      errSpy.mockRestore()
    })

    it('відкочує test batch, коли scoped Stryker runner або reporter не дали verdict', async () => {
      readFile.mockResolvedValue('const x = true')
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => null)
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => null)
      const rollback = vi.fn()
      const verifyMutation = vi.fn(() =>
        Promise.resolve({
          ok: false,
          targetCount: 1,
          killed: 0,
          remaining: 0,
          covered0: 0,
          reason: 'reporter failure: Stryker exit 1'
        })
      )
      const runAgentFix = vi.fn(async (_rule, _prompt, _cwd, options) => {
        await options.verify({ touchedFiles: ['/proj/tests/util.test.mjs'] })
        return { touchedFiles: ['/proj/tests/util.test.mjs'], rollback }
      })

      const result = await fixSurvivedMutants(survived, ROOT, { runAgentFix, verifyMutation })

      expect(result.failed[0].error).toContain('reporter failure')
      expect(rollback).toHaveBeenCalledOnce()
      logSpy.mockRestore()
      errSpy.mockRestore()
    })

    it('не позначає durable cache-dependent batch', async () => {
      readFile.mockResolvedValue('const x = true')
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => null)
      const recordDurableWrite = vi.fn()
      const verifyMutation = vi.fn(() =>
        Promise.resolve({
          ok: true,
          targetCount: 1,
          killed: 1,
          remaining: 0,
          covered0: 0,
          cacheIndependent: false,
          reason: null
        })
      )
      const runAgentFix = vi.fn(async (_rule, _prompt, _cwd, options) => {
        await options.verify({ touchedFiles: ['/proj/tests/util.test.mjs'] })
        return { touchedFiles: ['/proj/tests/util.test.mjs'], rollback: vi.fn() }
      })

      const result = await fixSurvivedMutants(survived, ROOT, { runAgentFix, verifyMutation, recordDurableWrite })

      expect(result.fixed).toEqual(['/proj/tests/util.test.mjs'])
      expect(recordDurableWrite).not.toHaveBeenCalled()
      logSpy.mockRestore()
    })

    it('дробить oversized source-file, зберігає source read-only і друкує timeout verdict без prompt-а', async () => {
      env.N_CURSOR_COVERAGE_FIX_BATCH_MUTANTS = '40'
      readFile.mockResolvedValue('const secret = true')
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => null)
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => null)
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(10_000)
      const runAgentFix = vi.fn().mockResolvedValue({
        touchedFiles: [],
        error: 'fix timeout 95999ms',
        telemetry: {
          promptChars: 4321,
          wallMs: 95_999,
          turnCount: 2,
          toolCallCount: 1,
          turns: [{ finish: 'length' }],
          edits: [{ path: '/proj/tests/constants.test.mjs' }],
          blocks: [{ path: '/proj/run/api/src/constants.js', reason: 'test-generation' }],
          backstopHit: false
        }
      })

      const result = await fixSurvivedMutants([groupWith('run/api/src/constants.js', 82)], ROOT, {
        runAgentFix,
        timeoutMs: 120_000,
        coverageTimeout: {
          requestedMs: 150_000,
          workerDeadlineMs: 120_000,
          effectiveHookTimeoutMs: 120_000,
          survivedBatchesPerRung: 1
        }
      })

      expect(runAgentFix).toHaveBeenCalledTimes(1)
      expect(runAgentFix.mock.calls.every(call => call[3].sourceFiles[0] === 'run/api/src/constants.js')).toBe(true)
      expect(result.failed[0]).toMatchObject({ files: ['run/api/src/constants.js'], error: 'fix timeout 95999ms' })
      expect(result.failed).toHaveLength(1)
      expect(result.deferred).toHaveLength(4)
      expect(result.deferred.every(batch => batch.reason === 'one survived-mutant batch per rung')).toBe(true)
      expect(result.batches).toHaveLength(1)
      expect(result.batches[0]).toMatchObject({
        batch: 1,
        sourceFileCount: 1,
        mutantCount: 20,
        configuredBudget: 40,
        oversizedSourceFile: true,
        oversizedAtomicFile: false,
        oversizedSubBatch: true,
        oversizedSubBatchMutantLimit: 20,
        oversizedFiles: ['run/api/src/constants.js'],
        promptChars: 4321,
        requestedTimeoutMs: 150_000,
        workerDeadlineMs: 120_000,
        effectiveTimeoutMs: 120_000,
        wallMs: 95_999,
        verdict: {
          turnCount: 2,
          toolCallCount: 1,
          stopReasons: ['length'],
          error: 'fix timeout 95999ms',
          allowedTestWrites: 1,
          blockedWrites: 1,
          backstopHit: false
        }
      })
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('promptChars=4321'))
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('4 deferred'))
      expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('const secret = true'))
      nowSpy.mockRestore()
      logSpy.mockRestore()
      errSpy.mockRestore()
    })

    it('honors N_CURSOR_COVERAGE_FIX_BATCH_MUTANTS override', async () => {
      env.N_CURSOR_COVERAGE_FIX_BATCH_MUTANTS = '3'
      readFile.mockResolvedValue('const x = true')
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {
        return
      })
      const runAgentFix = vi.fn(() => Promise.resolve({ touchedFiles: [] }))
      const groups = [groupWith('a.js', 2), groupWith('b.js', 2)]

      await fixSurvivedMutants(groups, ROOT, { runAgentFix })

      expect(runAgentFix).toHaveBeenCalledTimes(2)
      logSpy.mockRestore()
    })
  })

  describe('buildFixPrompt', () => {
    it('contains mutant details', async () => {
      readFile.mockResolvedValue('line1\nline2\nline3\nline4\nline5\nline6\n')
      const prompt = await buildFixPrompt(survived, ROOT)
      expect(prompt).toContain('src/util.js')
      expect(prompt).toContain('Рядок 5')
      expect(prompt).toContain('true')
      expect(prompt).toContain('false')
      expect(prompt).toContain('лише як контекст')
      expect(prompt).toContain('Vitest mock/stub')
    })

    it('handles missing source file gracefully', async () => {
      readFile.mockRejectedValue(new Error('ENOENT'))
      const prompt = await buildFixPrompt(survived, ROOT)
      expect(prompt).toContain('src/util.js')
    })
  })
})

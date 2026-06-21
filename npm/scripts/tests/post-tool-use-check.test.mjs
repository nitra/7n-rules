/**
 * Тести `post-tool-use-check`: extractFilePath + CLI entry.
 *
 * Хук після редагування файлу робить read-only детект конформності всіх правил —
 * пряма `runConformanceCheck` (без subprocess). У тестах інжектимо `runConformanceCheckFn`.
 */
import { describe, expect, vi, test } from 'vitest'

import { extractFilePath, runPostToolUseCheckCli } from '../post-tool-use-check.mjs'

const EDIT = JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: 'src/foo.mjs' } })

describe('extractFilePath', () => {
  test('дістає tool_input.file_path', () => {
    expect(extractFilePath(JSON.stringify({ tool_input: { file_path: 'src/a.mjs' } }))).toBe('src/a.mjs')
  })
  test('відсутнє поле / порожній / невалідний → null', () => {
    expect(extractFilePath(JSON.stringify({ tool_input: { command: 'echo' } }))).toBeNull()
    expect(extractFilePath('')).toBeNull()
    expect(extractFilePath('not-json')).toBeNull()
  })
})

describe('runPostToolUseCheckCli', () => {
  test('file_path + конформність чиста → 0', async () => {
    const runConformanceCheckFn = vi.fn(async () => ({ total: 5, failed: 0, rules: [] }))
    const code = await runPostToolUseCheckCli({ stdinJson: EDIT, runConformanceCheckFn })
    expect(code).toBe(0)
    expect(runConformanceCheckFn).toHaveBeenCalledTimes(1)
    expect(runConformanceCheckFn.mock.calls[0][0]).toEqual([]) // усі правила, без фільтра
  })

  test('file_path + є порушення → 1', async () => {
    const runConformanceCheckFn = vi.fn(async () => ({
      total: 2,
      failed: 1,
      rules: [{ ruleId: 'ga', ok: false, output: 'bad' }]
    }))
    const code = await runPostToolUseCheckCli({ stdinJson: EDIT, runConformanceCheckFn })
    expect(code).toBe(1)
  })

  test('немає file_path (Bash) → 0, без перевірки', async () => {
    const runConformanceCheckFn = vi.fn()
    const code = await runPostToolUseCheckCli({
      stdinJson: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'echo' } }),
      runConformanceCheckFn
    })
    expect(code).toBe(0)
    expect(runConformanceCheckFn).not.toHaveBeenCalled()
  })

  test('порожній / невалідний stdin → 0, без перевірки', async () => {
    const runConformanceCheckFn = vi.fn()
    expect(await runPostToolUseCheckCli({ stdinJson: '', runConformanceCheckFn })).toBe(0)
    expect(await runPostToolUseCheckCli({ stdinJson: 'not-json', runConformanceCheckFn })).toBe(0)
    expect(runConformanceCheckFn).not.toHaveBeenCalled()
  })

  test('runConformanceCheck кидає → 1', async () => {
    const runConformanceCheckFn = vi.fn(async () => {
      throw new Error('boom')
    })
    expect(await runPostToolUseCheckCli({ stdinJson: EDIT, runConformanceCheckFn })).toBe(1)
  })

  test('process.stdin.isTTY → 0, без перевірки', async () => {
    const desc = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true, writable: true })
    try {
      const runConformanceCheckFn = vi.fn()
      expect(await runPostToolUseCheckCli({ runConformanceCheckFn })).toBe(0)
      expect(runConformanceCheckFn).not.toHaveBeenCalled()
    } finally {
      if (desc) Object.defineProperty(process.stdin, 'isTTY', desc)
      else delete process.stdin.isTTY
    }
  })
})

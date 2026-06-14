/**
 * Тести `post-tool-use-fix`: extractFilePath + CLI entry.
 *
 * Хук після редагування файлу робить read-only детект конформності всіх правил —
 * пряма `runFixCheck` (без subprocess). У тестах інжектимо `runFixCheckFn`.
 */
import { describe, expect, vi, test } from 'vitest'

import { extractFilePath, runPostToolUseFixCli } from '../post-tool-use-fix.mjs'

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

describe('runPostToolUseFixCli', () => {
  test('file_path + конформність чиста → 0', async () => {
    const runFixCheckFn = vi.fn(async () => ({ total: 5, failed: 0, rules: [] }))
    const code = await runPostToolUseFixCli({ stdinJson: EDIT, runFixCheckFn })
    expect(code).toBe(0)
    expect(runFixCheckFn).toHaveBeenCalledTimes(1)
    expect(runFixCheckFn.mock.calls[0][0]).toEqual([]) // усі правила, без фільтра
  })

  test('file_path + є порушення → 1', async () => {
    const runFixCheckFn = vi.fn(async () => ({
      total: 2,
      failed: 1,
      rules: [{ ruleId: 'ga', ok: false, output: 'bad' }]
    }))
    const code = await runPostToolUseFixCli({ stdinJson: EDIT, runFixCheckFn })
    expect(code).toBe(1)
  })

  test('немає file_path (Bash) → 0, без перевірки', async () => {
    const runFixCheckFn = vi.fn()
    const code = await runPostToolUseFixCli({
      stdinJson: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'echo' } }),
      runFixCheckFn
    })
    expect(code).toBe(0)
    expect(runFixCheckFn).not.toHaveBeenCalled()
  })

  test('порожній / невалідний stdin → 0, без перевірки', async () => {
    const runFixCheckFn = vi.fn()
    expect(await runPostToolUseFixCli({ stdinJson: '', runFixCheckFn })).toBe(0)
    expect(await runPostToolUseFixCli({ stdinJson: 'not-json', runFixCheckFn })).toBe(0)
    expect(runFixCheckFn).not.toHaveBeenCalled()
  })

  test('runFixCheck кидає → 1', async () => {
    const runFixCheckFn = vi.fn(async () => {
      throw new Error('boom')
    })
    expect(await runPostToolUseFixCli({ stdinJson: EDIT, runFixCheckFn })).toBe(1)
  })

  test('process.stdin.isTTY → 0, без перевірки', async () => {
    const desc = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true, writable: true })
    try {
      const runFixCheckFn = vi.fn()
      expect(await runPostToolUseFixCli({ runFixCheckFn })).toBe(0)
      expect(runFixCheckFn).not.toHaveBeenCalled()
    } finally {
      if (desc) Object.defineProperty(process.stdin, 'isTTY', desc)
      else delete process.stdin.isTTY
    }
  })
})

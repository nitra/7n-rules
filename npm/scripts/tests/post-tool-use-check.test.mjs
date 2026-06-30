/**
 * Тести `post-tool-use-check`: extractFilePath + CLI entry.
 *
 * Хук після редагування файлу робить read-only per-file детект (unified lint surface) —
 * пряма `detectAll({ files: [fp] })`. У тестах інжектимо `detectFn`.
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
  test('file_path + детект чистий → 0', async () => {
    const detectFn = vi.fn(async () => ({ violations: [], exitCode: 0 }))
    const code = await runPostToolUseCheckCli({ stdinJson: EDIT, detectFn })
    expect(code).toBe(0)
    expect(detectFn).toHaveBeenCalledTimes(1)
    expect(detectFn.mock.calls[0][0].files).toEqual(['src/foo.mjs']) // per-file детект зміненого
  })

  test('file_path + є порушення → 1', async () => {
    const detectFn = vi.fn(async () => ({ violations: [{ reason: 'x', message: 'bad' }], exitCode: 1 }))
    const code = await runPostToolUseCheckCli({ stdinJson: EDIT, detectFn })
    expect(code).toBe(1)
  })

  test('немає file_path (Bash) → 0, без детекту', async () => {
    const detectFn = vi.fn()
    const code = await runPostToolUseCheckCli({
      stdinJson: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'echo' } }),
      detectFn
    })
    expect(code).toBe(0)
    expect(detectFn).not.toHaveBeenCalled()
  })

  test('порожній / невалідний stdin → 0, без детекту', async () => {
    const detectFn = vi.fn()
    expect(await runPostToolUseCheckCli({ stdinJson: '', detectFn })).toBe(0)
    expect(await runPostToolUseCheckCli({ stdinJson: 'not-json', detectFn })).toBe(0)
    expect(detectFn).not.toHaveBeenCalled()
  })

  test('detect кидає → 1', async () => {
    const detectFn = vi.fn(async () => {
      throw new Error('boom')
    })
    expect(await runPostToolUseCheckCli({ stdinJson: EDIT, detectFn })).toBe(1)
  })

  test('process.stdin.isTTY → 0, без детекту', async () => {
    const desc = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true, writable: true })
    try {
      const detectFn = vi.fn()
      expect(await runPostToolUseCheckCli({ detectFn })).toBe(0)
      expect(detectFn).not.toHaveBeenCalled()
    } finally {
      if (desc) Object.defineProperty(process.stdin, 'isTTY', desc)
      else delete process.stdin.isTTY
    }
  })
})

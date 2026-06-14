/**
 * Тести `post-tool-use-fix`: extractFilePath + CLI entry.
 *
 * Хук більше не маршрутизує файл у правила — після будь-якого редагування файлу робить
 * один read-only детект конформності всіх правил (`_fix-check`).
 *
 * `runPostToolUseFixCli({ stdinJson, spawnFn })` — entry для `npx \@nitra/cursor post-tool-use-fix`:
 * парсить stdin JSON, і якщо є `tool_input.file_path` — spawn'ить `npx \@nitra/cursor _fix-check`.
 */
import { describe, expect, vi, test } from 'vitest'
import { EventEmitter } from 'node:events'

import { extractFilePath, runPostToolUseFixCli } from '../post-tool-use-fix.mjs'

/**
 * Будує мінімальний EventEmitter-сумісний "child", що асинхронно надсилає `exit`.
 * @param {number} exitCode код, який надіслати в `exit`
 * @returns {EventEmitter} fake child
 */
function makeFakeChild(exitCode) {
  // oxlint-disable-next-line unicorn/prefer-event-target -- node:events.once() приймає лише EventEmitter, не EventTarget
  const child = new EventEmitter()
  setImmediate(() => child.emit('exit', exitCode))
  return child
}

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
  test('коли є file_path → spawn `npx @nitra/cursor _fix-check` і повертає його код', async () => {
    const spawnFn = vi.fn(() => makeFakeChild(0))
    const stdinJson = JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: 'src/foo.mjs' } })
    const code = await runPostToolUseFixCli({ stdinJson, spawnFn })
    expect(code).toBe(0)
    expect(spawnFn).toHaveBeenCalledTimes(1)
    const [cmd, args] = spawnFn.mock.calls[0]
    expect(cmd).toBe('npx')
    expect(args).toEqual(['--no', '@nitra/cursor', '_fix-check'])
  })

  test('будь-яке розширення з file_path тригерить детект (без роутингу)', async () => {
    const spawnFn = vi.fn(() => makeFakeChild(0))
    const stdinJson = JSON.stringify({ tool_name: 'Write', tool_input: { file_path: 'LICENSE' } })
    await runPostToolUseFixCli({ stdinJson, spawnFn })
    expect(spawnFn).toHaveBeenCalledTimes(1)
    expect(spawnFn.mock.calls[0][1]).toEqual(['--no', '@nitra/cursor', '_fix-check'])
  })

  test('коли stdin порожній — exit 0, без spawn', async () => {
    const spawnFn = vi.fn(() => makeFakeChild(0))
    const code = await runPostToolUseFixCli({ stdinJson: '', spawnFn })
    expect(code).toBe(0)
    expect(spawnFn).not.toHaveBeenCalled()
  })

  test('коли stdin невалідний JSON — exit 0, без spawn', async () => {
    const spawnFn = vi.fn(() => makeFakeChild(1))
    const code = await runPostToolUseFixCli({ stdinJson: 'not-json', spawnFn })
    expect(code).toBe(0)
    expect(spawnFn).not.toHaveBeenCalled()
  })

  test('коли tool_input.file_path відсутній (Bash) — exit 0, без spawn', async () => {
    const spawnFn = vi.fn(() => makeFakeChild(1))
    const stdinJson = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'echo' } })
    const code = await runPostToolUseFixCli({ stdinJson, spawnFn })
    expect(code).toBe(0)
    expect(spawnFn).not.toHaveBeenCalled()
  })

  test('код виходу `_fix-check` передається назовні', async () => {
    const spawnFn = vi.fn(() => makeFakeChild(1))
    const stdinJson = JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: 'foo.mjs' } })
    const code = await runPostToolUseFixCli({ stdinJson, spawnFn })
    expect(code).toBe(1)
  })

  test('повертає 1 коли once(child, exit) відхиляється (error від child)', async () => {
    const stdinJson = JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: 'src/foo.mjs' } })
    // oxlint-disable-next-line unicorn/prefer-event-target -- мокаємо ChildProcess, який сам є EventEmitter (Node API), а не EventTarget
    const errorChild = new EventEmitter()
    setImmediate(() => errorChild.emit('error', new Error('spawn failed')))
    const spawnFn = vi.fn(() => errorChild)
    const code = await runPostToolUseFixCli({ stdinJson, spawnFn })
    expect(code).toBe(1)
  })

  test('readStdin повертає "" коли process.stdin.isTTY → exit 0', async () => {
    const desc = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true, writable: true })
    try {
      const spawnFn = vi.fn()
      const code = await runPostToolUseFixCli({ spawnFn })
      expect(code).toBe(0)
      expect(spawnFn).not.toHaveBeenCalled()
    } finally {
      if (desc) {
        Object.defineProperty(process.stdin, 'isTTY', desc)
      } else {
        delete process.stdin.isTTY
      }
    }
  })

  test('readStdin читає з не-TTY stdin (без file_path → no spawn)', async () => {
    const { Readable } = await import('node:stream')
    const payload = JSON.stringify({ tool_input: { command: 'echo' } })
    const fakeStdin = Object.assign(Readable.from([payload]), { isTTY: undefined })
    const savedDesc = Object.getOwnPropertyDescriptor(process, 'stdin')
    Object.defineProperty(process, 'stdin', { value: fakeStdin, configurable: true, writable: true })
    try {
      const spawnFn = vi.fn()
      const code = await runPostToolUseFixCli({ spawnFn })
      expect(code).toBe(0)
      expect(spawnFn).not.toHaveBeenCalled()
    } finally {
      if (savedDesc) Object.defineProperty(process, 'stdin', savedDesc)
    }
  })
})

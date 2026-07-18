/**
 * Тести run-shellcheck.mjs: edge cases i error paths.
 * patch не знайдено, немає .sh-файлів, spawnAsync-помилки (mock).
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

import { listShellScriptPaths, runShellcheckText } from '../run-shellcheck/main.mjs'
import { resolveCmd } from '../../../scripts/utils/resolve-cmd.mjs'
import { withTmpDir } from '../../../scripts/utils/test-helpers.mjs'

// resolveCmd('shellcheck'/'patch'/'git') лишається на реальному spawnSync (out-of-scope
// hand-written "which"-хелпер) — цей мок потрібен лише тесту "patch absent", щоб
// детерміновано підробити відсутність `patch` незалежно від реального PATH середовища.
vi.mock('node:child_process', async () => {
  const actual = await vi.importActual('node:child_process')
  return { ...actual, spawnSync: vi.fn(actual.spawnSync) }
})

// Самі виклики git/shellcheck/patch у main.mjs мігровані на spawnAsync (ADR 260716-1354) —
// саме його підміняємо мок-версією для симуляції результатів/помилок зовнішніх інструментів.
vi.mock('../../../scripts/utils/spawn-async.mjs', async () => {
  const actual = await vi.importActual('../../../scripts/utils/spawn-async.mjs')
  return { ...actual, spawnAsync: vi.fn(actual.spawnAsync) }
})
const { spawnAsync } = await import('../../../scripts/utils/spawn-async.mjs')

describe('run-shellcheck error paths', () => {
  afterEach(() => vi.clearAllMocks())

  test('runShellcheckText returns 1 + prints patch hint when patch absent (lines 53, 110-111)', async () => {
    if (!resolveCmd('shellcheck')) {
      expect(resolveCmd('shellcheck')).toBeFalsy()
      return
    }
    const actual = await vi.importActual('node:child_process')
    vi.mocked(spawnSync)
      .mockImplementationOnce(actual.spawnSync) // which shellcheck -> real (found)
      .mockReturnValueOnce({ status: 1, stdout: '', stderr: '', error: null, pid: 0, signal: null }) // which patch -> not found
    const errLines = []
    const origErr = process.stderr.write.bind(process.stderr)
    process.stderr.write = chunk => {
      errLines.push(String(chunk))
      return true
    }
    let code
    try {
      await withTmpDir(async dir => {
        await writeFile(join(dir, 'a.sh'), '#!/bin/sh\necho ok\n', 'utf8')
        code = await runShellcheckText(dir)
      })
    } finally {
      process.stderr.write = origErr
    }
    expect(code).toBe(1)
    expect(errLines.join('')).toContain('patch')
  })

  test('runShellcheckText returns 0 when no .sh files (line 116)', async () => {
    if (!resolveCmd('shellcheck') || !resolveCmd('patch')) {
      expect(resolveCmd('shellcheck') && resolveCmd('patch')).toBeFalsy()
      return
    }
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'readme.txt'), 'hello\n', 'utf8')
      expect(await runShellcheckText(dir)).toBe(0)
    })
  })

  test('listShellScriptPaths: git ls-files non-0 status => [] (line 82)', async () => {
    vi.mocked(spawnAsync)
      .mockResolvedValueOnce({
        stdout: 'true\n',
        stderr: '',
        exitCode: 0,
        signal: null,
        timedOut: false,
        aborted: false
      }) // rev-parse
      .mockResolvedValueOnce({
        stdout: '',
        stderr: 'error',
        exitCode: 1,
        signal: null,
        timedOut: false,
        aborted: false
      }) // ls-files fails
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'a.sh'), '#!/bin/sh\necho ok\n', 'utf8')
      const result = await listShellScriptPaths(dir)
      expect(result).toEqual([])
    })
  })

  test('autofixOneFile: diffResult spawn-помилка => stderr + return 1 (lines 145-146)', async () => {
    if (!resolveCmd('shellcheck') || !resolveCmd('patch')) {
      expect(resolveCmd('shellcheck') && resolveCmd('patch')).toBeFalsy()
      return
    }
    vi.mocked(spawnAsync)
      .mockResolvedValueOnce({
        stdout: 'true\n',
        stderr: '',
        exitCode: 0,
        signal: null,
        timedOut: false,
        aborted: false
      }) // rev-parse
      .mockResolvedValueOnce({
        stdout: 'x.sh\0',
        stderr: '',
        exitCode: 0,
        signal: null,
        timedOut: false,
        aborted: false
      }) // ls-files
      .mockRejectedValueOnce(new Error('mock shellcheck ENOENT')) // shellcheck -f diff -> spawn error
    const errLines = []
    const origErr = process.stderr.write.bind(process.stderr)
    process.stderr.write = chunk => {
      errLines.push(String(chunk))
      return true
    }
    let code
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'x.sh'), '#!/bin/sh\necho ok\n', 'utf8')
      try {
        code = await runShellcheckText(dir)
      } finally {
        process.stderr.write = origErr
      }
    })
    expect(code).toBe(1)
    expect(errLines.join('')).toContain('mock shellcheck ENOENT')
  })

  test('runFinalShellcheck: finalRun spawn-помилка => stderr + return 1 (lines 209-210)', async () => {
    if (!resolveCmd('shellcheck') || !resolveCmd('patch')) {
      expect(resolveCmd('shellcheck') && resolveCmd('patch')).toBeFalsy()
      return
    }
    vi.mocked(spawnAsync)
      .mockResolvedValueOnce({
        stdout: 'true\n',
        stderr: '',
        exitCode: 0,
        signal: null,
        timedOut: false,
        aborted: false
      }) // rev-parse
      .mockResolvedValueOnce({
        stdout: 'x.sh\0',
        stderr: '',
        exitCode: 0,
        signal: null,
        timedOut: false,
        aborted: false
      }) // ls-files
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0, signal: null, timedOut: false, aborted: false }) // shellcheck -f diff (clean, no fixes)
      .mockRejectedValueOnce(new Error('mock final shellcheck ENOENT')) // final shellcheck call -> spawn error
    const errLines = []
    const origErr = process.stderr.write.bind(process.stderr)
    process.stderr.write = chunk => {
      errLines.push(String(chunk))
      return true
    }
    let code
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'x.sh'), '#!/bin/sh\necho ok\n', 'utf8')
      try {
        code = await runShellcheckText(dir)
      } finally {
        process.stderr.write = origErr
      }
    })
    expect(code).toBe(1)
    expect(errLines.join('')).toContain('mock final shellcheck ENOENT')
  })

  test('applyShellcheckDiff: patch fails => stderr + return 1 (lines 186-188)', async () => {
    if (!resolveCmd('shellcheck') || !resolveCmd('patch')) {
      expect(resolveCmd('shellcheck') && resolveCmd('patch')).toBeFalsy()
      return
    }
    vi.mocked(spawnAsync)
      .mockResolvedValueOnce({
        stdout: 'true\n',
        stderr: '',
        exitCode: 0,
        signal: null,
        timedOut: false,
        aborted: false
      }) // rev-parse
      .mockResolvedValueOnce({
        stdout: 'x.sh\0',
        stderr: '',
        exitCode: 0,
        signal: null,
        timedOut: false,
        aborted: false
      }) // ls-files
      .mockResolvedValueOnce({
        // shellcheck -f diff -> non-empty diff (has autofixable issues)
        stdout: '--- a/x.sh\n+++ b/x.sh\n@@ -1 +1 @@\n-echo $1\n+echo "$1"\n',
        stderr: '',
        exitCode: 1,
        signal: null,
        timedOut: false,
        aborted: false
      })
      .mockResolvedValueOnce({
        // patch -p1 -> fails
        stdout: 'patch failed output\n',
        stderr: 'patch error msg\n',
        exitCode: 1,
        signal: null,
        timedOut: false,
        aborted: false
      })
    const errLines = []
    const origErr = process.stderr.write.bind(process.stderr)
    process.stderr.write = chunk => {
      errLines.push(String(chunk))
      return true
    }
    let code
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'x.sh'), '#!/bin/sh\necho $1\n', 'utf8')
      try {
        code = await runShellcheckText(dir)
      } finally {
        process.stderr.write = origErr
      }
    })
    expect(code).toBe(1)
    expect(errLines.join('')).toContain('patch')
  })
})

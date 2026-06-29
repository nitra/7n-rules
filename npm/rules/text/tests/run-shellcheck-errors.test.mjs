/**
 * Тести run-shellcheck.mjs: edge cases i error paths.
 * patch не знайдено, немає .sh-файлів, spawnSync-помилки (mock).
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

import { listShellScriptPaths, runShellcheckText } from '../run-shellcheck/main.mjs'
import { resolveCmd } from '../../../scripts/utils/resolve-cmd.mjs'
import { withTmpDir } from '../../../scripts/utils/test-helpers.mjs'

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual('node:child_process')
  return { ...actual, spawnSync: vi.fn(actual.spawnSync) }
})

describe('run-shellcheck error paths', () => {
  afterEach(() => vi.clearAllMocks())

  test('runShellcheckText returns 1 + prints patch hint when patch absent (lines 53, 110-111)', async () => {
    if (!resolveCmd('shellcheck')) {
      expect(true).toBe(true)
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
        code = runShellcheckText(dir)
      })
    } finally {
      process.stderr.write = origErr
    }
    expect(code).toBe(1)
    expect(errLines.join('')).toContain('patch')
  })

  test('runShellcheckText returns 0 when no .sh files (line 116)', async () => {
    if (!resolveCmd('shellcheck') || !resolveCmd('patch')) {
      expect(true).toBe(true)
      return
    }
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'readme.txt'), 'hello\n', 'utf8')
      expect(runShellcheckText(dir)).toBe(0)
    })
  })

  test('listShellScriptPaths: git ls-files non-0 status => [] (line 82)', async () => {
    const actual = await vi.importActual('node:child_process')
    vi.mocked(spawnSync)
      .mockImplementationOnce(actual.spawnSync) // which git
      .mockReturnValueOnce({ status: 0, stdout: 'true\n', stderr: '', error: null, pid: 0, signal: null }) // rev-parse
      .mockReturnValueOnce({ status: 1, stdout: '', stderr: 'error', error: null, pid: 0, signal: null }) // ls-files fails
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'a.sh'), '#!/bin/sh\necho ok\n', 'utf8')
      const result = listShellScriptPaths(dir)
      expect(result).toEqual([])
    })
  })

  test('autofixOneFile: diffResult.error => stderr + return 1 (lines 145-146)', async () => {
    if (!resolveCmd('shellcheck') || !resolveCmd('patch')) {
      expect(true).toBe(true)
      return
    }
    const actual = await vi.importActual('node:child_process')
    vi.mocked(spawnSync)
      .mockImplementationOnce(actual.spawnSync) // which shellcheck
      .mockImplementationOnce(actual.spawnSync) // which patch
      .mockImplementationOnce(actual.spawnSync) // which git
      .mockReturnValueOnce({ status: 0, stdout: 'true\n', stderr: '', error: null, pid: 0, signal: null }) // rev-parse
      .mockReturnValueOnce({ status: 0, stdout: 'x.sh\0', stderr: '', error: null, pid: 0, signal: null }) // ls-files
      .mockReturnValueOnce({
        // shellcheck -f diff -> spawn error
        error: new Error('mock shellcheck ENOENT'),
        status: null,
        stdout: '',
        stderr: '',
        pid: 0,
        signal: null
      })
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
        code = runShellcheckText(dir)
      } finally {
        process.stderr.write = origErr
      }
    })
    expect(code).toBe(1)
    expect(errLines.join('')).toContain('mock shellcheck ENOENT')
  })

  test('runFinalShellcheck: finalRun.error => stderr + return 1 (lines 209-210)', async () => {
    if (!resolveCmd('shellcheck') || !resolveCmd('patch')) {
      expect(true).toBe(true)
      return
    }
    const actual = await vi.importActual('node:child_process')
    vi.mocked(spawnSync)
      .mockImplementationOnce(actual.spawnSync) // which shellcheck
      .mockImplementationOnce(actual.spawnSync) // which patch
      .mockImplementationOnce(actual.spawnSync) // which git
      .mockReturnValueOnce({ status: 0, stdout: 'true\n', stderr: '', error: null, pid: 0, signal: null }) // rev-parse
      .mockReturnValueOnce({ status: 0, stdout: 'x.sh\0', stderr: '', error: null, pid: 0, signal: null }) // ls-files
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '', error: null, pid: 0, signal: null }) // shellcheck -f diff (clean, no fixes)
      .mockReturnValueOnce({
        // final shellcheck call -> spawn error
        error: new Error('mock final shellcheck ENOENT'),
        status: null,
        stdout: '',
        stderr: '',
        pid: 0,
        signal: null
      })
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
        code = runShellcheckText(dir)
      } finally {
        process.stderr.write = origErr
      }
    })
    expect(code).toBe(1)
    expect(errLines.join('')).toContain('mock final shellcheck ENOENT')
  })

  test('applyShellcheckDiff: patch fails => stderr + return 1 (lines 186-188)', async () => {
    if (!resolveCmd('shellcheck') || !resolveCmd('patch')) {
      expect(true).toBe(true)
      return
    }
    const actual = await vi.importActual('node:child_process')
    vi.mocked(spawnSync)
      .mockImplementationOnce(actual.spawnSync) // which shellcheck
      .mockImplementationOnce(actual.spawnSync) // which patch
      .mockImplementationOnce(actual.spawnSync) // which git
      .mockReturnValueOnce({ status: 0, stdout: 'true\n', stderr: '', error: null, pid: 0, signal: null }) // rev-parse
      .mockReturnValueOnce({ status: 0, stdout: 'x.sh\0', stderr: '', error: null, pid: 0, signal: null }) // ls-files
      .mockReturnValueOnce({
        // shellcheck -f diff -> non-empty diff (has autofixable issues)
        status: 1,
        stdout: '--- a/x.sh\n+++ b/x.sh\n@@ -1 +1 @@\n-echo $1\n+echo "$1"\n',
        stderr: '',
        error: null,
        pid: 0,
        signal: null
      })
      .mockReturnValueOnce({
        // patch -p1 -> fails
        status: 1,
        stdout: 'patch failed output\n',
        stderr: 'patch error msg\n',
        error: null,
        pid: 0,
        signal: null
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
        code = runShellcheckText(dir)
      } finally {
        process.stderr.write = origErr
      }
    })
    expect(code).toBe(1)
    expect(errLines.join('')).toContain('patch')
  })
})

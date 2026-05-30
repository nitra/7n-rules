/**
 * Тести run-v8r.mjs: відсутній каталог схем (→2), помилка spawn (→1),
 * ненульовий exitCode з stdout/stderr (lines 44-48, 60-62, 66-73).
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

vi.mock('node:fs', async () => {
  const actual = await vi.importActual('node:fs')
  return { ...actual, existsSync: vi.fn(actual.existsSync) }
})

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual('node:child_process')
  return { ...actual, spawnSync: vi.fn(actual.spawnSync) }
})

const { runV8rWithGlobs } = await import('../run-v8r.mjs')

describe('runV8rWithGlobs — error paths', () => {
  afterEach(() => vi.clearAllMocks())

  test('existsSync → false → повертає 2 і пише в stderr (lines 44-48)', () => {
    vi.mocked(existsSync).mockReturnValueOnce(false)
    const errChunks = []
    const origErr = process.stderr.write.bind(process.stderr)
    process.stderr.write = chunk => { errChunks.push(String(chunk)); return true }
    let code
    try {
      code = runV8rWithGlobs(['**/*.json'])
    } finally {
      process.stderr.write = origErr
    }
    expect(code).toBe(2)
    expect(errChunks.join('')).toContain('каталог схем')
  })

  test('spawnSync.error → повертає 1 і пише в stderr (lines 60-62)', async () => {
    const actual = await vi.importActual('node:child_process')
    vi.mocked(spawnSync)
      .mockImplementationOnce(actual.spawnSync) // which bun → реальний
      .mockReturnValueOnce({
        error: new Error('mock spawn ENOENT'),
        status: null, stdout: '', stderr: '', pid: 0, signal: null
      })
    const errChunks = []
    const origErr = process.stderr.write.bind(process.stderr)
    process.stderr.write = chunk => { errChunks.push(String(chunk)); return true }
    let code
    try {
      code = runV8rWithGlobs(['**/*.json'])
    } finally {
      process.stderr.write = origErr
    }
    expect(code).toBe(1)
    expect(errChunks.join('')).toContain('mock spawn ENOENT')
  })

  test('exitCode=1 з stdout і stderr → виводить обидва і повертає exitCode (lines 66-73)', async () => {
    const actual = await vi.importActual('node:child_process')
    vi.mocked(spawnSync)
      .mockImplementationOnce(actual.spawnSync) // which bun → реальний
      .mockReturnValueOnce({
        error: null, status: 1,
        stdout: 'validation error output\n',
        stderr: 'v8r stderr msg\n',
        pid: 0, signal: null
      })
    const outChunks = []
    const errChunks = []
    const origOut = process.stdout.write.bind(process.stdout)
    const origErr = process.stderr.write.bind(process.stderr)
    process.stdout.write = chunk => { outChunks.push(String(chunk)); return true }
    process.stderr.write = chunk => { errChunks.push(String(chunk)); return true }
    let code
    try {
      code = runV8rWithGlobs(['**/*.json'])
    } finally {
      process.stdout.write = origOut
      process.stderr.write = origErr
    }
    expect(code).toBe(1)
    expect(outChunks.join('')).toContain('validation error output')
    expect(errChunks.join('')).toContain('v8r stderr msg')
  })

  test('exitCode=1 без stdout/stderr → повертає exitCode без виводу (line 73)', async () => {
    const actual = await vi.importActual('node:child_process')
    vi.mocked(spawnSync)
      .mockImplementationOnce(actual.spawnSync) // which bun → реальний
      .mockReturnValueOnce({
        error: null, status: 1, stdout: '', stderr: '', pid: 0, signal: null
      })
    const outChunks = []
    const origOut = process.stdout.write.bind(process.stdout)
    process.stdout.write = chunk => { outChunks.push(String(chunk)); return true }
    let code
    try {
      code = runV8rWithGlobs(['**/*.json'])
    } finally {
      process.stdout.write = origOut
    }
    expect(code).toBe(1)
    expect(outChunks.join('')).toBe('')
  })
})

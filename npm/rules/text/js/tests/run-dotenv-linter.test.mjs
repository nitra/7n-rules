/**
 * Тести run-dotenv-linter.mjs: авто-фікс і фінальний check через рекурсивний режим
 * `dotenv-linter` з виключенням `node_modules` і `.envrc`.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { chmod, readFile, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { delimiter, join } from 'node:path'
import { env, platform } from 'node:process'

import { runDotenvLinter } from '../run-dotenv-linter.mjs'
import { resolveCmd } from '../../../../scripts/utils/resolve-cmd.mjs'
import { ensureDir, withBinRemovedFromPath, withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual('node:child_process')
  return { ...actual, spawnSync: vi.fn(actual.spawnSync) }
})

/**
 * Додає до PATH тимчасову директорію з підробленим `dotenv-linter`.
 * fix → exit 0; check → stdout + exit 1.
 * @param {(dir: string) => Promise<void>} fn тестовий код, що приймає шлях до stub-PATH
 */
async function withFakeDotenvLinter(fn) {
  await withTmpDir(async binDir => {
    const isWin = platform === 'win32'
    const stub = join(binDir, isWin ? 'dotenv-linter.exe' : 'dotenv-linter')
    const script = isWin
      ? `@echo off\nif "%1"=="fix" exit 0\necho warning: duplicate key\nexit 1\n`
      : `#!/bin/sh\nif [ "$1" = "fix" ]; then exit 0; fi\nprintf 'warning: duplicate key\\n'\nexit 1\n`
    await writeFile(stub, script, 'utf8')
    if (!isWin) await chmod(stub, 0o755)
    const prevPath = env.PATH
    env.PATH = `${binDir}${delimiter}${prevPath ?? ''}`
    try {
      await fn(binDir)
    } finally {
      if (prevPath === undefined) {
        delete env.PATH
      } else {
        env.PATH = prevPath
      }
    }
  })
}

describe('run-dotenv-linter.mjs', () => {
  test('runDotenvLinter повертає 0 коли .env*-файлів немає', async () => {
    if (!resolveCmd('dotenv-linter')) {
      expect(true).toBe(true)
      return
    }
    await withTmpDir(dir => {
      expect(runDotenvLinter(dir)).toBe(0)
    })
  })

  test('runDotenvLinter авто-виправляє LowercaseKey і завершується з 0', async () => {
    if (!resolveCmd('dotenv-linter')) {
      expect(true).toBe(true)
      return
    }
    await withTmpDir(async dir => {
      await writeFile(join(dir, '.env'), 'foo=bar\n', 'utf8')
      expect(runDotenvLinter(dir)).toBe(0)
      const fixed = await readFile(join(dir, '.env'), 'utf8')
      expect(fixed).toContain('FOO=bar')
    })
  })

  test('runDotenvLinter не перевіряє файли в node_modules і .envrc', async () => {
    if (!resolveCmd('dotenv-linter')) {
      expect(true).toBe(true)
      return
    }
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'node_modules/pkg'))
      // у node_modules — навмисно битий .env (lowercase key); .envrc — direnv-синтаксис.
      await writeFile(join(dir, 'node_modules/pkg/.env'), 'bad=1\n', 'utf8')
      await writeFile(join(dir, '.envrc'), 'export FOO=bar\nsource_url "https://example.com"\n', 'utf8')
      // tracked-файл валідний — перевірка має пройти, попри присутність виключених шляхів.
      await writeFile(join(dir, '.env'), 'FOO=bar\n', 'utf8')
      expect(runDotenvLinter(dir)).toBe(0)
    })
  })

  test('runDotenvLinter повертає 1 і друкує підказки встановлення, якщо dotenv-linter відсутній у PATH (lines 61-62)', async () => {
    const errLines = []
    const origErr = process.stderr.write.bind(process.stderr)
    process.stderr.write = chunk => {
      errLines.push(chunk)
      return true
    }
    try {
      await withBinRemovedFromPath('dotenv-linter', async () => {
        await withTmpDir(dir => {
          const code = runDotenvLinter(dir)
          expect(code).toBe(1)
        })
      })
    } finally {
      process.stderr.write = origErr
    }
    const blob = errLines.join('')
    expect(blob).toContain('dotenv-linter')
    expect(blob).toContain('brew install')
  })

  test('runDotenvLinter повертає 1 і виводить stdout коли check знаходить порушення (lines 88-90)', async () => {
    const stdoutLines = []
    const origOut = process.stdout.write.bind(process.stdout)
    process.stdout.write = chunk => {
      stdoutLines.push(chunk)
      return true
    }
    try {
      await withFakeDotenvLinter(async () => {
        await withTmpDir(async dir => {
          await writeFile(join(dir, '.env'), 'FOO=bar\n', 'utf8')
          const code = runDotenvLinter(dir)
          expect(code).toBe(1)
        })
      })
    } finally {
      process.stdout.write = origOut
    }
    expect(stdoutLines.join('')).toContain('duplicate')
  })
})

describe('runDotenvLinter — spawnSync error paths', () => {
  afterEach(() => vi.clearAllMocks())

  test('default cwd = process.cwd() (line 57)', async () => {
    const errChunks = []
    const origErr = process.stderr.write.bind(process.stderr)
    process.stderr.write = chunk => {
      errChunks.push(String(chunk))
      return true
    }
    try {
      await withBinRemovedFromPath('dotenv-linter', () => {
        expect(runDotenvLinter()).toBe(1)
      })
    } finally {
      process.stderr.write = origErr
    }
    expect(errChunks.join('')).toContain('dotenv-linter')
  })

  test('fixRun.error → друкує у stderr і повертає 1 (lines 73-74)', async () => {
    const actual = await vi.importActual('node:child_process')
    vi.mocked(spawnSync)
      .mockImplementationOnce(actual.spawnSync) // which — проходить до реального
      .mockImplementationOnce(() => ({
        error: new Error('mock ENOENT fix'),
        status: null,
        stdout: '',
        stderr: '',
        pid: 0,
        signal: null
      }))

    const errChunks = []
    const origErr = process.stderr.write.bind(process.stderr)
    process.stderr.write = chunk => {
      errChunks.push(String(chunk))
      return true
    }
    try {
      await withFakeDotenvLinter(async () => {
        await withTmpDir(dir => {
          expect(runDotenvLinter(dir)).toBe(1)
        })
      })
    } finally {
      process.stderr.write = origErr
    }
    expect(errChunks.join('')).toContain('mock ENOENT fix')
  })

  test('checkRun.error → друкує у stderr і повертає 1 (lines 84-85)', async () => {
    const actual = await vi.importActual('node:child_process')
    vi.mocked(spawnSync)
      .mockImplementationOnce(actual.spawnSync) // which — проходить до реального
      .mockImplementationOnce(() => ({
        error: null,
        status: 0,
        stdout: '',
        stderr: '',
        pid: 0,
        signal: null
      })) // fix — успішно
      .mockImplementationOnce(() => ({
        error: new Error('mock ENOENT check'),
        status: null,
        stdout: '',
        stderr: '',
        pid: 0,
        signal: null
      })) // check — помилка spawn

    const errChunks = []
    const origErr = process.stderr.write.bind(process.stderr)
    process.stderr.write = chunk => {
      errChunks.push(String(chunk))
      return true
    }
    try {
      await withFakeDotenvLinter(async () => {
        await withTmpDir(dir => {
          expect(runDotenvLinter(dir)).toBe(1)
        })
      })
    } finally {
      process.stderr.write = origErr
    }
    expect(errChunks.join('')).toContain('mock ENOENT check')
  })
})

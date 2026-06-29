/**
 * Тест `runLintGaSteps` у `runLintGaCli`: коли `shellcheck` або `conftest` відсутні в PATH
 * і авто-install відключено — кидається виняток; коли `uv` відсутній — exit 1 через preflight.
 * Бінарники зі стабами у PATH → ensureTool знаходить їх і процес доходить до actionlint/zizmor.
 *
 * Тести використовують N_CURSOR_NO_AUTO_INSTALL=1, щоб уникнути реального brew/scoop/curl під час CI.
 */
import { describe, expect, test } from 'vitest'
import { chmod, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { env, platform } from 'node:process'

import { runLintGaCli } from '../workflows/main.mjs'

const SHELLCHECK_RE = /shellcheck/
const UV_RE = /uv/
const ASTRAL_UV_RE = /astral\.sh\/uv/

/**
 * Викликає `fn` під ізольованим `PATH` і N_CURSOR_NO_AUTO_INSTALL=1,
 * збираючи stderr і або exit-code, або виняток.
 * @param {() => Promise<number>} fn колбек
 * @returns {Promise<{ code?: number, error?: Error, errBlob: string }>} результат: exit-code, перехоплений виняток і зібраний stderr
 */
async function withIsolatedPath(fn) {
  const isolatedDir = await mkdtemp(join(tmpdir(), 'n-cursor-empty-path-'))
  const prevPath = env.PATH
  const prevNoInstall = env['N_CURSOR_NO_AUTO_INSTALL']
  env.PATH = isolatedDir
  env['N_CURSOR_NO_AUTO_INSTALL'] = '1'
  const errs = []
  const origErr = console.error
  const origLog = console.log
  console.error = (...args) => errs.push(args.join(' '))
  console.log = () => {
    /* noop: stdout не перевіряється */
  }
  let code
  let caughtError
  try {
    code = await fn()
  } catch (error) {
    caughtError = error
  } finally {
    console.error = origErr
    console.log = origLog
    if (prevPath === undefined) {
      delete env.PATH
    } else {
      env.PATH = prevPath
    }
    if (prevNoInstall === undefined) {
      delete env['N_CURSOR_NO_AUTO_INSTALL']
    } else {
      env['N_CURSOR_NO_AUTO_INSTALL'] = prevNoInstall
    }
    await rm(isolatedDir, { recursive: true, force: true })
  }
  return { code, error: caughtError, errBlob: errs.join('\n') }
}

describe('runLintGaCli', () => {
  test('кидає з підказкою shellcheck, коли бінарник відсутній і N_CURSOR_NO_AUTO_INSTALL=1', async () => {
    const { error } = await withIsolatedPath(runLintGaCli)
    expect(error).toBeDefined()
    expect(error?.message).toMatch(SHELLCHECK_RE)
  })

  test('exit 1 + підказка uv, коли shellcheck/conftest є, але uv відсутній', async () => {
    if (platform === 'win32') {
      expect(true).toBe(true)
      return
    }

    const binDir = await mkdtemp(join(tmpdir(), 'n-cursor-ga-stubs-'))
    // shellcheck і conftest є → ensureTool пройде; uv відсутній → preflight повертає false
    for (const name of ['shellcheck', 'conftest']) {
      const stub = join(binDir, name)
      await writeFile(stub, '#!/bin/sh\nexit 0\n', 'utf8')
      await chmod(stub, 0o755)
    }

    const prevPath = env.PATH
    env.PATH = `${binDir}:/usr/bin:/bin`
    const errs = []
    const origErr = console.error
    const origLog = console.log
    console.error = (...args) => errs.push(args.join(' '))
    console.log = () => {
      /* noop: stdout не перевіряється */
    }
    let code
    try {
      code = await runLintGaCli()
    } finally {
      console.error = origErr
      console.log = origLog
      env.PATH = prevPath
      await rm(binDir, { recursive: true, force: true })
    }
    expect(code).toBe(1)
    expect(errs.join('\n')).toMatch(UV_RE)
    expect(errs.join('\n')).toMatch(ASTRAL_UV_RE)
  })

  test('preflight OK — логує successMsg і доходить до actionlint (lines 129-130, 161-162)', async () => {
    if (platform === 'win32') {
      expect(true).toBe(true)
      return
    }

    const binDir = await mkdtemp(join(tmpdir(), 'n-cursor-ga-stubs-'))
    for (const name of ['shellcheck', 'uv', 'conftest']) {
      const stub = join(binDir, name)
      await writeFile(stub, '#!/bin/sh\nexit 0\n', 'utf8')
      await chmod(stub, 0o755)
    }

    const prevPath = env.PATH
    // bunx відсутній у PATH → actionlint поверне 127
    env.PATH = `${binDir}:/usr/bin:/bin`
    const logs = []
    const origLog = console.log
    const origErr = console.error
    console.log = (...args) => logs.push(args.join(' '))
    console.error = () => {
      /* noop: stderr не перевіряється в цьому тесті */
    }
    let code
    try {
      code = await runLintGaCli()
    } finally {
      console.log = origLog
      console.error = origErr
      env.PATH = prevPath
      await rm(binDir, { recursive: true, force: true })
    }
    // Preflight пройшов; actionlint (через bunx) → 127 (bunx відсутній)
    expect(code).toBe(127)
    expect(logs.some(l => l.includes('uv'))).toBe(true)
  })

  test('actionlint OK → досягає zizmor (lines 164-165)', async () => {
    if (platform === 'win32') {
      expect(true).toBe(true)
      return
    }

    const binDir = await mkdtemp(join(tmpdir(), 'n-cursor-ga-stubs-'))
    for (const name of ['shellcheck', 'uv', 'conftest', 'bunx']) {
      const stub = join(binDir, name)
      await writeFile(stub, '#!/bin/sh\nexit 0\n', 'utf8')
      await chmod(stub, 0o755)
    }

    const prevPath = env.PATH
    // uvx відсутній → zizmor поверне 127
    env.PATH = `${binDir}:/usr/bin:/bin`
    const origLog = console.log
    const origErr = console.error
    console.log = () => {
      /* noop: stdout не перевіряється в цьому тесті */
    }
    console.error = () => {
      /* noop: stderr не перевіряється в цьому тесті */
    }
    let code
    try {
      code = await runLintGaCli()
    } finally {
      console.log = origLog
      console.error = origErr
      env.PATH = prevPath
      await rm(binDir, { recursive: true, force: true })
    }
    // actionlint OK (bunx stub exit 0); zizmor (uvx) → 127 (uvx відсутній)
    expect(code).toBe(127)
  })
})

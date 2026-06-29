/**
 * Тест `runLintTextSteps` у `runLintTextCli`: коли `shellcheck` або `dotenv-linter` відсутні
 * в PATH і авто-install відключено — кидається виняток; коли `patch` відсутній — exit 1 через preflight.
 *
 * Тести використовують N_CURSOR_NO_AUTO_INSTALL=1, щоб уникнути реального brew/scoop/curl під час CI.
 */
import { describe, expect, test } from 'vitest'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { env, platform } from 'node:process'

import { runLintTextCli } from '../check/main.mjs'

const SHELLCHECK_RE = /shellcheck/
const DOTENV_LINTER_RE = /dotenv-linter/

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
    /* мовчимо: success-повідомлення preflight у тесті не цікавлять */
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
    if (prevPath === undefined) delete env.PATH
    else env.PATH = prevPath
    if (prevNoInstall === undefined) delete env['N_CURSOR_NO_AUTO_INSTALL']
    else env['N_CURSOR_NO_AUTO_INSTALL'] = prevNoInstall
    await rm(isolatedDir, { recursive: true, force: true })
  }
  return { code, error: caughtError, errBlob: errs.join('\n') }
}

describe('runLintTextCli', () => {
  test('кидає з підказкою shellcheck, коли бінарник відсутній і N_CURSOR_NO_AUTO_INSTALL=1', async () => {
    const { error } = await withIsolatedPath(runLintTextCli)
    expect(error).toBeDefined()
    expect(error?.message).toMatch(SHELLCHECK_RE)
  })

  test('підказка dotenv-linter в повідомленні, коли shellcheck є але dotenv-linter відсутній', async () => {
    // Перевіряє, що ensureTool кидає з посиланням на dotenv-linter коли shellcheck присутній,
    // але dotenv-linter відсутній і N_CURSOR_NO_AUTO_INSTALL=1
    if (platform === 'win32') {
      expect(true).toBe(true)
      return
    }

    const binDir = await mkdtemp(join(tmpdir(), 'n-cursor-preflight-stubs-'))
    const stub = join(binDir, 'shellcheck')
    await writeFile(stub, '#!/bin/sh\nexit 0\n', 'utf8')
    await chmod(stub, 0o755)

    const prevPath = env.PATH
    const prevNoInstall = env['N_CURSOR_NO_AUTO_INSTALL']
    // binDir + system paths: shellcheck знайдено в binDir, dotenv-linter відсутній ніде
    env.PATH = binDir + ':/usr/bin:/bin'
    env['N_CURSOR_NO_AUTO_INSTALL'] = '1'
    let caughtError
    const origLog = console.log
    console.log = () => {
      /* noop: stdout не перевіряється */
    }
    try {
      await runLintTextCli()
    } catch (error) {
      caughtError = error
    } finally {
      console.log = origLog
      env.PATH = prevPath
      if (prevNoInstall === undefined) delete env['N_CURSOR_NO_AUTO_INSTALL']
      else env['N_CURSOR_NO_AUTO_INSTALL'] = prevNoInstall
      await rm(binDir, { recursive: true, force: true })
    }
    expect(caughtError).toBeDefined()
    expect(caughtError?.message).toMatch(DOTENV_LINTER_RE)
  })

  test('preflight OK — логує successMsg і доходить до cspell (lines 119-120, 137-138)', async () => {
    if (platform === 'win32') {
      expect(true).toBe(true)
      return
    }

    // Стабові бінарники для shellcheck, patch, dotenv-linter (exit 0)
    const binDir = await mkdtemp(join(tmpdir(), 'n-cursor-preflight-stubs-'))
    for (const name of ['shellcheck', 'patch', 'dotenv-linter']) {
      const stub = join(binDir, name)
      await writeFile(stub, '#!/bin/sh\nexit 0\n', 'utf8')
      await chmod(stub, 0o755)
    }

    const prevPath = env.PATH
    // binDir перший, потім базові Unix-шляхи (щоб `which` знаходилося); npx/bunx відсутні
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
      code = await runLintTextCli()
    } finally {
      console.log = origLog
      console.error = origErr
      env.PATH = prevPath
      await rm(binDir, { recursive: true, force: true })
    }
    // Preflight пройшов (всі бінарники знайдено), cspell-крок → 1 (npx відсутній у runCspellText)
    expect(code).toBe(1)
    // successMsg від patch preflight
    expect(logs.some(l => l.includes('patch'))).toBe(true)
  })
})

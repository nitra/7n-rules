/**
 * Тест detector-а `lint(ctx)` у `check/main.mjs`: коли `shellcheck` або `dotenv-linter`
 * відсутні в PATH і авто-install відключено — `ensureTool` кидає виняток з підказкою.
 *
 * Тести використовують N_CURSOR_NO_AUTO_INSTALL=1, щоб уникнути реального brew/scoop/curl під час CI.
 */
import { describe, expect, test } from 'vitest'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { env, platform } from 'node:process'

import { lint } from '../check/main.mjs'

const SHELLCHECK_RE = /shellcheck/
const DOTENV_LINTER_RE = /dotenv-linter/

const CTX = { cwd: process.cwd(), ruleId: 'text', concernId: 'check', files: undefined }

/**
 * Викликає `lint(ctx)` під ізольованим `PATH` і N_CURSOR_NO_AUTO_INSTALL=1,
 * перехоплюючи виняток preflight (`ensureTool`).
 * @param {string} cwd корінь, який передати у ctx
 * @returns {Promise<{ result?: object, error?: Error }>} результат detector-а або перехоплений виняток
 */
async function withIsolatedPath(cwd) {
  const isolatedDir = await mkdtemp(join(tmpdir(), 'n-cursor-empty-path-'))
  const prevPath = env.PATH
  const prevNoInstall = env['N_CURSOR_NO_AUTO_INSTALL']
  env.PATH = isolatedDir
  env['N_CURSOR_NO_AUTO_INSTALL'] = '1'
  let result
  let caughtError
  try {
    result = await lint({ ...CTX, cwd })
  } catch (error) {
    caughtError = error
  } finally {
    if (prevPath === undefined) delete env.PATH
    else env.PATH = prevPath
    if (prevNoInstall === undefined) delete env['N_CURSOR_NO_AUTO_INSTALL']
    else env['N_CURSOR_NO_AUTO_INSTALL'] = prevNoInstall
    await rm(isolatedDir, { recursive: true, force: true })
  }
  return { result, error: caughtError }
}

describe('text.check lint(ctx)', () => {
  test('кидає з підказкою shellcheck, коли бінарник відсутній і N_CURSOR_NO_AUTO_INSTALL=1', async () => {
    const { error } = await withIsolatedPath(process.cwd())
    expect(error).toBeDefined()
    expect(error?.message).toMatch(SHELLCHECK_RE)
  })

  test('підказка dotenv-linter в повідомленні, коли shellcheck є але dotenv-linter відсутній', async () => {
    // Перевіряє, що ensureTool кидає з посиланням на dotenv-linter коли shellcheck присутній,
    // але dotenv-linter відсутній і N_CURSOR_NO_AUTO_INSTALL=1
    if (platform === 'win32') {
      expect(platform).toBe('win32')
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
    try {
      await lint({ ...CTX, cwd: process.cwd() })
    } catch (error) {
      caughtError = error
    } finally {
      env.PATH = prevPath
      if (prevNoInstall === undefined) delete env['N_CURSOR_NO_AUTO_INSTALL']
      else env['N_CURSOR_NO_AUTO_INSTALL'] = prevNoInstall
      await rm(binDir, { recursive: true, force: true })
    }
    expect(caughtError).toBeDefined()
    expect(caughtError?.message).toMatch(DOTENV_LINTER_RE)
  })
})

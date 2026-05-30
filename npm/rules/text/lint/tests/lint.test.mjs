/**
 * Тест preflight у `runLintTextCli`: коли `shellcheck`, `patch` і `dotenv-linter` відсутні
 * в PATH — exit 1 і підказки встановлення для кожного.
 */
import { describe, expect, test } from 'vitest'
import { chmod, mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { env, platform } from 'node:process'

import { runLintTextCli } from '../lint.mjs'

const BREW_INSTALL_SHELLCHECK_RE = /brew install shellcheck/
const APT_INSTALL_SHELLCHECK_RE = /apt-get install -y shellcheck/
const DOTENV_WORD_RE = /\bdotenv-linter\b/
const BREW_INSTALL_DOTENV_RE = /brew install dotenv-linter/
const GITIO_DOTENV_RE = /git\.io\/JLbXn/
const PATCH_WORD_RE = /\bpatch\b/

/**
 * Викликає `fn` під ізольованим `PATH` (тимчасова порожня директорія), збираючи stderr і exit-code.
 * Гарантує, що жоден preflight-binary не знайдеться, і відновлює `PATH` після виклику.
 * @param {() => number} fn колбек, який повертає очікуваний exit-code запуску CLI
 * @returns {Promise<{ code: number, errBlob: string }>} зібраний exit-code і об'єднаний stderr
 */
async function withIsolatedPath(fn) {
  const isolatedDir = await mkdtemp(join(tmpdir(), 'n-cursor-empty-path-'))
  const prevPath = env.PATH
  env.PATH = isolatedDir
  const errs = []
  const origErr = console.error
  const origLog = console.log
  console.error = (...args) => errs.push(args.join(' '))
  console.log = () => {
    /* мовчимо: success-повідомлення preflight у тесті не цікавлять */
  }
  try {
    const code = await fn()
    return { code, errBlob: errs.join('\n') }
  } finally {
    console.error = origErr
    console.log = origLog
    if (prevPath === undefined) delete env.PATH
    else env.PATH = prevPath
  }
}

describe('runLintTextCli', () => {
  test('exit 1 + підказки shellcheck, коли бінарники відсутні', async () => {
    const { code, errBlob } = await withIsolatedPath(runLintTextCli)
    expect(code).toBe(1)
    expect(errBlob).toMatch(BREW_INSTALL_SHELLCHECK_RE)
    expect(errBlob).toMatch(APT_INSTALL_SHELLCHECK_RE)
  })

  test('exit 1 + підказка dotenv-linter', async () => {
    const { code, errBlob } = await withIsolatedPath(runLintTextCli)
    expect(code).toBe(1)
    expect(errBlob).toMatch(DOTENV_WORD_RE)
    expect(errBlob).toMatch(BREW_INSTALL_DOTENV_RE)
    expect(errBlob).toMatch(GITIO_DOTENV_RE)
  })

  test('усі preflight повідомляються незалежно', async () => {
    const { errBlob } = await withIsolatedPath(runLintTextCli)
    expect(errBlob).toMatch(BREW_INSTALL_SHELLCHECK_RE)
    expect(errBlob).toMatch(PATCH_WORD_RE)
    expect(errBlob).toMatch(BREW_INSTALL_DOTENV_RE)
  })

  test('preflight OK — логує successMsg і доходить до cspell (lines 119-120, 137-138)', async () => {
    if (platform === 'win32') { expect(true).toBe(true); return }

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
    }
    // Preflight пройшов (всі бінарники знайдено), cspell → 127 (npx відсутній)
    expect(code).toBe(127)
    // successMsg від кожного preflight-бінарника
    expect(logs.some(l => l.includes('shellcheck'))).toBe(true)
    expect(logs.some(l => l.includes('dotenv-linter'))).toBe(true)
  })
})

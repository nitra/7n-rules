/**
 * Тест preflight у `runLintGaCli`: коли `shellcheck`, `uv` і `conftest` відсутні в PATH — exit 1,
 * причому друкуються підказки встановлення для кожного незалежно (а не лише для першого).
 *
 * Реальний `actionlint`/`zizmor` не запускаються — ми обриваємо потік ще на preflight, не доходячи до них.
 */
import { describe, expect, test } from 'vitest'
import { chmod, mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { env, platform } from 'node:process'

import { runLintGaCli } from '../lint.mjs'

const BREW_INSTALL_SHELLCHECK_RE = /brew install shellcheck/
const APT_INSTALL_SHELLCHECK_RE = /apt-get install -y shellcheck/
const PACMAN_INSTALL_SHELLCHECK_RE = /pacman -S shellcheck/
const UV_WORD_RE = /\buv\b/
const BREW_INSTALL_UV_RE = /brew install uv/
const ASTRAL_UV_RE = /astral\.sh\/uv/
const CONFTEST_WORD_RE = /\bconftest\b/
const BREW_INSTALL_CONFTEST_RE = /brew install conftest/
const CONFTEST_INSTALL_URL_RE = /conftest\.dev\/install/

/**
 * Ізолює PATH у порожньому каталозі на час `fn`, перехоплює console.error/log і повертає виведене
 * в stderr-блобі та результат `runLintGaCli`.
 * @param {() => number} fn виклик `runLintGaCli`
 * @returns {Promise<{ code: number, errBlob: string }>} код виходу й об'єднаний stderr
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
    // suppress test output noise
  }
  try {
    const code = await fn()
    return { code, errBlob: errs.join('\n') }
  } finally {
    console.error = origErr
    console.log = origLog
    if (prevPath === undefined) {
      delete env.PATH
    } else {
      env.PATH = prevPath
    }
  }
}

describe('runLintGaCli', () => {
  test('exit 1 + brew/apt/pacman підказки, коли shellcheck відсутній у PATH', async () => {
    const { code, errBlob } = await withIsolatedPath(runLintGaCli)
    expect(code).toBe(1)
    expect(errBlob).toContain('shellcheck')
    expect(errBlob).toMatch(BREW_INSTALL_SHELLCHECK_RE)
    expect(errBlob).toMatch(APT_INSTALL_SHELLCHECK_RE)
    expect(errBlob).toMatch(PACMAN_INSTALL_SHELLCHECK_RE)
  })

  test('exit 1 + підказка astral.sh/uv, коли uv відсутній у PATH', async () => {
    const { code, errBlob } = await withIsolatedPath(runLintGaCli)
    expect(code).toBe(1)
    expect(errBlob).toMatch(UV_WORD_RE)
    expect(errBlob).toMatch(BREW_INSTALL_UV_RE)
    expect(errBlob).toMatch(ASTRAL_UV_RE)
  })

  test('exit 1 + підказка conftest.dev/install, коли conftest відсутній у PATH', async () => {
    const { code, errBlob } = await withIsolatedPath(runLintGaCli)
    expect(code).toBe(1)
    expect(errBlob).toMatch(CONFTEST_WORD_RE)
    expect(errBlob).toMatch(BREW_INSTALL_CONFTEST_RE)
    expect(errBlob).toMatch(CONFTEST_INSTALL_URL_RE)
  })

  test('усі три preflight’и повідомляються незалежно — підказки не зникають після першого fail', async () => {
    const { errBlob } = await withIsolatedPath(runLintGaCli)
    expect(errBlob).toMatch(BREW_INSTALL_SHELLCHECK_RE)
    expect(errBlob).toMatch(BREW_INSTALL_UV_RE)
    expect(errBlob).toMatch(BREW_INSTALL_CONFTEST_RE)
  })

  test('preflight OK — логує successMsg і доходить до actionlint (lines 129-130, 161-162)', async () => {
    if (platform === 'win32') { expect(true).toBe(true); return }

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
    console.error = () => {}
    let code
    try {
      code = await runLintGaCli()
    } finally {
      console.log = origLog
      console.error = origErr
      env.PATH = prevPath
    }
    // Preflight пройшов; actionlint (через bunx) → 127 (bunx відсутній)
    expect(code).toBe(127)
    expect(logs.some(l => l.includes('shellcheck'))).toBe(true)
    expect(logs.some(l => l.includes('uv'))).toBe(true)
    expect(logs.some(l => l.includes('conftest'))).toBe(true)
  })

  test('actionlint OK → досягає zizmor (lines 164-165)', async () => {
    if (platform === 'win32') { expect(true).toBe(true); return }

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
    console.log = () => {}
    console.error = () => {}
    let code
    try {
      code = await runLintGaCli()
    } finally {
      console.log = origLog
      console.error = origErr
      env.PATH = prevPath
    }
    // actionlint OK (bunx stub exit 0); zizmor (uvx) → 127 (uvx відсутній)
    expect(code).toBe(127)
  })
})

/**
 * Тест preflight у `runLintGaCli`: коли `shellcheck`, `uv` і `conftest` відсутні в PATH — exit 1,
 * причому друкуються підказки встановлення для кожного незалежно (а не лише для першого).
 *
 * Реальний `actionlint`/`zizmor` не запускаються — ми обриваємо потік ще на preflight, не доходячи до них.
 */
import { describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { env } from 'node:process'

import { runLintGaCli } from './lint.mjs'

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
})

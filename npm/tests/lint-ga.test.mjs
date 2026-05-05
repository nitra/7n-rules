/**
 * Тест preflight у `runLintGaCli`: коли `shellcheck` і `uv` відсутні в PATH — exit 1, причому
 * друкуються підказки встановлення для кожного незалежно (а не лише для першого).
 *
 * Реальний `actionlint`/`zizmor` не запускаються — ми обриваємо потік ще на preflight, не доходячи до них.
 */
import { describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { env } from 'node:process'

import { runLintGaCli } from '../scripts/lint-ga.mjs'

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
    const code = fn()
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
    expect(errBlob).toMatch(/brew install shellcheck/)
    expect(errBlob).toMatch(/apt-get install -y shellcheck/)
    expect(errBlob).toMatch(/pacman -S shellcheck/)
  })

  test('exit 1 + підказка astral.sh/uv, коли uv відсутній у PATH', async () => {
    const { code, errBlob } = await withIsolatedPath(runLintGaCli)
    expect(code).toBe(1)
    expect(errBlob).toMatch(/\buv\b/)
    expect(errBlob).toMatch(/brew install uv/)
    expect(errBlob).toMatch(/astral\.sh\/uv/)
  })

  test('обидва preflight’и повідомляються незалежно — підказка для uv не зникає, якщо shellcheck впав першим', async () => {
    const { errBlob } = await withIsolatedPath(runLintGaCli)
    // Один прогін має містити обидві підказки (а не вийти одразу після першого fail).
    expect(errBlob).toMatch(/brew install shellcheck/)
    expect(errBlob).toMatch(/brew install uv/)
  })
})

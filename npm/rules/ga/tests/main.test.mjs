/**
 * Тест detector-а `ga.workflows`: коли `shellcheck` відсутній у PATH і авто-install відключено
 * (`N_CURSOR_NO_AUTO_INSTALL=1`) — `lint(ctx)` кидає виняток із підказкою про встановлення,
 * бо першим кроком викликає `ensureTool('shellcheck')`.
 *
 * Старий CLI-контракт (exit 1 при відсутньому `uv`, 127-проброс від actionlint/zizmor) більше
 * не існує: `lint(ctx)` повертає `{ violations }`, а `uv`/external-тули — best-effort
 * (відсутній `uv` → zizmor просто пропускається, 127 → skip без violation). Тести на ці коди
 * прибрані разом із `runLintGaCli`.
 */
import { describe, expect, test, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { env } from 'node:process'

import { lint } from '../workflows/main.mjs'

const SHELLCHECK_RE = /shellcheck/

/**
 * Викликає `lint(ctx)` під ізольованим `PATH` (порожній) і `N_CURSOR_NO_AUTO_INSTALL=1`,
 * перехоплюючи виняток.
 * @param {string} cwd корінь репозиторію для контексту лінту
 * @returns {Promise<{ error?: Error }>} перехоплений виняток (або порожньо)
 */
async function lintWithIsolatedPath(cwd) {
  const isolatedDir = await mkdtemp(join(tmpdir(), 'n-rules-empty-path-'))
  const prevPath = env.PATH
  const prevNoInstall = env['N_CURSOR_NO_AUTO_INSTALL']
  env.PATH = isolatedDir
  env['N_CURSOR_NO_AUTO_INSTALL'] = '1'
  const errorSpy = vi.spyOn(console, 'error').mockReturnValue()
  const logSpy = vi.spyOn(console, 'log').mockReturnValue()
  let caughtError
  try {
    await lint({ cwd, ruleId: 'ga', concernId: 'workflows', files: undefined })
  } catch (error) {
    caughtError = error
  } finally {
    errorSpy.mockRestore()
    logSpy.mockRestore()
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
  return { error: caughtError }
}

describe('ga.workflows detector — preflight тулів', () => {
  test('кидає з підказкою shellcheck, коли бінарник відсутній і N_CURSOR_NO_AUTO_INSTALL=1', async () => {
    const isolatedDir = await mkdtemp(join(tmpdir(), 'n-rules-ga-cwd-'))
    try {
      const { error } = await lintWithIsolatedPath(isolatedDir)
      expect(error).toBeDefined()
      expect(error?.message).toMatch(SHELLCHECK_RE)
    } finally {
      await rm(isolatedDir, { recursive: true, force: true })
    }
  })
})

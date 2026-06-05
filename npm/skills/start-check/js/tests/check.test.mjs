/**
 * Тести для skills/start-check/js/check.mjs:
 *   - classifyStartType: server-маркери vs CLI;
 *   - parseStartLog: ready / firstError / logTail;
 *   - scanStartWorkspaces: монорепо, фільтр за наявністю start;
 *   - runWorkspaceStart: класифікація OK/FAIL через інʼєкцію spawn + 1 реальний spawn;
 *   - runStartCheckCli: scan/run, exit-коди (cwd-ін'єкція).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { ensureDir, withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'
import {
  classifyStartType,
  parseStartLog,
  runStartCheckCli,
  runWorkspaceStart,
  scanStartWorkspaces
} from '../check.mjs'

const NO_START_RE = /немає scripts.start/

/**
 * Записує package.json у каталог.
 * @param {string} dir каталог
 * @param {object} pkg обʼєкт package.json
 * @returns {Promise<void>}
 */
async function writePkg(dir, pkg) {
  await ensureDir(dir)
  await writeFile(join(dir, 'package.json'), JSON.stringify(pkg), 'utf8')
}

describe('classifyStartType', () => {
  test('server-маркери', () => {
    for (const cmd of ['vite', 'next dev', 'nuxt dev', 'nodemon app.js', 'bun --watch server.ts', 'astro dev']) {
      expect(classifyStartType(cmd)).toBe('server')
    }
  })

  test('CLI/разові дії', () => {
    for (const cmd of ['node migrate.js', 'bun run build', 'n-cursor', 'tsc -p .']) {
      expect(classifyStartType(cmd)).toBe('cli')
    }
  })
})

describe('parseStartLog', () => {
  test('виявляє рядок готовності', () => {
    expect(parseStartLog('booting...\nLocal:   http://localhost:5173\n').ready).toBe(true)
  })

  test('виловлює першу помилку', () => {
    const r = parseStartLog('ok\nError: Cannot find module "x"\nmore')
    expect(r.firstError).toContain('Cannot find module')
    expect(r.ready).toBe(false)
  })

  test('logTail прибирає порожні рядки', () => {
    expect(parseStartLog('a\n\n\nb\n').logTail).toBe('a\nb')
  })
})

describe('scanStartWorkspaces', () => {
  test('повертає всі воркспейси з ознакою hasStart і типом', async () => {
    await withTmpDir(async dir => {
      await writePkg(dir, { name: 'root', workspaces: ['apps/*'], scripts: { start: 'vite' } })
      await writePkg(join(dir, 'apps/api'), { name: 'api', scripts: { start: 'node server.js' } })
      await writePkg(join(dir, 'apps/lib'), { name: 'lib', scripts: { build: 'tsc' } })
      const scan = await scanStartWorkspaces(dir)
      const byWs = Object.fromEntries(scan.map(s => [s.workspace, s]))
      expect(byWs['.']).toMatchObject({ hasStart: true, type: 'server', name: 'root' })
      expect(byWs['apps/api']).toMatchObject({ hasStart: true, type: 'cli' })
      expect(byWs['apps/lib']).toMatchObject({ hasStart: false, type: null, startCmd: null })
    })
  })
})

describe('runWorkspaceStart (інʼєкція spawn)', () => {
  test('server timedOut → OK', async () => {
    await withTmpDir(async dir => {
      await writePkg(dir, { scripts: { start: 'vite' } })
      const res = await runWorkspaceStart(dir, '.', {
        spawnImpl: () => ({ error: { code: 'ETIMEDOUT' }, stdout: '', stderr: '' })
      })
      expect(res).toMatchObject({ type: 'server', timedOut: true, status: 'OK' })
    })
  })

  test('server впав до grace без ready → FAIL + firstError', async () => {
    await withTmpDir(async dir => {
      await writePkg(dir, { scripts: { start: 'vite' } })
      const res = await runWorkspaceStart(dir, '.', {
        spawnImpl: () => ({ status: 1, stdout: '', stderr: 'Error: boom' })
      })
      expect(res.status).toBe('FAIL')
      expect(res.firstError).toContain('boom')
    })
  })

  test('cli exit 0 → OK; exit 1 → FAIL', async () => {
    await withTmpDir(async dir => {
      await writePkg(dir, { scripts: { start: 'node migrate.js' } })
      const ok = await runWorkspaceStart(dir, '.', { spawnImpl: () => ({ status: 0, stdout: 'done' }) })
      expect(ok).toMatchObject({ type: 'cli', status: 'OK', exitCode: 0 })
      const fail = await runWorkspaceStart(dir, '.', { spawnImpl: () => ({ status: 1, stderr: 'fatal' }) })
      expect(fail.status).toBe('FAIL')
    })
  })

  test('немає start → кидає', async () => {
    await withTmpDir(async dir => {
      await writePkg(dir, { scripts: { build: 'tsc' } })
      await expect(runWorkspaceStart(dir, '.', { spawnImpl: () => ({ status: 0 }) })).rejects.toThrow(NO_START_RE)
    })
  })

  test('реальний spawn: node exit 0 → OK', async () => {
    await withTmpDir(async dir => {
      await writePkg(dir, { scripts: { start: 'node -e ""' } })
      const res = await runWorkspaceStart(dir, '.', { graceMs: 10_000 })
      expect(res).toMatchObject({ type: 'cli', status: 'OK', exitCode: 0 })
    })
  })
})

describe('runStartCheckCli', () => {
  let outSpy
  let errSpy
  beforeEach(() => {
    outSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    errSpy = vi.spyOn(console, 'error').mockReturnValue()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('scan → JSON, exit 0', async () => {
    await withTmpDir(async dir => {
      await writePkg(dir, { name: 'root', scripts: { start: 'vite' } })
      const code = await runStartCheckCli(['scan'], dir)
      expect(code).toBe(0)
      expect(JSON.parse(outSpy.mock.calls.at(-1)[0])[0]).toMatchObject({ workspace: '.', hasStart: true })
    })
  })

  test('run без воркспейсу → exit 1', async () => {
    await withTmpDir(async dir => {
      expect(await runStartCheckCli(['run'], dir)).toBe(1)
      expect(errSpy).toHaveBeenCalled()
    })
  })

  test('run з невалідним --grace → exit 1', async () => {
    await withTmpDir(async dir => {
      await writePkg(dir, { scripts: { start: 'node -e ""' } })
      expect(await runStartCheckCli(['run', '.', '--grace', 'abc'], dir)).toBe(1)
    })
  })

  test('невідома підкоманда → exit 1', async () => {
    await withTmpDir(async dir => {
      expect(await runStartCheckCli(['bogus'], dir)).toBe(1)
    })
  })
})

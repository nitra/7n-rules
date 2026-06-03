/**
 * Тести seam'у `ensureTool` / `ensureHkInstall` (`../ensure-tool.mjs`).
 *
 * `resolveCmd`, `node:fs` і `node:child_process` мокаються — жодних реальних
 * brew/scoop/curl-install чи `hk install` під час тесту. Перевіряємо порядок
 * резолву (PATH → кеш → opt-out hard-fail), невідомий тул і CI-skip для `hk install`.
 */
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'
import { env } from 'node:process'

const resolveCmdMock = vi.fn()
const existsSyncMock = vi.fn()
const spawnSyncMock = vi.fn()

vi.mock('../../utils/resolve-cmd.mjs', () => ({
  resolveCmd: resolveCmdMock
}))
vi.mock('node:fs', () => ({
  existsSync: existsSyncMock,
  mkdirSync: vi.fn(),
  chmodSync: vi.fn(),
  renameSync: vi.fn()
}))
vi.mock('node:child_process', () => ({
  spawnSync: spawnSyncMock
}))

const { ensureTool, ensureHkInstall } = await import('../ensure-tool.mjs')

const HK_SUFFIX_RE = /hk$/
const UNKNOWN_TOOL_RE = /невідомий тул/
const CONFTEST_RE = /conftest/

describe('ensureTool', () => {
  beforeEach(() => {
    resolveCmdMock.mockReset()
    existsSyncMock.mockReset()
    spawnSyncMock.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  test('PATH hit → повертає абсолютний шлях, без install', () => {
    resolveCmdMock.mockReturnValue('/usr/local/bin/conftest')
    expect(ensureTool('conftest')).toBe('/usr/local/bin/conftest')
    expect(spawnSyncMock).not.toHaveBeenCalled()
  })

  test('кеш hit → повертає шлях з кеш-каталогу, коли в PATH нема', () => {
    resolveCmdMock.mockReturnValue(null)
    existsSyncMock.mockReturnValue(true)
    const result = ensureTool('hk')
    expect(result).toMatch(HK_SUFFIX_RE)
    expect(spawnSyncMock).not.toHaveBeenCalled()
  })

  test('невідомий тул → кидає', () => {
    expect(() => ensureTool('definitely-not-a-tool')).toThrow(UNKNOWN_TOOL_RE)
  })

  test('opt-out N_CURSOR_NO_AUTO_INSTALL + відсутній → hard-fail з підказкою (без install)', () => {
    resolveCmdMock.mockReturnValue(null)
    existsSyncMock.mockReturnValue(false)
    const prev = env['N_CURSOR_NO_AUTO_INSTALL']
    env['N_CURSOR_NO_AUTO_INSTALL'] = '1'
    try {
      expect(() => ensureTool('conftest')).toThrow(CONFTEST_RE)
      expect(spawnSyncMock).not.toHaveBeenCalled()
    } finally {
      if (prev === undefined) delete env['N_CURSOR_NO_AUTO_INSTALL']
      else env['N_CURSOR_NO_AUTO_INSTALL'] = prev
    }
  })
})

describe('ensureHkInstall', () => {
  beforeEach(() => {
    spawnSyncMock.mockReset()
  })

  test('у CI — пропускає `hk install` (spawnSync не викликається)', () => {
    const prev = env['CI']
    env['CI'] = '1'
    try {
      ensureHkInstall('/usr/local/bin/hk')
      expect(spawnSyncMock).not.toHaveBeenCalled()
    } finally {
      if (prev === undefined) delete env['CI']
      else env['CI'] = prev
    }
  })

  test('поза CI — викликає `hk install`', () => {
    const prev = env['CI']
    delete env['CI']
    spawnSyncMock.mockReturnValue({ status: 0 })
    try {
      ensureHkInstall('/usr/local/bin/hk')
      expect(spawnSyncMock).toHaveBeenCalledWith('/usr/local/bin/hk', ['install'], expect.any(Object))
    } finally {
      if (prev !== undefined) env['CI'] = prev
    }
  })
})

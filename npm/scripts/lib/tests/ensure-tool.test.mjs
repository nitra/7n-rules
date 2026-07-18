/**
 * Тести seam'у `ensureTool` / `ensureToolAsync` / `ensureHkInstall` (`../ensure-tool.mjs`).
 *
 * `resolveCmd`, `node:fs`, `node:child_process` і `withLock` мокаються — жодних реальних
 * brew/scoop/curl-install чи `hk install` під час тесту. Перевіряємо порядок
 * резолву (PATH → кеш → opt-out hard-fail), невідомий тул, CI-skip для `hk install`,
 * і для async-варіанта — in-process single-flight (конкурентні виклики того самого
 * toolId колапсують в один `withLock`).
 */
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'
import { env } from 'node:process'

const resolveCmdMock = vi.fn()
const existsSyncMock = vi.fn()
const spawnSyncMock = vi.fn()
const withLockMock = vi.fn()

vi.mock('../../utils/resolve-cmd.mjs', () => ({
  resolveCmd: resolveCmdMock
}))
vi.mock('../../utils/with-lock.mjs', () => ({
  withLock: withLockMock
}))
vi.mock('node:fs', () => ({
  existsSync: existsSyncMock,
  mkdirSync: vi.fn(),
  mkdtempSync: vi.fn(),
  chmodSync: vi.fn(),
  renameSync: vi.fn(),
  rmSync: vi.fn()
}))
vi.mock('node:child_process', () => ({
  spawnSync: spawnSyncMock
}))

const { ensureTool, ensureToolAsync, ensureHkInstall } = await import('../ensure-tool.mjs')

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

describe('ensureToolAsync', () => {
  beforeEach(() => {
    resolveCmdMock.mockReset()
    existsSyncMock.mockReset()
    spawnSyncMock.mockReset()
    withLockMock.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  test('PATH hit → повертає абсолютний шлях, без withLock', async () => {
    resolveCmdMock.mockReturnValue('/usr/local/bin/conftest')
    await expect(ensureToolAsync('conftest')).resolves.toBe('/usr/local/bin/conftest')
    expect(withLockMock).not.toHaveBeenCalled()
  })

  test('кеш hit → повертає шлях з кеш-каталогу, без withLock', async () => {
    resolveCmdMock.mockReturnValue(null)
    existsSyncMock.mockReturnValue(true)
    await expect(ensureToolAsync('hk')).resolves.toMatch(HK_SUFFIX_RE)
    expect(withLockMock).not.toHaveBeenCalled()
  })

  test('невідомий тул → кидає (без withLock)', async () => {
    await expect(ensureToolAsync('definitely-not-a-tool')).rejects.toThrow(UNKNOWN_TOOL_RE)
    expect(withLockMock).not.toHaveBeenCalled()
  })

  test('opt-out N_CURSOR_NO_AUTO_INSTALL + відсутній → hard-fail без withLock', async () => {
    resolveCmdMock.mockReturnValue(null)
    existsSyncMock.mockReturnValue(false)
    const prev = env['N_CURSOR_NO_AUTO_INSTALL']
    env['N_CURSOR_NO_AUTO_INSTALL'] = '1'
    try {
      await expect(ensureToolAsync('conftest')).rejects.toThrow(CONFTEST_RE)
      expect(withLockMock).not.toHaveBeenCalled()
    } finally {
      if (prev === undefined) delete env['N_CURSOR_NO_AUTO_INSTALL']
      else env['N_CURSOR_NO_AUTO_INSTALL'] = prev
    }
  })

  test('конкурентні виклики того самого toolId колапсують в один withLock (single-flight)', async () => {
    resolveCmdMock.mockReturnValue(null)
    // Перші 2 виклики existsSync — fast-path обох конкурентних ensureToolAsync (miss).
    // 3-й виклик — усередині withLock-runFn (симулює «інший процес уже встановив, поки чекали»).
    let calls = 0
    existsSyncMock.mockImplementation(() => {
      calls += 1
      return calls > 2
    })
    // withLock реально чекає (mkdirSync-lock, poll-цикл) — await Promise.resolve() тут імітує
    // ту саму властивість: перш ніж викликати runFn, поступається чергою мікротасків, інакше
    // другий конкурентний виклик ніколи не встиг би побачити inFlightInstalls, виставлений першим.
    withLockMock.mockImplementation(async (key, runFn, opts) => {
      withLockMock.lastArgs = { key, opts }
      await Promise.resolve()
      return runFn()
    })

    const [a, b] = await Promise.all([ensureToolAsync('conftest'), ensureToolAsync('conftest')])

    expect(withLockMock).toHaveBeenCalledTimes(1)
    expect(a).toBe(b)
    expect(a).toMatch(CONFTEST_RE)
    expect(withLockMock.lastArgs.key).toBe('ensure-tool/conftest')
    expect(withLockMock.lastArgs.opts.onWaitTimeout).toBe('fail')
    expect(withLockMock.lastArgs.opts.getFingerprint()).toBeNull()
  })

  test('наступний (нон-конкурентний) виклик після завершення single-flight знову бере withLock', async () => {
    resolveCmdMock.mockReturnValue(null)
    // Непарний виклик existsSync — fast-path ensureToolAsync (miss); парний — усередині runFn
    // withLock (симулює «встановлено, поки чекали на лок»). Кожен sequential-await ensureToolAsync
    // споживає рівно одну таку пару.
    let calls = 0
    existsSyncMock.mockImplementation(() => {
      calls += 1
      return calls % 2 === 0
    })
    withLockMock.mockImplementation(async (key, runFn) => {
      await Promise.resolve()
      return runFn()
    })

    await ensureToolAsync('conftest')
    await ensureToolAsync('conftest')

    expect(withLockMock).toHaveBeenCalledTimes(2)
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

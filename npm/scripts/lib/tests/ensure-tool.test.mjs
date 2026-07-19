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

// JSON-import, не `node:fs` — статичний `import {readFileSync} from 'node:fs'` тут ламає
// hoisting-порядок `vi.mock('node:fs', …)` нижче (ESM static import виконується до const
// XMock = vi.fn() top-level коду, тоді як factory виконується лише лениво, на моменті
// динамічного `await import('../ensure-tool.mjs')`).
import toolPins from '../tool-pins.json' with { type: 'json' }

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
vi.mock('node:fs', async () => {
  // readFileSync лишається реальним (spread actual) — resolvePinnedVersion/checkToolPinsFreshness
  // читають справжній tool-pins.json; тільки install-мутації (mkdir/mkdtemp/chmod/rename/rm) мокаються.
  const actual = await vi.importActual('node:fs')
  return {
    ...actual,
    existsSync: existsSyncMock,
    mkdirSync: vi.fn(),
    mkdtempSync: vi.fn(),
    chmodSync: vi.fn(),
    renameSync: vi.fn(),
    rmSync: vi.fn()
  }
})
vi.mock('node:child_process', () => ({
  spawnSync: spawnSyncMock
}))

const { ensureTool, ensureToolAsync, ensureHkInstall, fetchLatestVersion, checkToolPinsFreshness, TOOLS } =
  await import('../ensure-tool.mjs')

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

/**
 * Тимчасово виставляє env-змінну на час callback-а, відновлюючи попереднє значення.
 * @param {string} key імʼя env-змінної
 * @param {string|undefined} value значення на час виклику; `undefined` — прибрати змінну
 * @param {() => unknown} fn callback, що виконується з виставленим env
 * @returns {unknown} результат callback-а
 */
function withEnv(key, value, fn) {
  const prev = env[key]
  if (value === undefined) delete env[key]
  else env[key] = value
  try {
    return fn()
  } finally {
    if (prev === undefined) delete env[key]
    else env[key] = prev
  }
}

describe('fetchLatestVersion', () => {
  const CURL = '/usr/bin/curl'
  const REPO = 'open-policy-agent/conftest'

  beforeEach(() => {
    spawnSyncMock.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  test('API OK → версія без префікса v, redirect-fallback не викликається', () => {
    spawnSyncMock.mockReturnValue({ status: 0, stdout: JSON.stringify({ tag_name: 'v0.62.0' }) })
    withEnv('GITHUB_TOKEN', undefined, () =>
      withEnv('GH_TOKEN', undefined, () => {
        expect(fetchLatestVersion(REPO, CURL)).toBe('0.62.0')
      })
    )
    expect(spawnSyncMock).toHaveBeenCalledTimes(1)
    const args = spawnSyncMock.mock.calls[0][1]
    expect(args.join(' ')).not.toContain('Authorization')
  })

  test('GITHUB_TOKEN в env → API-запит з Authorization: Bearer', () => {
    spawnSyncMock.mockReturnValue({ status: 0, stdout: JSON.stringify({ tag_name: 'v1.2.3' }) })
    withEnv('GITHUB_TOKEN', 'tkn-123', () => {
      expect(fetchLatestVersion(REPO, CURL)).toBe('1.2.3')
    })
    const args = spawnSyncMock.mock.calls[0][1]
    expect(args).toContain('Authorization: Bearer tkn-123')
  })

  test('API без tag_name (rate-limit) → fallback через redirect releases/latest', () => {
    spawnSyncMock
      .mockReturnValueOnce({ status: 0, stdout: JSON.stringify({ message: 'API rate limit exceeded' }) })
      .mockReturnValueOnce({
        status: 0,
        stdout: `HTTP/2 302\r\nlocation: https://github.com/${REPO}/releases/tag/v0.62.0\r\n\r\nhttps://github.com/${REPO}/releases/tag/v0.62.0`
      })
    withEnv('GITHUB_TOKEN', undefined, () =>
      withEnv('GH_TOKEN', undefined, () => {
        expect(fetchLatestVersion(REPO, CURL)).toBe('0.62.0')
      })
    )
    expect(spawnSyncMock).toHaveBeenCalledTimes(2)
    const redirectArgs = spawnSyncMock.mock.calls[1][1]
    expect(redirectArgs).toContain(`https://github.com/${REPO}/releases/latest`)
  })

  test('обидва шляхи впали → ToolProvisionError з обома причинами', () => {
    spawnSyncMock
      .mockReturnValueOnce({ status: 0, stdout: JSON.stringify({ message: 'API rate limit exceeded' }) })
      .mockReturnValueOnce({ status: 22, stdout: '', stderr: 'curl: (22) 429' })
    withEnv('GITHUB_TOKEN', undefined, () =>
      withEnv('GH_TOKEN', undefined, () => {
        let thrown
        try {
          fetchLatestVersion(REPO, CURL)
        } catch (error) {
          thrown = error
        }
        expect(thrown?.name).toBe('ToolProvisionError')
        expect(thrown?.message).toContain('tag_name missing')
        expect(thrown?.message).toContain('API rate limit exceeded')
      })
    )
  })
})

describe('tool-pins.json', () => {
  const DAY_MS = 24 * 60 * 60 * 1000

  test('кожен тул з TOOLS має закріплену версію в tool-pins.json', () => {
    for (const toolId of Object.keys(TOOLS)) {
      expect(toolPins.versions[toolId], `${toolId}: немає піна в tool-pins.json`).toBeTruthy()
    }
  })

  test('checkToolPinsFreshness: < 30 днів від pinnedAt → не stale', () => {
    const { pinnedAt } = checkToolPinsFreshness()
    const now = Date.parse(pinnedAt) + 5 * DAY_MS
    const result = checkToolPinsFreshness(now)
    expect(result.ageDays).toBe(5)
    expect(result.stale).toBe(false)
  })

  test('checkToolPinsFreshness: > 30 днів від pinnedAt → stale', () => {
    const { pinnedAt } = checkToolPinsFreshness()
    const now = Date.parse(pinnedAt) + 31 * DAY_MS
    const result = checkToolPinsFreshness(now)
    expect(result.ageDays).toBe(31)
    expect(result.stale).toBe(true)
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

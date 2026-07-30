/**
 * Тести install-механіки `ensure-tool.mjs` (`autoInstall`/`installFromGithub`/
 * `installViaBrew`/`installViaScoop`/`buildHint`) — усі module-private, тому доступні лише
 * непрямо через публічний `ensureTool`/`ensureToolAsync` при PATH-miss + cache-miss +
 * авто-install увімкнено. Окремий файл від `ensure-tool.test.mjs`: тут додатково мокається
 * `node:process` (керований `platform`/`arch`, щоб детермінувати per-OS гілки незалежно
 * від реального хоста CI/локально) — змішування з сусіднім файлом (де `platform`/`arch`
 * реальні) означало б module-wide конфлікт моків.
 *
 * `env` у моці `node:process` — той самий об'єкт, що й реальний `process.env` (не копія):
 * `N_CURSOR_NO_AUTO_INSTALL`/`N_CURSOR_TOOL_CACHE_DIR` мутуються напряму через `process.env`
 * і одразу видні модулю під тестом.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { env as realEnv } from 'node:process'

let mockPlatform = 'darwin'
let mockArch = 'x64'

const resolveCmdMock = vi.fn()
const existsSyncMock = vi.fn()
const spawnSyncMock = vi.fn()
const withLockMock = vi.fn()

vi.mock('../../utils/resolve-cmd.mjs', () => ({ resolveCmd: resolveCmdMock }))
vi.mock('../../utils/with-lock.mjs', () => ({ withLock: withLockMock }))
vi.mock('node:process', async () => {
  const actual = await vi.importActual('node:process')
  return {
    ...actual,
    env: actual.env,
    get platform() {
      return mockPlatform
    },
    get arch() {
      return mockArch
    }
  }
})
vi.mock('node:fs', async () => {
  const actual = await vi.importActual('node:fs')
  return {
    ...actual,
    existsSync: existsSyncMock,
    mkdirSync: vi.fn(),
    mkdtempSync: vi.fn(prefix => `${prefix}XXXXXX`),
    chmodSync: vi.fn(),
    renameSync: vi.fn(),
    rmSync: vi.fn()
  }
})
vi.mock('node:child_process', () => ({ spawnSync: spawnSyncMock }))

const { ensureTool, ensureToolAsync, TOOLS } = await import('../ensure-tool.mjs')

const NO_SCOOP_ENTRY_ID = 'mago' // entry.scoop === null — форсує win32 scoop-fallback гілку

const HOMEBREW_HINT_RE = /Homebrew/
const SPAWN_ENOENT_RE = /spawn ENOENT/
const EXIT_CODE_1_RE = /кодом 1/
const AFTER_BREW_INSTALL_RE = /після brew install/
const CURL_MISSING_RE = /curl не знайдено/
const TAR_MISSING_RE = /tar не знайдено/
const DOWNLOAD_FAILED_RE = /Завантаження hk не вдалось/
const CURL_EXIT_22_RE = /curl exit 22/
const OPA_SUFFIX_RE = /opa$/
const TAR_FAILED_RE = /tar failed for hk/
const TAR_EXIT_2_RE = /tar exit 2/
const NOT_FOUND_AFTER_EXTRACT_RE = /не знайдено після розпакування/
const SHELLCHECK_SUFFIX_RE = /shellcheck$/
const MAGO_SUFFIX_RE = /mago$/
const BREW_HINT_HK_RE = /macOS: brew install hk/
const SCOOP_HINT_HK_RE = /Windows: scoop install hk/
const LINUX_HINT_HK_RE = /Linux: https:\/\/github\.com\/jdx\/hk\/releases/
const SCOOP_EXE_PATH = String.raw`C:\scoop\shims\scoop.exe`
const HK_EXE_PATH = String.raw`C:\scoop\shims\hk.exe`

beforeEach(() => {
  mockPlatform = 'darwin'
  mockArch = 'x64'
  resolveCmdMock.mockReset()
  existsSyncMock.mockReset()
  spawnSyncMock.mockReset()
  withLockMock.mockReset()
  delete realEnv['N_CURSOR_NO_AUTO_INSTALL']
})

afterEach(() => {
  vi.clearAllMocks()
  delete realEnv['N_CURSOR_NO_AUTO_INSTALL']
})

/** PATH-miss + cache-miss — форсує гілку auto-install у `ensureTool`/`ensureToolAsync`. */
function forcePathAndCacheMiss() {
  resolveCmdMock.mockReturnValue(null)
  existsSyncMock.mockReturnValue(false)
}

describe('autoInstall — darwin → installViaBrew', () => {
  test('brew install OK, tool резолвиться після — повертає шлях', () => {
    forcePathAndCacheMiss()
    // 1-й resolveCmd(toolId) — PATH miss (null); 2-й — усередині installViaBrew: 'brew' bin;
    // 3-й — resolveCmd(toolId) ПІСЛЯ install (успіх).
    resolveCmdMock
      .mockReturnValueOnce(null)
      .mockReturnValueOnce('/opt/homebrew/bin/brew')
      .mockReturnValueOnce('/opt/homebrew/bin/hk')
    spawnSyncMock.mockReturnValue({ status: 0 })
    expect(ensureTool('hk')).toBe('/opt/homebrew/bin/hk')
    expect(spawnSyncMock).toHaveBeenCalledWith(
      '/opt/homebrew/bin/brew',
      ['install', TOOLS['hk'].brew],
      expect.objectContaining({ stdio: 'inherit' })
    )
  })

  test('brew відсутній у PATH → кидає з підказкою на Homebrew', () => {
    forcePathAndCacheMiss()
    resolveCmdMock.mockReturnValueOnce(null).mockReturnValueOnce(null)
    expect(() => ensureTool('hk')).toThrow(HOMEBREW_HINT_RE)
  })

  test('brew install спавн-помилка (ENOENT) → кидає з деталями error.message', () => {
    forcePathAndCacheMiss()
    resolveCmdMock.mockReturnValueOnce(null).mockReturnValueOnce('/opt/homebrew/bin/brew')
    spawnSyncMock.mockReturnValue({ error: new Error('spawn ENOENT') })
    expect(() => ensureTool('hk')).toThrow(SPAWN_ENOENT_RE)
  })

  test('brew install exit != 0 → кидає з кодом', () => {
    forcePathAndCacheMiss()
    resolveCmdMock.mockReturnValueOnce(null).mockReturnValueOnce('/opt/homebrew/bin/brew')
    spawnSyncMock.mockReturnValue({ status: 1 })
    expect(() => ensureTool('hk')).toThrow(EXIT_CODE_1_RE)
  })

  test('brew install OK, але тул все одно не в PATH → кидає', () => {
    forcePathAndCacheMiss()
    resolveCmdMock.mockReturnValueOnce(null).mockReturnValueOnce('/opt/homebrew/bin/brew').mockReturnValueOnce(null)
    spawnSyncMock.mockReturnValue({ status: 0 })
    expect(() => ensureTool('hk')).toThrow(AFTER_BREW_INSTALL_RE)
  })
})

describe('autoInstall — win32 → installViaScoop (+ GitHub fallback)', () => {
  beforeEach(() => {
    mockPlatform = 'win32'
  })

  test('scoop install OK, tool резолвиться — повертає шлях', () => {
    forcePathAndCacheMiss()
    resolveCmdMock
      .mockReturnValueOnce(null) // PATH miss
      .mockReturnValueOnce(SCOOP_EXE_PATH)
      .mockReturnValueOnce(HK_EXE_PATH)
    spawnSyncMock.mockReturnValue({ status: 0 })
    expect(ensureTool('hk')).toBe(HK_EXE_PATH)
  })

  test('entry.scoop === null (mago) → installViaScoop кидає одразу, без спроби resolveCmd(scoop)', () => {
    forcePathAndCacheMiss()
    // GitHub-fallback (installFromGithub) теж викликає resolveCmd('curl'), тому недостатньо
    // мокати лише PATH miss — форсуємо явний provisioning-фейл на curl, щоб зупинитись
    // рівно на межі scoop→fallback, не заглиблюючись у сам installFromGithub (окремі тести нижче).
    resolveCmdMock.mockReturnValue(null)
    expect(() => ensureTool(NO_SCOOP_ENTRY_ID)).toThrow(CURL_MISSING_RE)
    // resolveCmd('scoop') НЕ мав викликатись — entry.scoop null коротить installViaScoop одразу.
    expect(resolveCmdMock).not.toHaveBeenCalledWith('scoop')
  })

  test('scoop бін відсутній у PATH → fallback на installFromGithub', () => {
    forcePathAndCacheMiss()
    resolveCmdMock.mockReturnValue(null) // scoop і curl обидва відсутні → падає на curl-стадії fallback-у
    expect(() => ensureTool('hk')).toThrow(CURL_MISSING_RE)
  })

  test('scoop install спавн-помилка → fallback на installFromGithub', () => {
    forcePathAndCacheMiss()
    resolveCmdMock
      .mockReturnValueOnce(null) // PATH miss
      .mockReturnValueOnce(SCOOP_EXE_PATH) // installViaScoop: scoop bin found
      .mockReturnValueOnce(null) // installFromGithub fallback: curl відсутній
    spawnSyncMock.mockReturnValue({ error: new Error('spawn failed') })
    expect(() => ensureTool('hk')).toThrow(CURL_MISSING_RE)
  })
})

describe('autoInstall — linux (і win32 fallback) → installFromGithub', () => {
  beforeEach(() => {
    mockPlatform = 'linux'
  })

  test('curl відсутній у PATH → кидає', () => {
    forcePathAndCacheMiss()
    resolveCmdMock.mockReturnValue(null)
    expect(() => ensureTool('hk')).toThrow(CURL_MISSING_RE)
  })

  test('tar відсутній у PATH → кидає', () => {
    forcePathAndCacheMiss()
    resolveCmdMock.mockReturnValueOnce(null).mockReturnValueOnce('/usr/bin/curl').mockReturnValueOnce(null)
    expect(() => ensureTool('hk')).toThrow(TAR_MISSING_RE)
  })

  test('download (curl) спавн-помилка → ToolProvisionError', () => {
    forcePathAndCacheMiss()
    resolveCmdMock.mockReturnValueOnce(null).mockReturnValueOnce('/usr/bin/curl').mockReturnValueOnce('/usr/bin/tar')
    spawnSyncMock.mockReturnValue({ error: new Error('network unreachable') })
    expect(() => ensureTool('hk')).toThrow(DOWNLOAD_FAILED_RE)
  })

  test('download (curl) exit != 0 → ToolProvisionError з кодом', () => {
    forcePathAndCacheMiss()
    resolveCmdMock.mockReturnValueOnce(null).mockReturnValueOnce('/usr/bin/curl').mockReturnValueOnce('/usr/bin/tar')
    spawnSyncMock.mockReturnValue({ status: 22, stderr: '404 Not Found' })
    expect(() => ensureTool('hk')).toThrow(CURL_EXIT_22_RE)
  })

  test('archive: false (opa) — сирий бінарник: chmod+rename, без tar', () => {
    forcePathAndCacheMiss()
    resolveCmdMock.mockReturnValueOnce(null).mockReturnValueOnce('/usr/bin/curl').mockReturnValueOnce('/usr/bin/tar')
    spawnSyncMock.mockReturnValue({ status: 0 }) // лише curl-download — tar не викликається для archive:false
    const result = ensureTool('opa')
    expect(result).toMatch(OPA_SUFFIX_RE)
    // tar spawnSync не мав викликатись — лише один спавн (curl-download).
    expect(spawnSyncMock).toHaveBeenCalledTimes(1)
  })

  test('tar-екстракція спавн-помилка → кидає', () => {
    forcePathAndCacheMiss()
    resolveCmdMock.mockReturnValueOnce(null).mockReturnValueOnce('/usr/bin/curl').mockReturnValueOnce('/usr/bin/tar')
    spawnSyncMock
      .mockReturnValueOnce({ status: 0 }) // curl OK
      .mockReturnValueOnce({ error: new Error('tar binary crashed') }) // tar extract fails
    expect(() => ensureTool('hk')).toThrow(TAR_FAILED_RE)
  })

  test('tar-екстракція exit != 0 → кидає з кодом', () => {
    forcePathAndCacheMiss()
    resolveCmdMock.mockReturnValueOnce(null).mockReturnValueOnce('/usr/bin/curl').mockReturnValueOnce('/usr/bin/tar')
    spawnSyncMock.mockReturnValueOnce({ status: 0 }).mockReturnValueOnce({ status: 2, stderr: 'corrupt archive' })
    expect(() => ensureTool('hk')).toThrow(TAR_EXIT_2_RE)
  })

  test('видобутий бінарник відсутній після tar (existsSync false) → кидає', () => {
    forcePathAndCacheMiss()
    resolveCmdMock.mockReturnValueOnce(null).mockReturnValueOnce('/usr/bin/curl').mockReturnValueOnce('/usr/bin/tar')
    // existsSync: cache-check (false, форсує auto-install) → extractedBin check (теж false).
    existsSyncMock.mockReturnValue(false)
    spawnSyncMock.mockReturnValueOnce({ status: 0 }).mockReturnValueOnce({ status: 0 })
    expect(() => ensureTool('hk')).toThrow(NOT_FOUND_AFTER_EXTRACT_RE)
  })

  test('успішний повний install (tar.gz, binFinder) → повертає published-шлях', () => {
    forcePathAndCacheMiss()
    resolveCmdMock.mockReturnValueOnce(null).mockReturnValueOnce('/usr/bin/curl').mockReturnValueOnce('/usr/bin/tar')
    let existsCall = 0
    existsSyncMock.mockImplementation(() => {
      existsCall += 1
      // 1-й виклик — cache-check (false, форсує install); 2-й — extractedBin-check (true, "знайдено").
      return existsCall > 1
    })
    spawnSyncMock.mockReturnValueOnce({ status: 0 }).mockReturnValueOnce({ status: 0 })
    const result = ensureTool('shellcheck')
    expect(result).toMatch(SHELLCHECK_SUFFIX_RE)
  })

  test('win32 без scoop-пакета (mago) → GitHub-fallback повністю (весь ланцюжок)', () => {
    mockPlatform = 'win32'
    forcePathAndCacheMiss()
    let existsCall = 0
    existsSyncMock.mockImplementation(() => {
      existsCall += 1
      return existsCall > 1
    })
    // installViaScoop кидає одразу (entry.scoop null) → fallback installFromGithub: curl, tar, download OK.
    resolveCmdMock.mockReturnValueOnce(null).mockReturnValueOnce('/usr/bin/curl').mockReturnValueOnce('/usr/bin/tar')
    spawnSyncMock.mockReturnValueOnce({ status: 0 }).mockReturnValueOnce({ status: 0 })
    const result = ensureTool(NO_SCOOP_ENTRY_ID)
    expect(result).toMatch(MAGO_SUFFIX_RE)
  })
})

describe('buildHint — per-OS текст підказки (N_CURSOR_NO_AUTO_INSTALL=1)', () => {
  beforeEach(() => {
    forcePathAndCacheMiss()
    realEnv['N_CURSOR_NO_AUTO_INSTALL'] = '1'
  })

  test('darwin → підказка brew install', () => {
    mockPlatform = 'darwin'
    expect(() => ensureTool('hk')).toThrow(BREW_HINT_HK_RE)
  })

  test('win32 з entry.scoop → підказка scoop install + посилання на releases', () => {
    mockPlatform = 'win32'
    expect(() => ensureTool('hk')).toThrow(SCOOP_HINT_HK_RE)
  })

  test('win32 без entry.scoop (mago) → лише посилання на releases, без scoop-рядка', () => {
    mockPlatform = 'win32'
    let thrown
    try {
      ensureTool(NO_SCOOP_ENTRY_ID)
    } catch (error) {
      thrown = error
    }
    expect(thrown.message).not.toContain('scoop install')
    expect(thrown.message).toContain('carthage-software/mago/releases')
  })

  test('linux → підказка на GitHub releases', () => {
    mockPlatform = 'linux'
    expect(() => ensureTool('hk')).toThrow(LINUX_HINT_HK_RE)
  })
})

describe('ensureToolAsync — реальний autoInstall через installWithCrossProcessLock', () => {
  test('withLock викликає реальний runFn → реальний autoInstall (darwin/brew) відпрацьовує', async () => {
    mockPlatform = 'darwin'
    forcePathAndCacheMiss()
    resolveCmdMock
      .mockReturnValueOnce(null) // PATH miss
      .mockReturnValueOnce('/opt/homebrew/bin/brew')
      .mockReturnValueOnce('/opt/homebrew/bin/hk')
    spawnSyncMock.mockReturnValue({ status: 0 })
    withLockMock.mockImplementation((_key, runFn) => Promise.resolve(runFn()))

    await expect(ensureToolAsync('hk')).resolves.toBe('/opt/homebrew/bin/hk')
    expect(withLockMock).toHaveBeenCalledTimes(1)
  })
})

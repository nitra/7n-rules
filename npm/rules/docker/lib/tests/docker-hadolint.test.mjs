/**
 * Тести docker-hadolint:
 *   - `posixRel` — чиста функція (relative + sep→'/');
 *   - `lintDockerfileWithHadolint` — нативний hadolint через `ensureTool`, exit-code → ok-mapping,
 *     і `ok: false` з підказкою, коли `ensureTool` кидає (тула нема / авто-install відключено).
 *
 * `spawnSync` і `ensureTool` мокаються через `vi.mock` (factory). Без зовнішніх процесів і без `docker run`.
 */
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'
import { sep, join } from 'node:path'

const spawnSyncMock = vi.fn()
const ensureToolMock = vi.fn()

vi.mock('node:child_process', () => ({
  spawnSync: spawnSyncMock
}))
vi.mock('../../../../scripts/lib/ensure-tool.mjs', () => ({
  ensureTool: ensureToolMock
}))

const { posixRel, lintDockerfileWithHadolint } = await import('../docker-hadolint.mjs')

describe('posixRel', () => {
  test('повертає posix-шлях навіть на Windows-style sep', () => {
    const root = `${sep}repo`
    const abs = `${sep}repo${sep}pkg${sep}Dockerfile`
    expect(posixRel(root, abs)).toBe('pkg/Dockerfile')
  })

  test('для шляху що рівний root → "" (relative повертає порожнє)', () => {
    const root = join(sep, 'repo')
    expect(posixRel(root, root)).toBe('')
  })

  test('відносний шлях з кількома сегментами', () => {
    const root = join(sep, 'repo')
    const abs = join(root, 'a', 'b', 'Dockerfile')
    expect(posixRel(root, abs)).toBe('a/b/Dockerfile')
  })
})

describe('lintDockerfileWithHadolint', () => {
  beforeEach(() => {
    spawnSyncMock.mockReset()
    ensureToolMock.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  test('hadolint знайдено + exit 0 → ok=true, via=hadolint', () => {
    ensureToolMock.mockReturnValue('/usr/local/bin/hadolint')
    spawnSyncMock.mockReturnValue({ status: 0, stdout: '', stderr: '' })
    const result = lintDockerfileWithHadolint('/repo', '/repo/Dockerfile')
    expect(result).toEqual({ ok: true, stdout: '', stderr: '', via: 'hadolint' })
    expect(spawnSyncMock).toHaveBeenCalledWith(
      '/usr/local/bin/hadolint',
      ['Dockerfile'],
      expect.objectContaining({ cwd: '/repo', encoding: 'utf8' })
    )
  })

  test('hadolint знайдено + exit !=0 → ok=false, stdout/stderr пропагуються', () => {
    ensureToolMock.mockReturnValue('/usr/bin/hadolint')
    spawnSyncMock.mockReturnValue({ status: 1, stdout: 'DL3000', stderr: 'warning' })
    const result = lintDockerfileWithHadolint('/repo', '/repo/Dockerfile')
    expect(result).toEqual({ ok: false, stdout: 'DL3000', stderr: 'warning', via: 'hadolint' })
  })

  test('stdout/stderr undefined → fallback на ""', () => {
    ensureToolMock.mockReturnValue('/usr/bin/hadolint')
    spawnSyncMock.mockReturnValue({ status: 0, stdout: undefined, stderr: undefined })
    const r = lintDockerfileWithHadolint('/repo', '/repo/Dockerfile')
    expect(r.stdout).toBe('')
    expect(r.stderr).toBe('')
  })

  test('ensureTool кидає (hadolint недоступний) → ok=false з підказкою, без spawn', () => {
    ensureToolMock.mockImplementation(() => {
      throw new Error('hadolint недоступний (тест)')
    })
    const result = lintDockerfileWithHadolint('/repo', '/repo/Dockerfile')
    expect(result.ok).toBe(false)
    expect(result.via).toBe('hadolint')
    expect(result.stderr).toContain('hadolint')
    expect(result.stderr).toContain('hadolint недоступний (тест)')
    expect(spawnSyncMock).not.toHaveBeenCalled()
  })

  test('відносний шлях передається з прямими слешами навіть з вкладеною директорією', () => {
    ensureToolMock.mockReturnValue('/h')
    spawnSyncMock.mockReturnValue({ status: 0, stdout: '', stderr: '' })
    lintDockerfileWithHadolint('/repo', `/repo${sep}pkg${sep}sub${sep}Dockerfile`)
    expect(spawnSyncMock.mock.calls[0][1]).toEqual(['pkg/sub/Dockerfile'])
  })
})

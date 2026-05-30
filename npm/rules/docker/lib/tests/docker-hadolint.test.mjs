/**
 * Тести docker-hadolint:
 *   - `posixRel` — чиста функція (relative + sep→'/');
 *   - `HADOLINT_IMAGE` — канонічна константа з docker.mdc;
 *   - `lintDockerfileWithHadolint` — fallback PATH → Docker, та exit-code → ok-mapping.
 *
 * `spawnSync` і `resolveCmd` мокаються через `vi.mock` (factory). Без зовнішніх процесів.
 */
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'
import { sep, join } from 'node:path'

const spawnSyncMock = vi.fn()
const resolveCmdMock = vi.fn()

vi.mock('node:child_process', () => ({
  spawnSync: spawnSyncMock
}))
vi.mock('../../../../scripts/utils/resolve-cmd.mjs', () => ({
  resolveCmd: resolveCmdMock
}))

const { HADOLINT_IMAGE, posixRel, lintDockerfileWithHadolint } = await import('../docker-hadolint.mjs')

describe('HADOLINT_IMAGE', () => {
  test('канонічна версія v2.12.0 з docker.mdc', () => {
    expect(HADOLINT_IMAGE).toBe('hadolint/hadolint:v2.12.0')
  })
})

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
    resolveCmdMock.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  test('PATH: hadolint знайдено + exit 0 → ok=true, via=hadolint', () => {
    resolveCmdMock.mockImplementation(name => (name === 'hadolint' ? '/usr/local/bin/hadolint' : null))
    spawnSyncMock.mockReturnValue({ status: 0, stdout: '', stderr: '' })
    const result = lintDockerfileWithHadolint('/repo', '/repo/Dockerfile')
    expect(result).toEqual({ ok: true, stdout: '', stderr: '', via: 'hadolint' })
    expect(spawnSyncMock).toHaveBeenCalledWith(
      '/usr/local/bin/hadolint',
      ['Dockerfile'],
      expect.objectContaining({ cwd: '/repo', encoding: 'utf8' })
    )
  })

  test('PATH: hadolint знайдено + exit !=0 → ok=false, stdout/stderr пропагуються', () => {
    resolveCmdMock.mockImplementation(name => (name === 'hadolint' ? '/usr/bin/hadolint' : null))
    spawnSyncMock.mockReturnValue({ status: 1, stdout: 'DL3000', stderr: 'warning' })
    const result = lintDockerfileWithHadolint('/repo', '/repo/Dockerfile')
    expect(result).toEqual({ ok: false, stdout: 'DL3000', stderr: 'warning', via: 'hadolint' })
  })

  test('PATH: stdout/stderr undefined → fallback на ""', () => {
    resolveCmdMock.mockImplementation(name => (name === 'hadolint' ? '/usr/bin/hadolint' : null))
    spawnSyncMock.mockReturnValue({ status: 0, stdout: undefined, stderr: undefined })
    const r = lintDockerfileWithHadolint('/repo', '/repo/Dockerfile')
    expect(r.stdout).toBe('')
    expect(r.stderr).toBe('')
  })

  test('hadolint відсутній + docker знайдено + exit 0 → ok=true, via=docker', () => {
    resolveCmdMock.mockImplementation(name => (name === 'docker' ? '/usr/bin/docker' : null))
    spawnSyncMock.mockReturnValue({ status: 0, stdout: 'OK', stderr: '' })
    const result = lintDockerfileWithHadolint('/repo', '/repo/Dockerfile')
    expect(result).toEqual({ ok: true, stdout: 'OK', stderr: '', via: 'docker' })
    expect(spawnSyncMock).toHaveBeenCalledWith(
      '/usr/bin/docker',
      ['run', '--rm', '-v', '/repo:/workdir', '-w', '/workdir', HADOLINT_IMAGE, 'Dockerfile'],
      expect.objectContaining({ cwd: '/repo', encoding: 'utf8' })
    )
  })

  test('hadolint відсутній + docker відсутній → ok=false з повідомленням про встановлення', () => {
    resolveCmdMock.mockReturnValue(null)
    const result = lintDockerfileWithHadolint('/repo', '/repo/Dockerfile')
    expect(result.ok).toBe(false)
    expect(result.via).toBe('docker')
    expect(result.stderr).toContain('Не знайдено hadolint у PATH')
    expect(result.stderr).toContain('docker.mdc')
    expect(spawnSyncMock).not.toHaveBeenCalled()
  })

  test('docker run кинув error → ok=false з error.message у stderr', () => {
    resolveCmdMock.mockImplementation(name => (name === 'docker' ? '/usr/bin/docker' : null))
    spawnSyncMock.mockReturnValue({ error: new Error('ENOENT'), status: null })
    const result = lintDockerfileWithHadolint('/repo', '/repo/Dockerfile')
    expect(result.ok).toBe(false)
    expect(result.stderr).toContain('ENOENT')
    expect(result.via).toBe('docker')
  })

  test('docker exit !=0 → ok=false, stdout/stderr пропагуються', () => {
    resolveCmdMock.mockImplementation(name => (name === 'docker' ? '/usr/bin/docker' : null))
    spawnSyncMock.mockReturnValue({ status: 2, stdout: 'lint failed', stderr: 'DL3000' })
    const result = lintDockerfileWithHadolint('/repo', '/repo/Dockerfile')
    expect(result).toEqual({ ok: false, stdout: 'lint failed', stderr: 'DL3000', via: 'docker' })
  })

  test('відносний шлях передається з прямими слешами навіть з вкладеною директорією', () => {
    resolveCmdMock.mockImplementation(name => (name === 'hadolint' ? '/h' : null))
    spawnSyncMock.mockReturnValue({ status: 0, stdout: '', stderr: '' })
    lintDockerfileWithHadolint('/repo', `/repo${sep}pkg${sep}sub${sep}Dockerfile`)
    expect(spawnSyncMock.mock.calls[0][1]).toEqual(['pkg/sub/Dockerfile'])
  })
})

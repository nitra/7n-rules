import { describe, expect, test, vi } from 'vitest'

vi.mock('node:child_process', () => ({ spawnSync: vi.fn(() => ({ status: 0, stdout: 'out', stderr: '' })) }))

const { defaultRunner } = await import('../provider.mjs')
const { spawnSync } = await import('node:child_process')

describe('defaultRunner (spawn-обгортки, замінений мок-ом child_process)', () => {
  test('hasUv: uv --version → true при exit 0', () => {
    expect(defaultRunner.hasUv()).toBe(true)
    expect(spawnSync).toHaveBeenCalledWith('uv', ['--version'], expect.any(Object))
  })

  test('runPytestCov: uv run pytest --cov з lcov-шляхом', () => {
    const code = defaultRunner.runPytestCov({ cwd: '/p', lcovPath: '/tmp/x.lcov' })
    expect(code).toBe(0)
    const call = vi.mocked(spawnSync).mock.calls.at(-1)
    expect(call[0]).toBe('uv')
    expect(call[1].join(' ')).toContain('pytest')
    expect(call[1].join(' ')).toContain('/tmp/x.lcov')
    expect(call[2]).toMatchObject({ cwd: '/p' })
  })

  test('runMutmut: uv run mutmut run у cwd', () => {
    expect(defaultRunner.runMutmut({ cwd: '/p' })).toBe(0)
    const call = vi.mocked(spawnSync).mock.calls.at(-1)
    expect(call[1].join(' ')).toContain('mutmut run')
  })

  test('mutmutResults: повертає stdout', () => {
    expect(defaultRunner.mutmutResults({ cwd: '/p' })).toBe('out')
  })

  test('mutmutShow: stdout для імені мутанта', () => {
    expect(defaultRunner.mutmutShow({ cwd: '/p', name: 'm.x__mutmut_1' })).toBe('out')
    const call = vi.mocked(spawnSync).mock.calls.at(-1)
    expect(call[1].join(' ')).toContain('m.x__mutmut_1')
  })

  test('spawn-помилка → безпечні значення', () => {
    vi.mocked(spawnSync).mockReturnValueOnce({ status: 1, error: new Error('x'), stdout: '', stderr: '' })
    expect(defaultRunner.hasUv()).toBe(false)
    vi.mocked(spawnSync).mockReturnValueOnce({ status: null, stdout: null, stderr: '' })
    expect(defaultRunner.runMutmut({ cwd: '/p' })).toBe(1)
  })
})

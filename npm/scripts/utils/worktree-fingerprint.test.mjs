import { describe, expect, it } from 'bun:test'
import { worktreeFingerprint } from './worktree-fingerprint.mjs'

describe('worktreeFingerprint', () => {
  it('returns string or null without throwing', () => {
    const result = worktreeFingerprint()
    expect(result === null || typeof result === 'string').toBe(true)
  })

  it('result is 64-char hex string when in a git repo', () => {
    const result = worktreeFingerprint()
    if (result !== null) {
      expect(result).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  it('two consecutive calls return same result', () => {
    const a = worktreeFingerprint()
    const b = worktreeFingerprint()
    expect(a).toBe(b)
  })

  it('returns null on git error (via mock spawn)', () => {
    const mockSpawn = () => ({ status: 1, error: new Error('no git'), stdout: '' })
    expect(worktreeFingerprint(mockSpawn)).toBeNull()
  })
})

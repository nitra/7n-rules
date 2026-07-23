import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { worktreeFingerprint } from '../worktree-fingerprint.mjs'

const HEX_FINGERPRINT_RE = /^[0-9a-f]{64}$/

/** @returns {{status:number, error:Error, stdout:string}} mock spawnSync для fallback-тесту */
function mockSpawnFail() {
  return { status: 1, error: new Error('no git'), stdout: '' }
}

describe('worktreeFingerprint', () => {
  it('returns string or null without throwing', () => {
    const result = worktreeFingerprint()
    expect(result === null || typeof result === 'string').toBe(true)
  })

  it('result is 64-char hex string when in a git repo', () => {
    const result = worktreeFingerprint()
    if (result !== null) {
      expect(result).toMatch(HEX_FINGERPRINT_RE)
    }
  })

  it('two consecutive calls return same result (ізольований репо — живе дерево мутують фонові процеси)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fp-repo-'))
    try {
      const git = args => spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
      git(['init', '-q'])
      writeFileSync(join(dir, 'a.txt'), 'a\n')
      git(['add', '.'])
      git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'])
      const spawnInDir = (cmd, args, opts) => spawnSync(cmd, args, { ...opts, cwd: dir })
      const a = worktreeFingerprint(spawnInDir)
      const b = worktreeFingerprint(spawnInDir)
      expect(a).toMatch(HEX_FINGERPRINT_RE)
      expect(a).toBe(b)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('returns null on git error (via mock spawn)', () => {
    expect(worktreeFingerprint(mockSpawnFail)).toBeNull()
  })
})

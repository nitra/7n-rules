import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { shouldDedup, withLock } from '../with-lock.mjs'

// --- unit tests for shouldDedup ---

describe('shouldDedup', () => {
  const now = Date.now()

  it('returns true when all conditions met', () => {
    expect(shouldDedup({ exitCode: 0, fingerprint: 'abc', finishedAt: now - 60_000 }, 'abc', 600_000)).toBe(true)
  })

  it('returns false when exitCode != 0', () => {
    expect(shouldDedup({ exitCode: 1, fingerprint: 'abc', finishedAt: now - 60_000 }, 'abc', 600_000)).toBe(false)
  })

  it('returns false when fingerprint mismatch', () => {
    expect(shouldDedup({ exitCode: 0, fingerprint: 'xyz', finishedAt: now - 60_000 }, 'abc', 600_000)).toBe(false)
  })

  it('returns false when TTL expired', () => {
    expect(shouldDedup({ exitCode: 0, fingerprint: 'abc', finishedAt: now - 700_000 }, 'abc', 600_000)).toBe(false)
  })

  it('returns false when fingerprint is null', () => {
    expect(shouldDedup({ exitCode: 0, fingerprint: 'abc', finishedAt: now }, null, 600_000)).toBe(false)
  })
})

// --- integration tests ---

describe('withLock integration', () => {
  let tmpDir

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'with-lock-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  const sleep = ms => new Promise(r => setTimeout(r, ms))

  it('serializes parallel calls', async () => {
    const start = Date.now()
    await Promise.all([
      withLock('test', () => sleep(200).then(() => 0), { cacheDir: path.join(tmpDir, 'a'), pollInterval: 50 }),
      withLock('test', () => sleep(200).then(() => 0), { cacheDir: path.join(tmpDir, 'a'), pollInterval: 50 }),
    ])
    expect(Date.now() - start).toBeGreaterThanOrEqual(400)
  }, 10_000)

  it('deduplicates on same fingerprint', async () => {
    let calls = 0
    const fn = () => { calls++; return Promise.resolve(0) }
    const getFingerprint = () => 'a'.repeat(64)
    const lockOpts = { cacheDir: path.join(tmpDir, 'b'), ttl: 60_000, getFingerprint }
    await withLock('test', fn, lockOpts)
    await withLock('test', fn, lockOpts)
    expect(calls).toBe(1)
  })

  it('releases lock on runFn error', async () => {
    const cacheDir = path.join(tmpDir, 'c')
    const lockDir = path.join(cacheDir, 'lock')
    try {
      await withLock('test', () => { throw new Error('fail') }, { cacheDir })
    } catch {}
    expect(fs.existsSync(lockDir)).toBe(false)
  })
})

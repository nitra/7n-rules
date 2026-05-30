import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import { join } from 'node:path'
import { hostname } from 'node:os'
import { setTimeout as sleep } from 'node:timers/promises'
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
    tmpDir = fs.mkdtempSync(join(os.tmpdir(), 'with-lock-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('serializes parallel calls', async () => {
    const start = Date.now()
    // getFingerprint: () => null вимикає дедуп — тут перевіряємо рівно серіалізацію,
    // не короткий замикач через однаковий fingerprint (для цього є окремий тест нижче).
    const opts = { cacheDir: join(tmpDir, 'a'), pollInterval: 50, getFingerprint: () => null }
    await Promise.all([
      withLock('test', () => sleep(200).then(() => 0), opts),
      withLock('test', () => sleep(200).then(() => 0), opts)
    ])
    expect(Date.now() - start).toBeGreaterThanOrEqual(400)
  }, 10_000)

  it('deduplicates on same fingerprint', async () => {
    let calls = 0
    const fn = () => {
      calls++
      return Promise.resolve(0)
    }
    const lockOpts = {
      cacheDir: join(tmpDir, 'b'),
      ttl: 60_000,
      getFingerprint: () => 'a'.repeat(64)
    }
    await withLock('test', fn, lockOpts)
    await withLock('test', fn, lockOpts)
    expect(calls).toBe(1)
  })

  it('releases lock on runFn error', async () => {
    const cacheDir = join(tmpDir, 'c')
    const lockDir = join(cacheDir, 'lock')
    try {
      await withLock(
        'test',
        () => {
          throw new Error('fail')
        },
        { cacheDir }
      )
    } catch {
      /* runFn навмисно кидає — перевіряємо звільнення локу */
    }
    expect(fs.existsSync(lockDir)).toBe(false)
  })

  it('видаляє застарілий лок з нежиттєздатним PID і продовжує', async () => {
    const cacheDir = join(tmpDir, 'd')
    const lockDir = join(cacheDir, 'lock')
    fs.mkdirSync(lockDir, { recursive: true })
    // PID 999999999 гарантовано не існує
    fs.writeFileSync(
      join(lockDir, 'owner.json'),
      JSON.stringify({ pid: 999_999_999, host: hostname(), startedAt: Date.now(), fingerprint: null })
    )
    let ran = false
    const code = await withLock('test', () => { ran = true; return 0 }, { cacheDir, getFingerprint: () => null })
    expect(ran).toBe(true)
    expect(code).toBe(0)
  })

  it('видаляє лок з пошкодженим owner.json і продовжує', async () => {
    const cacheDir = join(tmpDir, 'e')
    const lockDir = join(cacheDir, 'lock')
    fs.mkdirSync(lockDir, { recursive: true })
    fs.writeFileSync(join(lockDir, 'owner.json'), 'NOT JSON{{{')
    let ran = false
    const code = await withLock('test', () => { ran = true; return 0 }, { cacheDir, getFingerprint: () => null })
    expect(ran).toBe(true)
    expect(code).toBe(0)
  })

  it('виконує runFn коли timeout вичерпано', async () => {
    const cacheDir = join(tmpDir, 'f')
    const lockDir = join(cacheDir, 'lock')
    fs.mkdirSync(lockDir, { recursive: true })
    // lock існує, але нас одразу відправлять у timeout-гілку
    fs.writeFileSync(
      join(lockDir, 'owner.json'),
      JSON.stringify({ pid: process.pid, host: 'other-host', startedAt: Date.now(), fingerprint: null })
    )
    let ran = false
    const code = await withLock('test', () => { ran = true; return 42 }, {
      cacheDir,
      waitTimeout: 1,
      pollInterval: 10,
      getFingerprint: () => null
    })
    expect(ran).toBe(true)
    expect(code).toBe(42)
  })
})

import { describe, expect, test } from 'vitest'

import { spawnAsync } from '../spawn-async.mjs'

describe('spawnAsync', () => {
  test('exit code і stdout passthrough', async () => {
    const result = await spawnAsync(process.execPath, ['-e', 'process.stdout.write("hi"); process.exit(3)'])
    expect(result.exitCode).toBe(3)
    expect(result.stdout).toBe('hi')
    expect(result.timedOut).toBe(false)
    expect(result.aborted).toBe(false)
  })

  test('stderr збирається окремо від stdout', async () => {
    const result = await spawnAsync(process.execPath, ['-e', 'process.stderr.write("boom"); process.exit(1)'])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toBe('boom')
  })

  test('spawn-помилка (неіснуючий бінарник) кидає', async () => {
    await expect(spawnAsync('n-rules-definitely-not-a-real-binary', [])).rejects.toThrow()
  })

  test('timeoutMs вбиває child і позначає timedOut', async () => {
    const result = await spawnAsync(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { timeoutMs: 200 })
    expect(result.timedOut).toBe(true)
    expect(result.exitCode).not.toBe(0)
  })

  test('зовнішній AbortSignal вбиває child і позначає aborted', async () => {
    const controller = new AbortController()
    const pending = spawnAsync(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { signal: controller.signal })
    setTimeout(() => controller.abort(), 100)
    const result = await pending
    expect(result.aborted).toBe(true)
    expect(result.exitCode).not.toBe(0)
  })

  test('вже-скасований signal кидає AbortError без спавна', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(spawnAsync(process.execPath, ['-e', '1'], { signal: controller.signal })).rejects.toThrow('aborted')
  })
})

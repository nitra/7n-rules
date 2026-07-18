/**
 * `runConftestBatch` — signal/timeoutMs passthrough у `spawnAsync` (ADR 260716-1354).
 * Окремий файл від `run-conftest-batch.test.mjs`: тут `ensureToolAsync`/`spawnAsync`
 * повністю мокаються (жодного реального PATH-резолву чи install-логіки), тоді як
 * сусідній файл навмисно перевіряє real hard-fail шлях (`withBinRemovedFromPath`) —
 * змішувати обидва стилі мокування в одному файлі означало б module-wide `vi.mock`,
 * що зламав би real-path тести сусіднього файлу.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { withTmpDir } from '../../utils/test-helpers.mjs'

const spawnAsyncMock = vi.fn()

vi.mock('../ensure-tool.mjs', () => ({
  ensureToolAsync: vi.fn().mockResolvedValue('/usr/local/bin/conftest')
}))
vi.mock('../../utils/spawn-async.mjs', () => ({
  spawnAsync: spawnAsyncMock
}))

const { runConftestBatch } = await import('../run-conftest-batch.mjs')

afterEach(() => {
  vi.clearAllMocks()
})

describe('runConftestBatch — signal/timeoutMs passthrough', () => {
  test('прокидає opts.signal і opts.timeoutMs у spawnAsync', async () => {
    spawnAsyncMock.mockResolvedValue({ stdout: '[]', stderr: '', exitCode: 0 })
    const controller = new AbortController()

    await withTmpDir(async dir => {
      const fakeFile = join(dir, 'a.json')
      writeFileSync(fakeFile, '{}')
      await runConftestBatch({
        files: [fakeFile],
        policyDirRel: 'abie/base_deployment_preem',
        namespace: 'abie.base_deployment_preem',
        signal: controller.signal,
        timeoutMs: 5000
      })
    })

    expect(spawnAsyncMock).toHaveBeenCalledTimes(1)
    const opts = spawnAsyncMock.mock.calls[0][2]
    expect(opts.signal).toBe(controller.signal)
    expect(opts.timeoutMs).toBe(5000)
  })

  test('timedOut/aborted (exitCode null) з spawnAsync стає помилкою, не тихим успіхом', async () => {
    spawnAsyncMock.mockResolvedValue({ stdout: '', stderr: 'killed', exitCode: null, timedOut: true, aborted: false })

    await withTmpDir(async dir => {
      const fakeFile = join(dir, 'a.json')
      writeFileSync(fakeFile, '{}')
      await expect(
        runConftestBatch({
          files: [fakeFile],
          policyDirRel: 'abie/base_deployment_preem',
          namespace: 'abie.base_deployment_preem',
          timeoutMs: 10
        })
      ).rejects.toThrow('conftest exit')
    })
  })
})

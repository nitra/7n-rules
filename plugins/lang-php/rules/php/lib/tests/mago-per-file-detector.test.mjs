/**
 * Тести спільної фабрики `createMagoPerFileDetector` (`../mago-per-file-detector.mjs`):
 * `ensureToolAsync`/`spawnAsync` мокаються. Concern-специфічні тести (`mago_fmt`,
 * `mago_lint`) перевіряють інтеграцію (правильні `magoArgs`/`reason` передані у фабрику);
 * тут — сама фабрика: composer.json gate, targets, happy/violation/generic-exit-code.
 */
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, test, vi } from 'vitest'

const ensureToolAsyncMock = vi.fn()
const spawnAsyncMock = vi.fn()
vi.mock('@7n/rules/scripts/lib/ensure-tool.mjs', () => ({ ensureToolAsync: ensureToolAsyncMock }))
vi.mock('@7n/rules/scripts/utils/spawn-async.mjs', () => ({ spawnAsync: spawnAsyncMock }))

const { createMagoPerFileDetector } = await import('../mago-per-file-detector.mjs')
const { withTmpDir } = await import('@7n/rules/scripts/utils/test-helpers.mjs')

const MAGO_BIN = '/usr/local/bin/mago'

const DETECTOR_OPTS = {
  magoArgs: ['demo-cmd', '--flag'],
  reason: 'demo-reason',
  label: 'mago demo-cmd — сталася штука',
  mdcName: 'demo.mdc'
}

describe('createMagoPerFileDetector', () => {
  test('немає composer.json → без порушень, mago не резолвиться/не спавниться', async () => {
    ensureToolAsyncMock.mockReset()
    spawnAsyncMock.mockReset()
    const lint = createMagoPerFileDetector(DETECTOR_OPTS)
    await withTmpDir(async dir => {
      const { violations } = await lint({ cwd: dir, ruleId: 'php', concernId: 'demo' })
      expect(violations).toHaveLength(0)
      expect(ensureToolAsyncMock).not.toHaveBeenCalled()
      expect(spawnAsyncMock).not.toHaveBeenCalled()
    })
  })

  test('composer.json є, ctx.files без .php → без порушень, mago не спавниться', async () => {
    ensureToolAsyncMock.mockReset()
    spawnAsyncMock.mockReset()
    const lint = createMagoPerFileDetector(DETECTOR_OPTS)
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'composer.json'), '{}', 'utf8')
      const { violations } = await lint({ cwd: dir, ruleId: 'php', concernId: 'demo', files: ['README.md'] })
      expect(violations).toHaveLength(0)
      expect(spawnAsyncMock).not.toHaveBeenCalled()
    })
  })

  test('ctx.files === undefined → targets = ["."]', async () => {
    ensureToolAsyncMock.mockReset()
    spawnAsyncMock.mockReset()
    ensureToolAsyncMock.mockResolvedValue(MAGO_BIN)
    spawnAsyncMock.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' })
    const lint = createMagoPerFileDetector(DETECTOR_OPTS)
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'composer.json'), '{}', 'utf8')
      await lint({ cwd: dir, ruleId: 'php', concernId: 'demo' })
      expect(spawnAsyncMock).toHaveBeenCalledWith(
        MAGO_BIN,
        ['demo-cmd', '--flag', '.'],
        expect.objectContaining({ cwd: dir })
      )
    })
  })

  test('happy-path: exit 0 → без порушень', async () => {
    ensureToolAsyncMock.mockReset()
    spawnAsyncMock.mockReset()
    ensureToolAsyncMock.mockResolvedValue(MAGO_BIN)
    spawnAsyncMock.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' })
    const lint = createMagoPerFileDetector(DETECTOR_OPTS)
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'composer.json'), '{}', 'utf8')
      const { violations } = await lint({ cwd: dir, ruleId: 'php', concernId: 'demo', files: ['a.php'] })
      expect(violations).toHaveLength(0)
      expect(spawnAsyncMock).toHaveBeenCalledWith(
        MAGO_BIN,
        ['demo-cmd', '--flag', 'a.php'],
        expect.objectContaining({ cwd: dir })
      )
    })
  })

  test('non-zero exit → violation з reason/label/mdcName і виводом', async () => {
    ensureToolAsyncMock.mockReset()
    spawnAsyncMock.mockReset()
    ensureToolAsyncMock.mockResolvedValue(MAGO_BIN)
    spawnAsyncMock.mockResolvedValue({ exitCode: 1, stdout: 'boom output', stderr: '' })
    const lint = createMagoPerFileDetector(DETECTOR_OPTS)
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'composer.json'), '{}', 'utf8')
      const { violations } = await lint({ cwd: dir, ruleId: 'php', concernId: 'demo', files: ['a.php'] })
      expect(violations).toHaveLength(1)
      expect(violations[0].reason).toBe('demo-reason')
      expect(violations[0].message).toContain('mago demo-cmd — сталася штука')
      expect(violations[0].message).toContain('demo.mdc')
      expect(violations[0].message).toContain('код 1')
      expect(violations[0].message).toContain('boom output')
    })
  })

  test('non-zero exitCode нечислового типу → трактується як код 1', async () => {
    ensureToolAsyncMock.mockReset()
    spawnAsyncMock.mockReset()
    ensureToolAsyncMock.mockResolvedValue(MAGO_BIN)
    spawnAsyncMock.mockResolvedValue({ exitCode: null, stdout: '', stderr: 'segfault' })
    const lint = createMagoPerFileDetector(DETECTOR_OPTS)
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'composer.json'), '{}', 'utf8')
      const { violations } = await lint({ cwd: dir, ruleId: 'php', concernId: 'demo', files: ['a.php'] })
      expect(violations).toHaveLength(1)
      expect(violations[0].message).toContain('код 1')
      expect(violations[0].message).toContain('segfault')
    })
  })
})

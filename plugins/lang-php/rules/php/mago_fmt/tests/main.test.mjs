/**
 * Тести detector-а `php/mago_fmt` (main.mjs): `ensureToolAsync`/`spawnAsync` мокаються —
 * реальний `mago` не запускається. Окремий файл `main-hard-fail.test.mjs` перевіряє real
 * hard-fail шлях (`ensureToolAsync` без моків, `withBinRemovedFromPath`) — змішувати обидва
 * стилі мокування в одному файлі означало б module-wide `vi.mock`, що зламав би той тест
 * (той самий патерн, що `run-conftest-batch.test.mjs` / `run-conftest-batch-async.test.mjs`).
 *
 * Формат виводу `mago format --dry-run` у violation-тесті — фактичний, знятий реальним
 * прогоном на фікстурі (`diff of '<path>': --- original +++ modified … INFO Found N
 * file(s) that need formatting.`, exit code 1).
 */
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, test, vi } from 'vitest'

const ensureToolAsyncMock = vi.fn()
const spawnAsyncMock = vi.fn()
vi.mock('@7n/rules/scripts/lib/ensure-tool.mjs', () => ({ ensureToolAsync: ensureToolAsyncMock }))
vi.mock('@7n/rules/scripts/utils/spawn-async.mjs', () => ({ spawnAsync: spawnAsyncMock }))

const { lint } = await import('../main.mjs')
const { withTmpDir } = await import('@7n/rules/scripts/utils/test-helpers.mjs')

const MAGO_BIN = '/usr/local/bin/mago'

/** Реальний вивід `mago format --dry-run` на неформатованому файлі (знято ручним прогоном). */
const MAGO_FORMAT_DIFF_OUTPUT = `diff of '/tmp/unformatted.php':
--- original
+++ modified
@@ -1,4 +1,6 @@
 <?php
-function add($a,$b) {
-return $a+$b;
+
+function add($a, $b)
+{
+    return $a + $b;
 }

 INFO Found 1 file(s) that need formatting.`

describe('php/mago_fmt detector', () => {
  test('немає composer.json → без порушень, mago не резолвиться/не спавниться', async () => {
    ensureToolAsyncMock.mockReset()
    spawnAsyncMock.mockReset()
    await withTmpDir(async dir => {
      const { violations } = await lint({ cwd: dir, ruleId: 'php', concernId: 'mago_fmt' })
      expect(violations).toHaveLength(0)
      expect(ensureToolAsyncMock).not.toHaveBeenCalled()
      expect(spawnAsyncMock).not.toHaveBeenCalled()
    })
  })

  test('composer.json є, ctx.files без .php → без порушень, mago не спавниться', async () => {
    ensureToolAsyncMock.mockReset()
    spawnAsyncMock.mockReset()
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'composer.json'), '{}', 'utf8')
      const { violations } = await lint({ cwd: dir, ruleId: 'php', concernId: 'mago_fmt', files: ['README.md'] })
      expect(violations).toHaveLength(0)
      expect(spawnAsyncMock).not.toHaveBeenCalled()
    })
  })

  test('happy-path: mago format --dry-run exit 0 → без порушень', async () => {
    ensureToolAsyncMock.mockReset()
    spawnAsyncMock.mockReset()
    ensureToolAsyncMock.mockResolvedValue(MAGO_BIN)
    spawnAsyncMock.mockResolvedValue({ exitCode: 0, stdout: ' INFO All files are already formatted.\n', stderr: '' })
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'composer.json'), '{}', 'utf8')
      const { violations } = await lint({
        cwd: dir,
        ruleId: 'php',
        concernId: 'mago_fmt',
        files: ['src/Formatted.php']
      })
      expect(violations).toHaveLength(0)
      expect(spawnAsyncMock).toHaveBeenCalledWith(
        MAGO_BIN,
        ['format', '--dry-run', 'src/Formatted.php'],
        expect.objectContaining({ cwd: dir })
      )
    })
  })

  test('ctx.files === undefined (full-scope) → targets = ["."]', async () => {
    ensureToolAsyncMock.mockReset()
    spawnAsyncMock.mockReset()
    ensureToolAsyncMock.mockResolvedValue(MAGO_BIN)
    spawnAsyncMock.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' })
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'composer.json'), '{}', 'utf8')
      await lint({ cwd: dir, ruleId: 'php', concernId: 'mago_fmt' })
      expect(spawnAsyncMock).toHaveBeenCalledWith(MAGO_BIN, ['format', '--dry-run', '.'], expect.objectContaining({}))
    })
  })

  test('неформатований файл (exit 1) → mago-fmt-unformatted з реальним diff-виводом у message', async () => {
    ensureToolAsyncMock.mockReset()
    spawnAsyncMock.mockReset()
    ensureToolAsyncMock.mockResolvedValue(MAGO_BIN)
    spawnAsyncMock.mockResolvedValue({ exitCode: 1, stdout: MAGO_FORMAT_DIFF_OUTPUT, stderr: '' })
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'composer.json'), '{}', 'utf8')
      const { violations } = await lint({
        cwd: dir,
        ruleId: 'php',
        concernId: 'mago_fmt',
        files: ['src/Unformatted.php']
      })
      expect(violations).toHaveLength(1)
      expect(violations[0].reason).toBe('mago-fmt-unformatted')
      expect(violations[0].message).toContain('INFO Found 1 file(s) that need formatting.')
      expect(violations[0].message).toContain('код 1')
    })
  })

  test('non-zero exitCode нечислового типу → трактується як код 1 у повідомленні', async () => {
    ensureToolAsyncMock.mockReset()
    spawnAsyncMock.mockReset()
    ensureToolAsyncMock.mockResolvedValue(MAGO_BIN)
    spawnAsyncMock.mockResolvedValue({ exitCode: null, stdout: '', stderr: 'segfault' })
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'composer.json'), '{}', 'utf8')
      const { violations } = await lint({ cwd: dir, ruleId: 'php', concernId: 'mago_fmt', files: ['a.php'] })
      expect(violations).toHaveLength(1)
      expect(violations[0].message).toContain('код 1')
      expect(violations[0].message).toContain('segfault')
    })
  })
})

/**
 * Тести detector-а `php/mago_lint` (main.mjs): `ensureToolAsync`/`spawnAsync` мокаються —
 * реальний `mago` не запускається. Окремий файл `main-hard-fail.test.mjs` перевіряє real
 * hard-fail шлях без моків (патерн `run-conftest-batch.test.mjs`/`-async.test.mjs`).
 *
 * Формат виводу `mago lint` у violation-тесті — фактичний, знятий реальним прогоном на
 * фікстурі із синтаксичною помилкою (`<path>:L:C: error[parse]: … error: found N issues: …`,
 * exit code 1). Warning-only вивід (наприклад `strict-types`) НЕ валить exit code за
 * дефолтним `--minimum-fail-level=error` mago — окремий тест це документує.
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

/** Реальний вивід `mago lint` на синтаксично битому файлі (знято ручним прогоном), exit 1. */
const MAGO_LINT_PARSE_ERROR_OUTPUT = `/tmp/syntax_error.php:2:18: error[parse]: Parse error encountered during parsing
 = This error indicates that the parser encountered a parse issue.
 = Help: Check the syntax of your code.
error: found 3 issues: 3 error(s)`

/** Реальний вивід `mago lint` з лише warning (strict-types) — exit 0 (дефолт fail-level=error). */
const MAGO_LINT_WARNING_ONLY_OUTPUT = `/tmp/unformatted.php:1:1: warning[strict-types]: Missing \`declare(strict_types=1);\` statement at the beginning of the file.
warning: found 1 issues: 1 warning(s)`

describe('php/mago_lint detector', () => {
  test('немає composer.json → без порушень, mago не резолвиться/не спавниться', async () => {
    ensureToolAsyncMock.mockReset()
    spawnAsyncMock.mockReset()
    await withTmpDir(async dir => {
      const { violations } = await lint({ cwd: dir, ruleId: 'php', concernId: 'mago_lint' })
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
      const { violations } = await lint({ cwd: dir, ruleId: 'php', concernId: 'mago_lint', files: ['README.md'] })
      expect(violations).toHaveLength(0)
      expect(spawnAsyncMock).not.toHaveBeenCalled()
    })
  })

  test('happy-path: mago lint exit 0, без порушень у виводі → без порушень', async () => {
    ensureToolAsyncMock.mockReset()
    spawnAsyncMock.mockReset()
    ensureToolAsyncMock.mockResolvedValue(MAGO_BIN)
    spawnAsyncMock.mockResolvedValue({ exitCode: 0, stdout: ' INFO No issues found.\n', stderr: '' })
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'composer.json'), '{}', 'utf8')
      const { violations } = await lint({ cwd: dir, ruleId: 'php', concernId: 'mago_lint', files: ['src/Clean.php'] })
      expect(violations).toHaveLength(0)
      expect(spawnAsyncMock).toHaveBeenCalledWith(
        MAGO_BIN,
        ['lint', 'src/Clean.php'],
        expect.objectContaining({ cwd: dir })
      )
    })
  })

  test('лише warning (strict-types), exit 0 (дефолт fail-level=error) → без порушень', async () => {
    ensureToolAsyncMock.mockReset()
    spawnAsyncMock.mockReset()
    ensureToolAsyncMock.mockResolvedValue(MAGO_BIN)
    spawnAsyncMock.mockResolvedValue({ exitCode: 0, stdout: MAGO_LINT_WARNING_ONLY_OUTPUT, stderr: '' })
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'composer.json'), '{}', 'utf8')
      const { violations } = await lint({ cwd: dir, ruleId: 'php', concernId: 'mago_lint', files: ['a.php'] })
      expect(violations).toHaveLength(0)
    })
  })

  test('ctx.files === undefined (full-scope) → targets = ["."]', async () => {
    ensureToolAsyncMock.mockReset()
    spawnAsyncMock.mockReset()
    ensureToolAsyncMock.mockResolvedValue(MAGO_BIN)
    spawnAsyncMock.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' })
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'composer.json'), '{}', 'utf8')
      await lint({ cwd: dir, ruleId: 'php', concernId: 'mago_lint' })
      expect(spawnAsyncMock).toHaveBeenCalledWith(MAGO_BIN, ['lint', '.'], expect.objectContaining({}))
    })
  })

  test('error-рівня порушення (exit 1) → mago-lint з реальним parse-error виводом у message', async () => {
    ensureToolAsyncMock.mockReset()
    spawnAsyncMock.mockReset()
    ensureToolAsyncMock.mockResolvedValue(MAGO_BIN)
    spawnAsyncMock.mockResolvedValue({ exitCode: 1, stdout: MAGO_LINT_PARSE_ERROR_OUTPUT, stderr: '' })
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'composer.json'), '{}', 'utf8')
      const { violations } = await lint({ cwd: dir, ruleId: 'php', concernId: 'mago_lint', files: ['src/Broken.php'] })
      expect(violations).toHaveLength(1)
      expect(violations[0].reason).toBe('mago-lint')
      expect(violations[0].message).toContain('error[parse]')
      expect(violations[0].message).toContain('код 1')
    })
  })
})

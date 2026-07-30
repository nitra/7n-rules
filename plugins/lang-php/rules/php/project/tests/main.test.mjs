/**
 * Тести detector-а `php/project` (main.mjs): `resolveCmd`/`spawnAsync`/`ensureToolAsync`
 * мокаються — реальні `composer`/`mago` не запускаються. `composer audit` лишається
 * обов'язковим байт-у-байт як до заміни PHPStan/Psalm на `mago analyze` (reason ids
 * `composer-missing`/`composer-audit-violation` не змінились); нові кейси покривають
 * `mago analyze` — виклик з/без `--php-version` (з `require.php` composer.json) і
 * non-zero exit → `mago-analyze`.
 */
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, test, vi } from 'vitest'

const resolveCmdMock = vi.fn()
const spawnAsyncMock = vi.fn()
const ensureToolAsyncMock = vi.fn()
vi.mock('@7n/rules/scripts/utils/resolve-cmd.mjs', () => ({ resolveCmd: resolveCmdMock }))
vi.mock('@7n/rules/scripts/utils/spawn-async.mjs', () => ({ spawnAsync: spawnAsyncMock }))
vi.mock('@7n/rules/scripts/lib/ensure-tool.mjs', () => ({ ensureToolAsync: ensureToolAsyncMock }))

const { lint, extractPhpVersion } = await import('../main.mjs')
const { withTmpDir } = await import('@7n/rules/scripts/utils/test-helpers.mjs')

const COMPOSER_BIN = '/usr/local/bin/composer'
const MAGO_BIN = '/usr/local/bin/mago'

/** Скидає всі моки й виставляє «щасливий» дефолт (composer знайдено, обидва тули OK). */
function resetMocksHappy() {
  resolveCmdMock.mockReset()
  spawnAsyncMock.mockReset()
  ensureToolAsyncMock.mockReset()
  resolveCmdMock.mockReturnValue(COMPOSER_BIN)
  ensureToolAsyncMock.mockResolvedValue(MAGO_BIN)
  spawnAsyncMock.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' })
}

describe('extractPhpVersion', () => {
  test.each([
    ['>=8.2', '8.2'],
    ['^8.2', '8.2'],
    ['~8.2.0', '8.2'],
    ['8.2.*', '8.2'],
    ['8.1 || 8.2', '8.1'],
    ['*', null],
    ['', null],
    [undefined, null],
    [null, null],
    [42, null]
  ])('%j → %j', (input, expected) => {
    expect(extractPhpVersion(input)).toBe(expected)
  })
})

describe('php/project detector', () => {
  test('немає composer.json → без порушень, жоден тул не викликається', async () => {
    resetMocksHappy()
    await withTmpDir(async dir => {
      const { violations } = await lint({ cwd: dir, ruleId: 'php', concernId: 'project' })
      expect(violations).toHaveLength(0)
      expect(spawnAsyncMock).not.toHaveBeenCalled()
      expect(ensureToolAsyncMock).not.toHaveBeenCalled()
    })
  })

  test('composer.json є, composer відсутній у PATH → composer-missing, mago не резолвиться', async () => {
    resetMocksHappy()
    resolveCmdMock.mockReturnValue(null)
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'composer.json'), '{}', 'utf8')
      const { violations } = await lint({ cwd: dir, ruleId: 'php', concernId: 'project' })
      expect(violations).toHaveLength(1)
      expect(violations[0].reason).toBe('composer-missing')
      expect(ensureToolAsyncMock).not.toHaveBeenCalled()
    })
  })

  test('composer audit падає → composer-audit-violation, mago analyze НЕ викликається (short-circuit)', async () => {
    resetMocksHappy()
    spawnAsyncMock.mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'vulnerable package found' })
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'composer.json'), '{}', 'utf8')
      const { violations } = await lint({ cwd: dir, ruleId: 'php', concernId: 'project' })
      expect(violations).toHaveLength(1)
      expect(violations[0].reason).toBe('composer-audit-violation')
      expect(violations[0].message).toContain('vulnerable package found')
      expect(ensureToolAsyncMock).not.toHaveBeenCalled()
      expect(spawnAsyncMock).toHaveBeenCalledTimes(1)
    })
  })

  test('composer audit OK, немає require.php → mago analyze без --php-version', async () => {
    resetMocksHappy()
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'composer.json'), JSON.stringify({ name: 'nitra/demo' }), 'utf8')
      const { violations } = await lint({ cwd: dir, ruleId: 'php', concernId: 'project' })
      expect(violations).toHaveLength(0)
      expect(spawnAsyncMock).toHaveBeenNthCalledWith(2, MAGO_BIN, ['analyze'], expect.objectContaining({ cwd: dir }))
    })
  })

  test('composer audit OK, require.php = ">=8.2" → mago analyze з --php-version 8.2', async () => {
    resetMocksHappy()
    await withTmpDir(async dir => {
      await writeFile(
        join(dir, 'composer.json'),
        JSON.stringify({ name: 'nitra/demo', require: { php: '>=8.2' } }),
        'utf8'
      )
      const { violations } = await lint({ cwd: dir, ruleId: 'php', concernId: 'project' })
      expect(violations).toHaveLength(0)
      expect(spawnAsyncMock).toHaveBeenNthCalledWith(
        2,
        MAGO_BIN,
        ['--php-version', '8.2', 'analyze'],
        expect.objectContaining({ cwd: dir })
      )
    })
  })

  test('composer.json — битий JSON → mago analyze без --php-version (тихий fallback, без винятку)', async () => {
    resetMocksHappy()
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'composer.json'), '{ not valid json', 'utf8')
      const { violations } = await lint({ cwd: dir, ruleId: 'php', concernId: 'project' })
      expect(violations).toHaveLength(0)
      expect(spawnAsyncMock).toHaveBeenNthCalledWith(2, MAGO_BIN, ['analyze'], expect.objectContaining({}))
    })
  })

  test('mago analyze падає → mago-analyze з виводом', async () => {
    resetMocksHappy()
    spawnAsyncMock.mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' }) // composer audit OK
    spawnAsyncMock.mockResolvedValueOnce({
      exitCode: 1,
      stdout: 'error[undefined-method]: Call to undefined method.',
      stderr: ''
    })
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'composer.json'), '{}', 'utf8')
      const { violations } = await lint({ cwd: dir, ruleId: 'php', concernId: 'project' })
      expect(violations).toHaveLength(1)
      expect(violations[0].reason).toBe('mago-analyze')
      expect(violations[0].message).toContain('undefined-method')
    })
  })
})

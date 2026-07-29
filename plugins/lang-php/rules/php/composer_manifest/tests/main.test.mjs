/**
 * Тести detector-а `php/composer_manifest` (main.mjs): `spawnAsync`/`resolveCmd`
 * мокаються — реальний `composer` не запускається. Перевіряє декларативні перевірки
 * (JSON, sort-packages, license, require.php), опційний `composer validate --strict`
 * і тихий skip (для всіх перевірок) коли composer.json відсутній.
 */
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, test, vi } from 'vitest'

const spawnAsyncMock = vi.fn()
const resolveCmdMock = vi.fn()
vi.mock('@7n/rules/scripts/utils/spawn-async.mjs', () => ({ spawnAsync: spawnAsyncMock }))
vi.mock('@7n/rules/scripts/utils/resolve-cmd.mjs', () => ({ resolveCmd: resolveCmdMock }))

const { lint } = await import('../main.mjs')
const { withTmpDir } = await import('@7n/rules/scripts/utils/test-helpers.mjs')

/** Канонічний composer.json без порушень (composer недоступний — validate скіпається). */
const CANON_MANIFEST = {
  name: 'nitra/demo',
  license: 'MIT',
  require: { php: '>=8.5' },
  config: { 'sort-packages': true }
}

describe('php/composer_manifest detector', () => {
  test('немає composer.json → без порушень, spawnAsync/resolveCmd не викликаються', async () => {
    spawnAsyncMock.mockReset()
    resolveCmdMock.mockReset()
    await withTmpDir(async dir => {
      const { violations } = await lint({ cwd: dir, ruleId: 'php', concernId: 'composer_manifest' })
      expect(violations).toHaveLength(0)
      expect(spawnAsyncMock).not.toHaveBeenCalled()
      expect(resolveCmdMock).not.toHaveBeenCalled()
    })
  })

  test('канонічний composer.json, composer відсутній у PATH → без порушень (тихий skip validate)', async () => {
    spawnAsyncMock.mockReset()
    resolveCmdMock.mockReset()
    resolveCmdMock.mockReturnValue(null)
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'composer.json'), JSON.stringify(CANON_MANIFEST), 'utf8')
      const { violations } = await lint({ cwd: dir, ruleId: 'php', concernId: 'composer_manifest' })
      expect(violations).toHaveLength(0)
      expect(spawnAsyncMock).not.toHaveBeenCalled()
    })
  })

  test('канонічний composer.json, composer є, validate успішний → без порушень', async () => {
    spawnAsyncMock.mockReset()
    resolveCmdMock.mockReset()
    resolveCmdMock.mockReturnValue('/usr/local/bin/composer')
    spawnAsyncMock.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' })
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'composer.json'), JSON.stringify(CANON_MANIFEST), 'utf8')
      const { violations } = await lint({ cwd: dir, ruleId: 'php', concernId: 'composer_manifest' })
      expect(violations).toHaveLength(0)
      expect(spawnAsyncMock).toHaveBeenCalledWith(
        '/usr/local/bin/composer',
        ['validate', '--strict', '--no-check-publish'],
        expect.objectContaining({ cwd: dir })
      )
    })
  })

  test('битий JSON → composer-manifest-invalid-json, без винятку, composer не викликається', async () => {
    spawnAsyncMock.mockReset()
    resolveCmdMock.mockReset()
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'composer.json'), '{ "name": "nitra/demo", ', 'utf8')
      const { violations } = await lint({ cwd: dir, ruleId: 'php', concernId: 'composer_manifest' })
      expect(violations).toHaveLength(1)
      expect(violations[0].reason).toBe('composer-manifest-invalid-json')
      expect(spawnAsyncMock).not.toHaveBeenCalled()
    })
  })

  test('config.sort-packages не true → composer-manifest-sort-packages', async () => {
    spawnAsyncMock.mockReset()
    resolveCmdMock.mockReset()
    resolveCmdMock.mockReturnValue(null)
    await withTmpDir(async dir => {
      const manifest = { ...CANON_MANIFEST, config: {} }
      await writeFile(join(dir, 'composer.json'), JSON.stringify(manifest), 'utf8')
      const { violations } = await lint({ cwd: dir, ruleId: 'php', concernId: 'composer_manifest' })
      expect(violations.map(v => v.reason)).toEqual(['composer-manifest-sort-packages'])
    })
  })

  test('відсутнє config → composer-manifest-sort-packages', async () => {
    spawnAsyncMock.mockReset()
    resolveCmdMock.mockReset()
    resolveCmdMock.mockReturnValue(null)
    await withTmpDir(async dir => {
      const { config: _config, ...manifest } = CANON_MANIFEST
      await writeFile(join(dir, 'composer.json'), JSON.stringify(manifest), 'utf8')
      const { violations } = await lint({ cwd: dir, ruleId: 'php', concernId: 'composer_manifest' })
      expect(violations.map(v => v.reason)).toEqual(['composer-manifest-sort-packages'])
    })
  })

  test('license відсутній → composer-manifest-license-missing', async () => {
    spawnAsyncMock.mockReset()
    resolveCmdMock.mockReset()
    resolveCmdMock.mockReturnValue(null)
    await withTmpDir(async dir => {
      const { license: _license, ...manifest } = CANON_MANIFEST
      await writeFile(join(dir, 'composer.json'), JSON.stringify(manifest), 'utf8')
      const { violations } = await lint({ cwd: dir, ruleId: 'php', concernId: 'composer_manifest' })
      expect(violations.map(v => v.reason)).toEqual(['composer-manifest-license-missing'])
    })
  })

  test('license — непорожній масив → без license-порушення', async () => {
    spawnAsyncMock.mockReset()
    resolveCmdMock.mockReset()
    resolveCmdMock.mockReturnValue(null)
    await withTmpDir(async dir => {
      const manifest = { ...CANON_MANIFEST, license: ['MIT', 'Apache-2.0'] }
      await writeFile(join(dir, 'composer.json'), JSON.stringify(manifest), 'utf8')
      const { violations } = await lint({ cwd: dir, ruleId: 'php', concernId: 'composer_manifest' })
      expect(violations).toHaveLength(0)
    })
  })

  test('require.php відсутній → composer-manifest-php-constraint-missing', async () => {
    spawnAsyncMock.mockReset()
    resolveCmdMock.mockReset()
    resolveCmdMock.mockReturnValue(null)
    await withTmpDir(async dir => {
      const manifest = { ...CANON_MANIFEST, require: {} }
      await writeFile(join(dir, 'composer.json'), JSON.stringify(manifest), 'utf8')
      const { violations } = await lint({ cwd: dir, ruleId: 'php', concernId: 'composer_manifest' })
      expect(violations.map(v => v.reason)).toEqual(['composer-manifest-php-constraint-missing'])
    })
  })

  test('require.php — "*" (не явний constraint) → composer-manifest-php-constraint-missing', async () => {
    spawnAsyncMock.mockReset()
    resolveCmdMock.mockReset()
    resolveCmdMock.mockReturnValue(null)
    await withTmpDir(async dir => {
      const manifest = { ...CANON_MANIFEST, require: { php: '*' } }
      await writeFile(join(dir, 'composer.json'), JSON.stringify(manifest), 'utf8')
      const { violations } = await lint({ cwd: dir, ruleId: 'php', concernId: 'composer_manifest' })
      expect(violations.map(v => v.reason)).toEqual(['composer-manifest-php-constraint-missing'])
    })
  })

  test('composer validate падає (код != 0) → composer-manifest-validate-failed з деталями stdout/stderr', async () => {
    spawnAsyncMock.mockReset()
    resolveCmdMock.mockReset()
    resolveCmdMock.mockReturnValue('/usr/local/bin/composer')
    spawnAsyncMock.mockResolvedValue({ exitCode: 2, stdout: '', stderr: '# composer.json is not valid\n' })
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'composer.json'), JSON.stringify(CANON_MANIFEST), 'utf8')
      const { violations } = await lint({ cwd: dir, ruleId: 'php', concernId: 'composer_manifest' })
      expect(violations).toHaveLength(1)
      expect(violations[0].reason).toBe('composer-manifest-validate-failed')
      expect(violations[0].message).toContain('composer.json is not valid')
    })
  })

  test('усі декларативні порушення разом накопичуються (декілька reason-ів)', async () => {
    spawnAsyncMock.mockReset()
    resolveCmdMock.mockReset()
    resolveCmdMock.mockReturnValue(null)
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'composer.json'), JSON.stringify({ name: 'nitra/demo' }), 'utf8')
      const { violations } = await lint({ cwd: dir, ruleId: 'php', concernId: 'composer_manifest' })
      const reasons = violations.map(v => v.reason).toSorted()
      expect(reasons).toEqual(
        [
          'composer-manifest-license-missing',
          'composer-manifest-php-constraint-missing',
          'composer-manifest-sort-packages'
        ].toSorted()
      )
    })
  })
})

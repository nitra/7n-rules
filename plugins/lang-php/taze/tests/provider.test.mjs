/**
 * Тести для taze/provider.mjs:
 *   - форма EcosystemProvider (валідна за assertEcosystemProvider ядра);
 *   - buildComposerDependencyPrompt: промпт містить пакет/версії, без чужих команд;
 *   - findComposerManifest/backupComposerManifest/cleanupComposerBackups: реальні tmp-файли;
 *   - bumpComposerDependencies: цикл composer require --with-all-dependencies, require/require-dev, платформні пакети виключені;
 *   - available: graceful skip без composer.
 */
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

import { assertEcosystemProvider } from '@7n/rules/plugin-api'
import { withTmpDir } from '@7n/rules/scripts/utils/test-helpers.mjs'

import phpProvider, {
  backupComposerManifest,
  buildComposerDependencyPrompt,
  bumpComposerDependencies,
  cleanupComposerBackups,
  findComposerManifest
} from '../provider.mjs'

/** Заглушка `log` для тестів, де вивід не перевіряється. */
function noop() {
  /* no-op: цей тест не перевіряє вивід */
}

describe('phpProvider (форма контракту)', () => {
  test('валідний EcosystemProvider за assertEcosystemProvider ядра', () => {
    expect(assertEcosystemProvider(phpProvider, '@7n/rules-lang-php')).toBe(phpProvider)
    expect(phpProvider.id).toBe('php-composer')
    expect(phpProvider.manifestNoun).toBe('composer.json')
  })

  test('available: composer відсутній → ok:false з причиною', () => {
    const availability = phpProvider.available(() => ({ status: 1, stdout: '', stderr: 'not found' }))
    expect(availability.ok).toBe(false)
    expect(availability.reason).toContain('composer')
  })

  test('available: composer є → ok:true', () => {
    expect(phpProvider.available(() => ({ status: 0, stdout: 'Composer version 2.7.0', stderr: '' }))).toEqual({
      ok: true,
      reason: null
    })
  })
})

describe('buildComposerDependencyPrompt', () => {
  test('містить пакет, маніфест і версії', () => {
    const prompt = buildComposerDependencyPrompt({
      manifest: 'composer.json',
      pkg: 'vendor/http-client',
      from: '^7.4',
      to: '^8.0'
    })
    expect(prompt).toContain('vendor/http-client')
    expect(prompt).toContain('composer.json')
    expect(prompt).toContain('^7.4 → ^8.0')
    expect(prompt).toContain('packagist.org')
    expect(prompt).toContain('rg -n --type php')
  })

  test('не змішує з Rust/Python/npm-командами інших гілок', () => {
    const prompt = buildComposerDependencyPrompt({
      manifest: 'composer.json',
      pkg: 'vendor/pkg',
      from: '^1.0',
      to: '^2.0'
    })
    expect(prompt).not.toContain('cargo')
    expect(prompt).not.toContain('bunx taze')
    expect(prompt).not.toContain('uv add')
  })
})

describe('findComposerManifest', () => {
  test('composer.json існує → список з одним записом', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'composer.json'), '{}', 'utf8')
      expect(findComposerManifest(dir)).toEqual(['composer.json'])
    })
  })

  test('composer.json відсутній → порожній список', async () => {
    await withTmpDir(dir => {
      expect(findComposerManifest(dir)).toEqual([])
      return Promise.resolve()
    })
  })
})

describe('backupComposerManifest + cleanupComposerBackups', () => {
  test('бекапить composer.json + composer.lock, прибирає після', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'composer.json'), '{}', 'utf8')
      await writeFile(join(dir, 'composer.lock'), '{}', 'utf8')

      await backupComposerManifest(dir)
      expect(existsSync(join(dir, 'composer.json.taze-bak'))).toBe(true)
      expect(existsSync(join(dir, 'composer.lock.taze-bak'))).toBe(true)

      await cleanupComposerBackups(dir)
      expect(existsSync(join(dir, 'composer.json.taze-bak'))).toBe(false)
      expect(existsSync(join(dir, 'composer.lock.taze-bak'))).toBe(false)
    })
  })

  test('без composer.lock — бекапить лише composer.json, не падає', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'composer.json'), '{}', 'utf8')
      await backupComposerManifest(dir)
      expect(existsSync(join(dir, 'composer.json.taze-bak'))).toBe(true)
      expect(existsSync(join(dir, 'composer.lock.taze-bak'))).toBe(false)
    })
  })
})

describe('bumpComposerDependencies', () => {
  test('на кожну пряму require-залежність: composer require --with-all-dependencies --no-interaction', async () => {
    const calls = []
    await withTmpDir(async dir => {
      await writeFile(
        join(dir, 'composer.json'),
        JSON.stringify({ require: { php: '^8.1', 'vendor/http-client': '^7.4' } }),
        'utf8'
      )
      await bumpComposerDependencies(
        dir,
        (cmd, args) => {
          calls.push([cmd, ...args])
          return { status: 0, stdout: '', stderr: '' }
        },
        noop
      )
    })
    expect(calls).toEqual([
      ['composer', 'require', 'vendor/http-client', '--with-all-dependencies', '--no-interaction']
    ])
  })

  test('require-dev залежність отримує прапорець --dev', async () => {
    const calls = []
    await withTmpDir(async dir => {
      await writeFile(
        join(dir, 'composer.json'),
        JSON.stringify({ 'require-dev': { 'vendor/test-tool': '^10.0' } }),
        'utf8'
      )
      await bumpComposerDependencies(
        dir,
        (cmd, args) => {
          calls.push([cmd, ...args])
          return { status: 0, stdout: '', stderr: '' }
        },
        noop
      )
    })
    expect(calls).toEqual([
      ['composer', 'require', '--dev', 'vendor/test-tool', '--with-all-dependencies', '--no-interaction']
    ])
  })

  test('провал одного пакета не зупиняє інші — лише лог попередження', async () => {
    const calls = []
    const logs = []
    await withTmpDir(async dir => {
      await writeFile(
        join(dir, 'composer.json'),
        JSON.stringify({ require: { 'vendor/a': '^1.0', 'vendor/b': '^1.0' } }),
        'utf8'
      )
      await bumpComposerDependencies(
        dir,
        (cmd, args) => {
          calls.push([cmd, ...args])
          const failing = args.includes('vendor/a')
          return failing
            ? { status: 1, stdout: '', stderr: 'resolution failed' }
            : { status: 0, stdout: '', stderr: '' }
        },
        line => {
          logs.push(line)
        }
      )
    })
    expect(calls).toEqual([
      ['composer', 'require', 'vendor/a', '--with-all-dependencies', '--no-interaction'],
      ['composer', 'require', 'vendor/b', '--with-all-dependencies', '--no-interaction']
    ])
    expect(logs.some(l => l.includes('vendor/a'))).toBe(true)
  })
})

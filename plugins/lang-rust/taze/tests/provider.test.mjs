/**
 * Тести для taze/provider.mjs:
 *   - форма EcosystemProvider (валідна за assertEcosystemProvider);
 *   - buildCargoDependencyPrompt: промпт містить крейт/версії, лише кроки 4-6;
 *   - findCargoManifests: інжектований spawnFn;
 *   - backupCargoManifests/cleanupCargoBackups: реальні tmp-файли;
 *   - available: graceful skip без cargo-edit;
 *   - bump: cargo upgrade --incompatible allow + cargo update, throw на провалі.
 */
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

import { assertEcosystemProvider } from '@7n/rules/plugin-api'
import { ensureDir, withTmpDir } from '@7n/rules/scripts/utils/test-helpers.mjs'
import rustProvider, {
  backupCargoManifests,
  buildCargoDependencyPrompt,
  cleanupCargoBackups,
  findCargoManifests
} from '../provider.mjs'

const CARGO_EXIT_RE = /cargo upgrade --incompatible allow → exit 101/

/** Заглушка `log` для тестів, де вивід не перевіряється. */
function noop() {
  /* no-op: цей тест не перевіряє вивід */
}

describe('rustProvider (форма контракту)', () => {
  test('валідний EcosystemProvider за assertEcosystemProvider', () => {
    expect(assertEcosystemProvider(rustProvider, '@7n/rules-lang-rust')).toBe(rustProvider)
    expect(rustProvider.id).toBe('rust-cargo')
    expect(rustProvider.manifestNoun).toBe('Cargo.toml')
  })

  test('available: cargo-edit відсутній → ok:false з причиною', () => {
    const availability = rustProvider.available(() => ({ status: 1, stdout: '', stderr: 'no such command' }))
    expect(availability.ok).toBe(false)
    expect(availability.reason).toContain('cargo-edit')
  })

  test('available: cargo-edit є → ok:true', () => {
    expect(rustProvider.available(() => ({ status: 0, stdout: 'cargo-upgrade 0.13', stderr: '' }))).toEqual({
      ok: true,
      reason: null
    })
  })

  test('bump: cargo upgrade --incompatible allow + cargo update', async () => {
    const calls = []
    await rustProvider.bump('/tmp/project', ['Cargo.toml'], {
      spawnFn: (cmd, args) => {
        calls.push([cmd, ...args])
        return { status: 0, stdout: '', stderr: '' }
      },
      log: noop
    })
    expect(calls).toEqual([
      ['cargo', 'upgrade', '--incompatible', 'allow'],
      ['cargo', 'update']
    ])
  })

  test('bump: провал команди → кидає з exit-кодом+stderr', () => {
    expect(() =>
      rustProvider.bump('/tmp/project', ['Cargo.toml'], {
        spawnFn: () => ({ status: 101, stdout: '', stderr: 'registry unreachable' }),
        log: noop
      })
    ).toThrow(CARGO_EXIT_RE)
  })
})

describe('buildCargoDependencyPrompt', () => {
  test('містить крейт, маніфест і версії', () => {
    const prompt = buildCargoDependencyPrompt({
      manifest: 'llm-lib/crates/llm-cascade/Cargo.toml',
      pkg: 'genai',
      from: '0.4',
      to: '0.5'
    })
    expect(prompt).toContain('genai')
    expect(prompt).toContain('llm-lib/crates/llm-cascade/Cargo.toml')
    expect(prompt).toContain('0.4 → 0.5')
    expect(prompt).toContain('crates.io')
    expect(prompt).toContain('cargo clippy')
  })

  test('не згадує детерміновані кроки 1-3/7/8 (лише 4-6)', () => {
    const prompt = buildCargoDependencyPrompt({ manifest: 'Cargo.toml', pkg: 'serde', from: '1', to: '2' })
    expect(prompt).not.toContain('cargo upgrade')
  })
})

describe('findCargoManifests', () => {
  test('парсить stdout find у список шляхів', () => {
    const found = findCargoManifests('/repo', {
      spawnFn: () => ({ status: 0, stdout: './Cargo.toml\n./llm-lib/crates/llm-cascade/Cargo.toml\n', stderr: '' })
    })
    expect(found).toEqual(['./Cargo.toml', './llm-lib/crates/llm-cascade/Cargo.toml'])
  })

  test('порожній stdout → порожній список', () => {
    expect(findCargoManifests('/repo', { spawnFn: () => ({ status: 0, stdout: '', stderr: '' }) })).toEqual([])
  })
})

describe('backupCargoManifests + cleanupCargoBackups', () => {
  test('бекапить кожен Cargo.toml + спільний кореневий Cargo.lock, прибирає після', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'Cargo.toml'), '[workspace]', 'utf8')
      await writeFile(join(dir, 'Cargo.lock'), 'version = 4', 'utf8')
      await ensureDir(join(dir, 'crates/foo'))
      await writeFile(join(dir, 'crates/foo/Cargo.toml'), '[package]\nname = "foo"', 'utf8')

      const manifests = ['Cargo.toml', 'crates/foo/Cargo.toml']
      await backupCargoManifests(dir, manifests)
      expect(existsSync(join(dir, 'Cargo.toml.taze-bak'))).toBe(true)
      expect(existsSync(join(dir, 'crates/foo/Cargo.toml.taze-bak'))).toBe(true)
      expect(existsSync(join(dir, 'Cargo.lock.taze-bak'))).toBe(true)

      await cleanupCargoBackups(dir, manifests)
      expect(existsSync(join(dir, 'Cargo.toml.taze-bak'))).toBe(false)
      expect(existsSync(join(dir, 'crates/foo/Cargo.toml.taze-bak'))).toBe(false)
      expect(existsSync(join(dir, 'Cargo.lock.taze-bak'))).toBe(false)
    })
  })

  test('без Cargo.lock — бекапить лише Cargo.toml, не падає', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'Cargo.toml'), '[workspace]', 'utf8')
      await backupCargoManifests(dir, ['Cargo.toml'])
      expect(existsSync(join(dir, 'Cargo.toml.taze-bak'))).toBe(true)
      expect(existsSync(join(dir, 'Cargo.lock.taze-bak'))).toBe(false)
    })
  })
})

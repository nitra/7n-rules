/**
 * Тести для taze/cargo-diff.mjs:
 *   - parseCargoVersion: 1-3 компоненти, операторні префікси, не-semver;
 *   - extractCargoVersionSpec: рядок vs inline-таблиця vs path/git-залежність;
 *   - diffCargoToml: групування major vs minor/patch по dependencies/dev-dependencies/build-dependencies;
 *   - collectCargoDiff: реальні tmp-файли, бекапи.
 */
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { stringify as stringifyToml } from 'smol-toml'
import { describe, expect, test } from 'vitest'

import { withTmpDir } from '@7n/rules/scripts/utils/test-helpers.mjs'
import { collectCargoDiff, diffCargoToml, extractCargoVersionSpec, parseCargoVersion } from '../cargo-diff.mjs'

describe('parseCargoVersion', () => {
  test('1-3 компоненти, відсутні → 0', () => {
    expect(parseCargoVersion('1')).toEqual({ major: 1, minor: 0, patch: 0 })
    expect(parseCargoVersion('0.4')).toEqual({ major: 0, minor: 4, patch: 0 })
    expect(parseCargoVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 })
  })

  test('знімає операторні префікси', () => {
    expect(parseCargoVersion('=1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 })
    expect(parseCargoVersion('^0.4')).toEqual({ major: 0, minor: 4, patch: 0 })
    expect(parseCargoVersion('~1')).toEqual({ major: 1, minor: 0, patch: 0 })
  })

  test('не-semver → null', () => {
    expect(parseCargoVersion('*')).toBeNull()
    expect(parseCargoVersion(42)).toBeNull()
  })
})

describe('extractCargoVersionSpec', () => {
  test('рядок напряму', () => {
    expect(extractCargoVersionSpec('1.2.3')).toBe('1.2.3')
  })

  test('inline-таблиця з полем version', () => {
    expect(extractCargoVersionSpec({ version: '1', features: ['derive'] })).toBe('1')
  })

  test('path/git-залежність (без version) → null', () => {
    expect(extractCargoVersionSpec({ path: '../foo' })).toBeNull()
    expect(extractCargoVersionSpec({ git: 'https://example.com/foo', branch: 'main' })).toBeNull()
  })
})

describe('diffCargoToml', () => {
  test('класифікує major (1-компонентні версії) vs minor/patch по dependencies/dev-dependencies', () => {
    const oldManifest = {
      dependencies: { genai: '0.4', tokio: { version: '1', features: ['rt'] } },
      'dev-dependencies': { tempfile: '3.0' }
    }
    const newManifest = {
      dependencies: { genai: '0.5', tokio: { version: '1', features: ['rt', 'macros'] } },
      'dev-dependencies': { tempfile: '3.1' }
    }
    const res = diffCargoToml(oldManifest, newManifest, 'Cargo.toml')
    expect(res.major).toEqual([{ manifest: 'Cargo.toml', pkg: 'genai', from: '0.4', to: '0.5' }])
    expect(res.minorPatch).toBe(1)
  })

  test('незмінні, path/git-залежності — ігноруються', () => {
    const res = diffCargoToml(
      { dependencies: { a: '1.0.0', local: { path: '../local' } } },
      { dependencies: { a: '1.0.0', local: { path: '../local' } } },
      'Cargo.toml'
    )
    expect(res.major).toEqual([])
    expect(res.minorPatch).toBe(0)
  })

  test('1.x → 2.x major', () => {
    const res = diffCargoToml({ dependencies: { serde: '1' } }, { dependencies: { serde: '2' } }, 'Cargo.toml')
    expect(res.major).toEqual([{ manifest: 'Cargo.toml', pkg: 'serde', from: '1', to: '2' }])
  })
})

describe('collectCargoDiff', () => {
  test('агрегує кілька Cargo.toml монорепо', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'Cargo.toml'), stringifyToml({ dependencies: { genai: '0.4' } }), 'utf8')
      await writeFile(join(dir, 'Cargo.toml.taze-bak'), stringifyToml({ dependencies: { genai: '0.5' } }), 'utf8')

      const diff = await collectCargoDiff(dir, ['Cargo.toml'])
      expect(diff.comparedManifests).toBe(1)
      // .taze-bak — СТАРА версія (0.5), поточний файл — НОВА (0.4): бекап "старіший" за задумом,
      // тут навпаки для перевірки напрямку diff-у (from = бекап, to = поточний).
      expect(diff.major).toEqual([{ manifest: 'Cargo.toml', pkg: 'genai', from: '0.5', to: '0.4' }])
    })
  })

  test('без бекапу — не порівнюється', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'Cargo.toml'), stringifyToml({ dependencies: {} }), 'utf8')
      const diff = await collectCargoDiff(dir, ['Cargo.toml'])
      expect(diff.comparedManifests).toBe(0)
      expect(diff.totalChanged).toBe(0)
    })
  })
})

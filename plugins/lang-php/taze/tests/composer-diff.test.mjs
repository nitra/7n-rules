/**
 * Тести для taze/composer-diff.mjs:
 *   - parseComposerVersion: 1-3 компоненти, операторні префікси, wildcard, не-версія;
 *   - isRealComposerPackage: vendor/package vs платформні псевдо-пакети;
 *   - diffComposerJson: групування major vs minor/patch, require + require-dev, платформні пакети ігноруються;
 *   - collectComposerDiff: реальні tmp-файли, бекапи;
 *   - listDirectComposerDependencies: name/dev прямих залежностей, платформні пакети виключені.
 */
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

import { withTmpDir } from '@7n/rules/scripts/utils/test-helpers.mjs'

import {
  collectComposerDiff,
  diffComposerJson,
  isRealComposerPackage,
  listDirectComposerDependencies,
  parseComposerVersion
} from '../composer-diff.mjs'

describe('parseComposerVersion', () => {
  test('1-3 компоненти, відсутні → 0', () => {
    expect(parseComposerVersion('7')).toEqual({ major: 7, minor: 0, patch: 0 })
    expect(parseComposerVersion('7.4')).toEqual({ major: 7, minor: 4, patch: 0 })
    expect(parseComposerVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 })
  })

  test('знімає операторні префікси (^/~/>=/v)', () => {
    expect(parseComposerVersion('^7.4')).toEqual({ major: 7, minor: 4, patch: 0 })
    expect(parseComposerVersion('~1.2')).toEqual({ major: 1, minor: 2, patch: 0 })
    expect(parseComposerVersion('>=2.0.0')).toEqual({ major: 2, minor: 0, patch: 0 })
    expect(parseComposerVersion('v1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 })
  })

  test('wildcard — бере лише числову ліву гілку', () => {
    expect(parseComposerVersion('5.6.*')).toEqual({ major: 5, minor: 6, patch: 0 })
  })

  test('OR-набір — бере першу альтернативу', () => {
    expect(parseComposerVersion('^7.4 || ^8.0')).toEqual({ major: 7, minor: 4, patch: 0 })
  })

  test('не-версія → null', () => {
    expect(parseComposerVersion('*')).toBeNull()
    expect(parseComposerVersion('dev-master')).toBeNull()
    expect(parseComposerVersion(42)).toBeNull()
  })
})

describe('isRealComposerPackage', () => {
  test('vendor/package → true', () => {
    expect(isRealComposerPackage('vendor/http-client')).toBe(true)
  })

  test('платформні псевдо-пакети → false', () => {
    expect(isRealComposerPackage('php')).toBe(false)
    expect(isRealComposerPackage('ext-json')).toBe(false)
    expect(isRealComposerPackage('lib-openssl')).toBe(false)
    expect(isRealComposerPackage('composer-plugin-api')).toBe(false)
  })

  test('невалідний вхід → false', () => {
    expect(isRealComposerPackage(42)).toBe(false)
  })
})

describe('diffComposerJson', () => {
  test('major через caret 0.x (найлівіша ненульова компонента)', () => {
    const oldManifest = { require: { 'vendor/pkg': '^0.3.0' } }
    const newManifest = { require: { 'vendor/pkg': '^0.4.0' } }
    const res = diffComposerJson(oldManifest, newManifest, 'composer.json')
    expect(res.major).toEqual([{ manifest: 'composer.json', pkg: 'vendor/pkg', from: '^0.3.0', to: '^0.4.0' }])
    expect(res.minorPatch).toBe(0)
  })

  test('major через caret >=1 (major-компонента)', () => {
    const oldManifest = { require: { 'vendor/http-client': '^7.4' } }
    const newManifest = { require: { 'vendor/http-client': '^8.0' } }
    const res = diffComposerJson(oldManifest, newManifest, 'composer.json')
    expect(res.major).toEqual([{ manifest: 'composer.json', pkg: 'vendor/http-client', from: '^7.4', to: '^8.0' }])
  })

  test('minor/patch — не потрапляє у major', () => {
    const oldManifest = { require: { 'vendor/http-client': '^7.4' } }
    const newManifest = { require: { 'vendor/http-client': '^7.9' } }
    const res = diffComposerJson(oldManifest, newManifest, 'composer.json')
    expect(res.major).toEqual([])
    expect(res.minorPatch).toBe(1)
  })

  test('require-dev теж класифікується', () => {
    const oldManifest = { 'require-dev': { 'vendor/test-tool': '^10.0' } }
    const newManifest = { 'require-dev': { 'vendor/test-tool': '^11.0' } }
    const res = diffComposerJson(oldManifest, newManifest, 'composer.json')
    expect(res.major).toEqual([{ manifest: 'composer.json', pkg: 'vendor/test-tool', from: '^10.0', to: '^11.0' }])
  })

  test('платформні псевдо-пакети ігноруються навіть при зміні', () => {
    const oldManifest = { require: { php: '^8.1' } }
    const newManifest = { require: { php: '^8.3' } }
    const res = diffComposerJson(oldManifest, newManifest, 'composer.json')
    expect(res.major).toEqual([])
    expect(res.minorPatch).toBe(0)
  })

  test('незмінні залежності — ігноруються', () => {
    const manifest = { require: { 'vendor/pkg': '^1.0' } }
    const res = diffComposerJson(manifest, manifest, 'composer.json')
    expect(res.major).toEqual([])
    expect(res.minorPatch).toBe(0)
  })

  test('видалена в новому — ігнорується', () => {
    const oldManifest = { require: { 'vendor/pkg': '^1.0' } }
    const newManifest = { require: {} }
    const res = diffComposerJson(oldManifest, newManifest, 'composer.json')
    expect(res.major).toEqual([])
    expect(res.minorPatch).toBe(0)
  })
})

describe('collectComposerDiff', () => {
  test('порівнює composer.json з бекапом', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'composer.json'), JSON.stringify({ require: { 'vendor/pkg': '^2.0' } }), 'utf8')
      await writeFile(
        join(dir, 'composer.json.taze-bak'),
        JSON.stringify({ require: { 'vendor/pkg': '^1.0' } }),
        'utf8'
      )

      const diff = await collectComposerDiff(dir)
      expect(diff.comparedManifests).toBe(1)
      expect(diff.major).toEqual([{ manifest: 'composer.json', pkg: 'vendor/pkg', from: '^1.0', to: '^2.0' }])
      expect(diff.totalChanged).toBe(1)
    })
  })

  test('без бекапу — не порівнюється', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'composer.json'), JSON.stringify({ require: {} }), 'utf8')
      const diff = await collectComposerDiff(dir)
      expect(diff.comparedManifests).toBe(0)
      expect(diff.totalChanged).toBe(0)
    })
  })
})

describe('listDirectComposerDependencies', () => {
  test('повертає name/dev require + require-dev, без платформних пакетів', () => {
    const manifest = {
      require: { php: '^8.1', 'vendor/http-client': '^7.4' },
      'require-dev': { 'vendor/test-tool': '^10.0' }
    }
    expect(listDirectComposerDependencies(manifest)).toEqual([
      { name: 'vendor/http-client', dev: false },
      { name: 'vendor/test-tool', dev: true }
    ])
  })

  test('відсутні require/require-dev → порожній список', () => {
    expect(listDirectComposerDependencies({})).toEqual([])
  })
})

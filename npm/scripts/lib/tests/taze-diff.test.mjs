/**
 * Тести для scripts/lib/taze-diff.mjs:
 *   - diffManifestDeps: класифікація major vs minor/patch, кілька полів, filterPkg,
 *     нестрокові/незмінні/видалені значення;
 *   - readJsonOrNull: відсутній файл, невалідний JSON, валідний JSON.
 */
import { describe, expect, test } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { parseVersion } from '../plugin-api.mjs'
import { diffManifestDeps, readJsonOrNull } from '../taze-diff.mjs'
import { withTmpDir } from '../../utils/test-helpers.mjs'

describe('diffManifestDeps', () => {
  test('класифікує major vs minor/patch по всіх полях, без мітки джерела', () => {
    const oldManifest = {
      dependencies: { react: '^17.0.1', lodash: '^4.17.20' },
      devDependencies: { vite: '^4.0.0' }
    }
    const newManifest = {
      dependencies: { react: '^18.2.0', lodash: '^4.17.21' },
      devDependencies: { vite: '^5.0.0' }
    }
    const res = diffManifestDeps(oldManifest, newManifest, {
      fields: ['dependencies', 'devDependencies'],
      parseVersion
    })
    expect(res.major).toEqual([
      { pkg: 'react', from: '^17.0.1', to: '^18.2.0' },
      { pkg: 'vite', from: '^4.0.0', to: '^5.0.0' }
    ])
    expect(res.minorPatch).toBe(1)
  })

  test('незмінні, видалені в новому й нестрокові значення — ігноруються', () => {
    const res = diffManifestDeps(
      { dependencies: { same: '1.0.0', removed: '1.0.0', weird: 42 } },
      { dependencies: { same: '1.0.0', weird: 43 } },
      { fields: ['dependencies'], parseVersion }
    )
    expect(res.major).toEqual([])
    expect(res.minorPatch).toBe(0)
  })

  test('не-semver зміна рахується як minor/patch, не major', () => {
    const res = diffManifestDeps(
      { dependencies: { dep: 'workspace:1.0.0' } },
      { dependencies: { dep: 'workspace:2.0.0' } },
      { fields: ['dependencies'], parseVersion }
    )
    expect(res.major).toEqual([])
    expect(res.minorPatch).toBe(1)
  })

  test('filterPkg відсіює пакети до порівняння', () => {
    const res = diffManifestDeps(
      { require: { php: '1.0.0', 'vendor/pkg': '1.0.0' } },
      { require: { php: '2.0.0', 'vendor/pkg': '2.0.0' } },
      { fields: ['require'], parseVersion, filterPkg: pkg => pkg.includes('/') }
    )
    expect(res.major).toEqual([{ pkg: 'vendor/pkg', from: '1.0.0', to: '2.0.0' }])
    expect(res.minorPatch).toBe(0)
  })

  test('відсутнє поле в одному з маніфестів — пропускається', () => {
    const res = diffManifestDeps({ dependencies: { a: '1.0.0' } }, {}, { fields: ['dependencies'], parseVersion })
    expect(res.major).toEqual([])
    expect(res.minorPatch).toBe(0)
  })
})

describe('readJsonOrNull', () => {
  test('валідний JSON → розпарсений обʼєкт', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'a.json'), '{"x":1}', 'utf8')
      expect(await readJsonOrNull(join(dir, 'a.json'))).toEqual({ x: 1 })
    })
  })

  test('відсутній файл або невалідний JSON → null', async () => {
    await withTmpDir(async dir => {
      expect(await readJsonOrNull(join(dir, 'missing.json'))).toBeNull()
      await writeFile(join(dir, 'bad.json'), '{oops', 'utf8')
      expect(await readJsonOrNull(join(dir, 'bad.json'))).toBeNull()
    })
  })
})

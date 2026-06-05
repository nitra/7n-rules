/**
 * Тести для skills/taze/js/diff.mjs:
 *   - parseVersion: range-префікси, не-semver;
 *   - isBreaking: caret-семантика (1.x/0.x/0.0.x);
 *   - diffPackageJson: групування major vs minor/patch по полях залежностей;
 *   - collectTazeDiff + runTazeCli: монорепо, бекапи, exit-коди (cwd-ін'єкція).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { ensureDir, withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'
import { collectTazeDiff, diffPackageJson, isBreaking, parseVersion, runTazeCli } from '../diff.mjs'

/**
 * Готує монорепо з бекапом у tmp-каталозі (root: react major; pkg-a: vite patch).
 * @param {string} dir tmp-корінь
 * @returns {Promise<void>}
 */
async function setupMonorepo(dir) {
  await writeFile(
    join(dir, 'package.json'),
    JSON.stringify({ workspaces: ['pkg-a'], dependencies: { react: '^18.0.0' } }),
    'utf8'
  )
  await writeFile(
    join(dir, 'package.json.taze-bak'),
    JSON.stringify({ workspaces: ['pkg-a'], dependencies: { react: '^17.0.0' } }),
    'utf8'
  )
  await ensureDir(join(dir, 'pkg-a'))
  await writeFile(join(dir, 'pkg-a/package.json'), JSON.stringify({ dependencies: { vite: '^5.0.1' } }), 'utf8')
  await writeFile(
    join(dir, 'pkg-a/package.json.taze-bak'),
    JSON.stringify({ dependencies: { vite: '^5.0.0' } }),
    'utf8'
  )
}

describe('parseVersion', () => {
  test('знімає range-префікси', () => {
    expect(parseVersion('^17.0.1')).toEqual({ major: 17, minor: 0, patch: 1 })
    expect(parseVersion('~0.4.2')).toEqual({ major: 0, minor: 4, patch: 2 })
    expect(parseVersion('>=1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 })
  })

  test('не-semver → null', () => {
    expect(parseVersion('workspace:*')).toBeNull()
    expect(parseVersion('*')).toBeNull()
    expect(parseVersion('github:foo/bar')).toBeNull()
    expect(parseVersion(42)).toBeNull()
  })
})

describe('isBreaking (caret-семантика)', () => {
  test('1.x → 2.x breaking; 1.2 → 1.3 ні', () => {
    expect(isBreaking({ major: 1, minor: 2, patch: 0 }, { major: 2, minor: 0, patch: 0 })).toBe(true)
    expect(isBreaking({ major: 1, minor: 2, patch: 0 }, { major: 1, minor: 3, patch: 0 })).toBe(false)
  })

  test('0.4.x → 0.5.x breaking; 0.4.1 → 0.4.2 ні', () => {
    expect(isBreaking({ major: 0, minor: 4, patch: 1 }, { major: 0, minor: 5, patch: 0 })).toBe(true)
    expect(isBreaking({ major: 0, minor: 4, patch: 1 }, { major: 0, minor: 4, patch: 2 })).toBe(false)
  })

  test('0.0.3 → 0.0.4 breaking (найлівіша ненульова = patch)', () => {
    expect(isBreaking({ major: 0, minor: 0, patch: 3 }, { major: 0, minor: 0, patch: 4 })).toBe(true)
  })
})

describe('diffPackageJson', () => {
  test('класифікує major vs minor/patch по всіх полях', () => {
    const oldPkg = {
      dependencies: { react: '^17.0.1', lodash: '^4.17.20' },
      devDependencies: { vite: '^4.0.0' }
    }
    const newPkg = {
      dependencies: { react: '^18.2.0', lodash: '^4.17.21' },
      devDependencies: { vite: '^5.0.0' }
    }
    const res = diffPackageJson(oldPkg, newPkg, '.')
    expect(res.major).toEqual([
      { workspace: '.', pkg: 'react', from: '^17.0.1', to: '^18.2.0' },
      { workspace: '.', pkg: 'vite', from: '^4.0.0', to: '^5.0.0' }
    ])
    expect(res.minorPatch).toBe(1)
  })

  test('незмінні й відсутні в новому — ігноруються', () => {
    const res = diffPackageJson(
      { dependencies: { a: '1.0.0', removed: '1.0.0' } },
      { dependencies: { a: '1.0.0' } },
      '.'
    )
    expect(res.major).toEqual([])
    expect(res.minorPatch).toBe(0)
  })

  test('не-semver зміна (workspace:) рахується як minor/patch, не major', () => {
    const res = diffPackageJson(
      { dependencies: { dep: 'workspace:1.0.0' } },
      { dependencies: { dep: 'workspace:2.0.0' } },
      '.'
    )
    expect(res.major).toEqual([])
    expect(res.minorPatch).toBe(1)
  })
})

describe('collectTazeDiff + runTazeCli', () => {
  let outSpy
  let errSpy
  beforeEach(() => {
    outSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    errSpy = vi.spyOn(console, 'error').mockReturnValue()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('collectTazeDiff агрегує root + воркспейс', async () => {
    await withTmpDir(async dir => {
      await setupMonorepo(dir)
      const diff = await collectTazeDiff(dir)
      expect(diff.comparedWorkspaces).toBe(2)
      expect(diff.major).toEqual([{ workspace: '.', pkg: 'react', from: '^17.0.0', to: '^18.0.0' }])
      expect(diff.minorPatch).toBe(1) // vite patch bump у pkg-a
      expect(diff.totalChanged).toBe(2)
    })
  })

  test('runTazeCli diff → друкує JSON, exit 0', async () => {
    await withTmpDir(async dir => {
      await setupMonorepo(dir)
      const code = await runTazeCli(['diff'], dir)
      expect(code).toBe(0)
      const printed = JSON.parse(outSpy.mock.calls.at(-1)[0])
      expect(printed.major).toHaveLength(1)
      expect(printed.totalChanged).toBe(2)
    })
  })

  test('runTazeCli без бекапів → exit 1', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'package.json'), JSON.stringify({ dependencies: { react: '^18.0.0' } }), 'utf8')
      expect(await runTazeCli(['diff'], dir)).toBe(1)
      expect(errSpy).toHaveBeenCalled()
    })
  })

  test('невідома підкоманда → exit 1', async () => {
    await withTmpDir(async dir => {
      expect(await runTazeCli(['bogus'], dir)).toBe(1)
    })
  })
})

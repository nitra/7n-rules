/**
 * Тести для taze/uv-diff.mjs:
 *   - parsePep508: назва/extras/specifier, невалідний рядок;
 *   - parsePep440Version: 1-3 компоненти, операторні префікси, не-версія;
 *   - extractLowerBoundVersion: `>=`/`==`/`~=` серед comma-separated списку;
 *   - diffPyprojectDeps: групування major vs minor/patch за іменем пакета;
 *   - collectUvDiff: реальні tmp-файли, бекапи;
 *   - listDirectDependencies: назва/extras/raw прямих залежностей.
 */
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { stringify as stringifyToml } from 'smol-toml'
import { describe, expect, test } from 'vitest'

import { withTmpDir } from '@7n/rules/scripts/utils/test-helpers.mjs'

import {
  collectUvDiff,
  diffPyprojectDeps,
  extractLowerBoundVersion,
  listDirectDependencies,
  parsePep440Version,
  parsePep508
} from '../uv-diff.mjs'

describe('parsePep508', () => {
  test('назва + specifier, без extras', () => {
    expect(parsePep508('typer>=0.19.1,<0.20.0')).toEqual({
      name: 'typer',
      extras: [],
      specifier: '>=0.19.1,<0.20.0'
    })
  })

  test('назва + extras + specifier', () => {
    expect(parsePep508('strawberry-graphql[asgi]>=0.282.0')).toEqual({
      name: 'strawberry-graphql',
      extras: ['asgi'],
      specifier: '>=0.282.0'
    })
  })

  test('кілька extras', () => {
    expect(parsePep508('foo[a,b]>=1.0')).toEqual({ name: 'foo', extras: ['a', 'b'], specifier: '>=1.0' })
  })

  test('без specifier', () => {
    expect(parsePep508('typer')).toEqual({ name: 'typer', extras: [], specifier: '' })
  })

  test('невалідний вхід → null', () => {
    expect(parsePep508(42)).toBeNull()
    expect(parsePep508('')).toBeNull()
  })
})

describe('parsePep440Version', () => {
  test('1-3 компоненти, відсутні → 0', () => {
    expect(parsePep440Version('1')).toEqual({ major: 1, minor: 0, patch: 0 })
    expect(parsePep440Version('0.19')).toEqual({ major: 0, minor: 19, patch: 0 })
    expect(parsePep440Version('0.19.1')).toEqual({ major: 0, minor: 19, patch: 1 })
  })

  test('знімає операторні префікси', () => {
    expect(parsePep440Version('>=0.19.1')).toEqual({ major: 0, minor: 19, patch: 1 })
    expect(parsePep440Version('==1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 })
  })

  test('не-версія → null', () => {
    expect(parsePep440Version('*')).toBeNull()
    expect(parsePep440Version(42)).toBeNull()
  })
})

describe('extractLowerBoundVersion', () => {
  test('дістає >= серед comma-separated списку', () => {
    expect(extractLowerBoundVersion('>=0.19.1,<0.20.0')).toBe('0.19.1')
  })

  test('дістає ==', () => {
    expect(extractLowerBoundVersion('==1.2.3')).toBe('1.2.3')
  })

  test('дістає ~=', () => {
    expect(extractLowerBoundVersion('~=1.2')).toBe('1.2')
  })

  test('без нижньої межі → null', () => {
    expect(extractLowerBoundVersion('<2.0.0')).toBeNull()
    expect(extractLowerBoundVersion('')).toBeNull()
    expect(extractLowerBoundVersion(null)).toBeNull()
  })
})

describe('diffPyprojectDeps', () => {
  test('класифікує major vs minor/patch за іменем пакета', () => {
    const oldManifest = { project: { dependencies: ['typer>=0.19.1,<0.20.0', 'httpx>=0.27.0'] } }
    const newManifest = { project: { dependencies: ['typer>=0.27.0', 'httpx>=0.27.5'] } }
    const res = diffPyprojectDeps(oldManifest, newManifest, 'pyproject.toml')
    expect(res.major).toEqual([{ manifest: 'pyproject.toml', pkg: 'typer', from: '0.19.1', to: '0.27.0' }])
    expect(res.minorPatch).toBe(1)
  })

  test('зберігає extras у назві пакета для major-запису', () => {
    const oldManifest = { project: { dependencies: ['strawberry-graphql[asgi]>=0.291.0'] } }
    const newManifest = { project: { dependencies: ['strawberry-graphql[asgi]>=0.321.0'] } }
    const res = diffPyprojectDeps(oldManifest, newManifest, 'pyproject.toml')
    expect(res.major).toEqual([
      { manifest: 'pyproject.toml', pkg: 'strawberry-graphql', from: '0.291.0', to: '0.321.0' }
    ])
  })

  test('незмінні залежності — ігноруються', () => {
    const manifest = { project: { dependencies: ['typer>=0.19.1'] } }
    const res = diffPyprojectDeps(manifest, manifest, 'pyproject.toml')
    expect(res.major).toEqual([])
    expect(res.minorPatch).toBe(0)
  })

  test('видалена в новому — ігнорується', () => {
    const oldManifest = { project: { dependencies: ['typer>=0.19.1'] } }
    const newManifest = { project: { dependencies: [] } }
    const res = diffPyprojectDeps(oldManifest, newManifest, 'pyproject.toml')
    expect(res.major).toEqual([])
    expect(res.minorPatch).toBe(0)
  })
})

describe('collectUvDiff', () => {
  test('порівнює pyproject.toml з бекапом', async () => {
    await withTmpDir(async dir => {
      await writeFile(
        join(dir, 'pyproject.toml'),
        stringifyToml({ project: { dependencies: ['typer>=0.19.1'] } }),
        'utf8'
      )
      await writeFile(
        join(dir, 'pyproject.toml.taze-bak'),
        stringifyToml({ project: { dependencies: ['typer>=0.27.0'] } }),
        'utf8'
      )

      const diff = await collectUvDiff(dir)
      expect(diff.comparedManifests).toBe(1)
      // .taze-bak — СТАРА версія (0.27.0), поточний файл — НОВА (0.19.1): бекап "старіший" за задумом,
      // тут навпаки для перевірки напрямку diff-у (from = бекап, to = поточний).
      expect(diff.major).toEqual([{ manifest: 'pyproject.toml', pkg: 'typer', from: '0.27.0', to: '0.19.1' }])
    })
  })

  test('без бекапу — не порівнюється', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'pyproject.toml'), stringifyToml({ project: { dependencies: [] } }), 'utf8')
      const diff = await collectUvDiff(dir)
      expect(diff.comparedManifests).toBe(0)
      expect(diff.totalChanged).toBe(0)
    })
  })
})

describe('listDirectDependencies', () => {
  test('повертає name/extras/raw кожної прямої залежності', () => {
    const manifest = { project: { dependencies: ['typer>=0.19.1', 'strawberry-graphql[asgi]>=0.291.0'] } }
    expect(listDirectDependencies(manifest)).toEqual([
      { name: 'typer', extras: [], raw: 'typer>=0.19.1' },
      { name: 'strawberry-graphql', extras: ['asgi'], raw: 'strawberry-graphql[asgi]>=0.291.0' }
    ])
  })

  test('відсутні dependencies → порожній список', () => {
    expect(listDirectDependencies({ project: {} })).toEqual([])
  })
})

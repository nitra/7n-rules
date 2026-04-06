/**
 * Тести нормалізації workspaces і збору коренів пакетів монорепо.
 */
import { describe, expect, test } from 'bun:test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { ensureDir, withTmpCwd, writeJson } from './helpers.mjs'
import { getMonorepoPackageRootDirs, normalizeWorkspacePatterns } from '../scripts/utils/workspaces.mjs'

describe('normalizeWorkspacePatterns', () => {
  test('повертає [] для відсутнього значення', () => {
    expect(normalizeWorkspacePatterns()).toEqual([])
    expect(normalizeWorkspacePatterns(null)).toEqual([])
  })

  test('масив залишається масивом', () => {
    expect(normalizeWorkspacePatterns(['a', 'b'])).toEqual(['a', 'b'])
  })

  test('об’єкт з packages', () => {
    expect(normalizeWorkspacePatterns({ packages: ['pkg/*'] })).toEqual(['pkg/*'])
  })

  test('інший об’єкт — []', () => {
    expect(normalizeWorkspacePatterns({})).toEqual([])
  })
})

describe('getMonorepoPackageRootDirs', () => {
  test('без package.json — лише "."', async () => {
    await withTmpCwd(async () => {
      const roots = await getMonorepoPackageRootDirs(process.cwd())
      expect(roots).toEqual(['.'])
    })
  })

  test('корінь і явний workspace з package.json', async () => {
    await withTmpCwd(async root => {
      await writeJson('package.json', { name: 'r', workspaces: ['npm'] })
      await ensureDir('npm')
      await writeJson(join('npm', 'package.json'), { name: 'npm' })
      const roots = await getMonorepoPackageRootDirs(root)
      expect(roots).toEqual(['.', 'npm'])
    })
  })

  test('glob workspaces', async () => {
    await withTmpCwd(async root => {
      await writeJson('package.json', { name: 'r', workspaces: ['packages/*'] })
      await mkdir(join('packages', 'a'), { recursive: true })
      await mkdir(join('packages', 'b'), { recursive: true })
      await writeJson(join('packages', 'a', 'package.json'), { name: 'a' })
      await writeJson(join('packages', 'b', 'package.json'), { name: 'b' })
      const roots = await getMonorepoPackageRootDirs(root)
      expect(roots).toEqual(['.', 'packages/a', 'packages/b'])
    })
  })
})

/**
 * Тести нормалізації workspaces і збору коренів пакетів монорепо.
 */
import { describe, expect, test } from 'vitest'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { ensureDir, withTmpDir, writeJson } from '../../utils/test-helpers.mjs'
import { getMonorepoPackageRootDirs, isIgnoredWorkspaceRoot, normalizeWorkspacePatterns } from '../workspaces.mjs'

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

describe('isIgnoredWorkspaceRoot', () => {
  test('корінь "." не ігнорується', () => {
    expect(isIgnoredWorkspaceRoot('.')).toBe(false)
  })

  test('node_modules та службові каталоги — ігнор', () => {
    expect(isIgnoredWorkspaceRoot('node_modules/foo')).toBe(true)
    expect(isIgnoredWorkspaceRoot('node_modules/node-gyp/gyp')).toBe(true)
    expect(isIgnoredWorkspaceRoot('packages/.git/pkg')).toBe(true)
    expect(isIgnoredWorkspaceRoot('.venv/lib')).toBe(true)
    expect(isIgnoredWorkspaceRoot('venv')).toBe(true)
  })

  test('звичайні workspace-шляхи не ігноруються', () => {
    expect(isIgnoredWorkspaceRoot('npm')).toBe(false)
    expect(isIgnoredWorkspaceRoot('packages/a')).toBe(false)
  })
})

describe('getMonorepoPackageRootDirs', () => {
  test('без package.json — лише "."', async () => {
    await withTmpDir(async dir => {
      const roots = await getMonorepoPackageRootDirs(dir)
      expect(roots).toEqual(['.'])
    })
  })

  test('корінь і явний workspace з package.json', async () => {
    await withTmpDir(async root => {
      await writeJson(join(root, 'package.json'), { name: 'r', workspaces: ['npm'] })
      await ensureDir(join(root, 'npm'))
      await writeJson(join(root, 'npm', 'package.json'), { name: 'npm' })
      const roots = await getMonorepoPackageRootDirs(root)
      expect(roots).toEqual(['.', 'npm'])
    })
  })

  test('glob workspaces', async () => {
    await withTmpDir(async root => {
      await writeJson(join(root, 'package.json'), { name: 'r', workspaces: ['packages/*'] })
      await mkdir(join(root, 'packages', 'a'), { recursive: true })
      await mkdir(join(root, 'packages', 'b'), { recursive: true })
      await writeJson(join(root, 'packages', 'a', 'package.json'), { name: 'a' })
      await writeJson(join(root, 'packages', 'b', 'package.json'), { name: 'b' })
      const roots = await getMonorepoPackageRootDirs(root)
      expect(roots).toEqual(['.', 'packages/a', 'packages/b'])
    })
  })

  test('glob ** не підхоплює package.json у node_modules', async () => {
    await withTmpDir(async root => {
      await writeJson(join(root, 'package.json'), { name: 'r', workspaces: ['**'] })
      await mkdir(join(root, 'pkg', 'app'), { recursive: true })
      await writeJson(join(root, 'pkg', 'app', 'package.json'), { name: 'app' })
      await mkdir(join(root, 'node_modules', 'dep', 'nested'), { recursive: true })
      await writeJson(join(root, 'node_modules', 'dep', 'nested', 'package.json'), { name: 'dep' })
      const roots = await getMonorepoPackageRootDirs(root)
      expect(roots).toEqual(['.', 'pkg/app'])
    })
  })
})

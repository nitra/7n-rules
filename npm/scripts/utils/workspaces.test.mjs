/**
 * Тести нормалізації workspaces і збору коренів пакетів монорепо.
 */
import { describe, expect, test } from 'bun:test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { ensureDir, withTmpCwd, writeJson } from './test-helpers.mjs'
import { getMonorepoPackageRootDirs, isIgnoredWorkspaceRoot, normalizeWorkspacePatterns } from './workspaces.mjs'

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

  test('glob ** не підхоплює package.json у node_modules', async () => {
    await withTmpCwd(async root => {
      await writeJson('package.json', { name: 'r', workspaces: ['**'] })
      await mkdir(join('pkg', 'app'), { recursive: true })
      await writeJson(join('pkg', 'app', 'package.json'), { name: 'app' })
      await mkdir(join('node_modules', 'dep', 'nested'), { recursive: true })
      await writeJson(join('node_modules', 'dep', 'nested', 'package.json'), { name: 'dep' })
      const roots = await getMonorepoPackageRootDirs(root)
      expect(roots).toEqual(['.', 'pkg/app'])
    })
  })
})

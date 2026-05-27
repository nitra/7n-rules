/**
 * Тести дописування `\@nitra/cursor` у `devDependencies` workspace-root package.json.
 */
import { describe, expect, test } from 'vitest'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { ensureNitraCursorInRootDevDependencies } from '../ensure-nitra-cursor-dev-dependencies.mjs'
import { withTmpDir, writeJson } from '../utils/test-helpers.mjs'

describe('ensureNitraCursorInRootDevDependencies', () => {
  test('дописує devDependencies, якщо пакету ще немає', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'x', version: '0.0.0', workspaces: ['npm'] })
      const ok = await ensureNitraCursorInRootDevDependencies(dir, {
        bundledVersion: '1.2.3',
        silent: true
      })
      expect(ok).toBe(true)
      const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
      expect(pkg.devDependencies['@nitra/cursor']).toBe('^1.2.3')
    })
  })

  test('не змінює package.json, якщо @nitra/cursor уже в devDependencies', async () => {
    await withTmpDir(async dir => {
      const before = {
        name: 'x',
        workspaces: ['npm'],
        devDependencies: { '@nitra/cursor': '^9.0.0' }
      }
      await writeJson(join(dir, 'package.json'), before)
      const ok = await ensureNitraCursorInRootDevDependencies(dir, {
        bundledVersion: '1.2.3',
        silent: true
      })
      expect(ok).toBe(false)
      const raw = await readFile(join(dir, 'package.json'), 'utf8')
      expect(raw).toContain('^9.0.0')
    })
  })

  test('не дописує, якщо @nitra/cursor лише в dependencies', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), {
        name: 'x',
        workspaces: ['npm'],
        dependencies: { '@nitra/cursor': '1.0.0' }
      })
      const ok = await ensureNitraCursorInRootDevDependencies(dir, {
        bundledVersion: '1.2.3',
        silent: true
      })
      expect(ok).toBe(false)
      const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
      expect(pkg.devDependencies).toBeUndefined()
    })
  })

  test('без package.json — false', async () => {
    await withTmpDir(async dir => {
      const ok = await ensureNitraCursorInRootDevDependencies(dir, {
        bundledVersion: '1.0.0',
        silent: true
      })
      expect(ok).toBe(false)
    })
  })

  test('не дописує у package.json без workspaces', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'leaf', version: '0.0.0' })
      const ok = await ensureNitraCursorInRootDevDependencies(dir, {
        bundledVersion: '1.2.3',
        silent: true
      })
      expect(ok).toBe(false)
      const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
      expect(pkg.devDependencies).toBeUndefined()
    })
  })

  test('із вкладеного пакета не шукає package.json з workspaces вгору', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'root', workspaces: ['npm'] })
      await mkdir(join(dir, 'npm'))
      await writeJson(join(dir, 'npm', 'package.json'), { name: '@nitra/cursor', version: '0.0.0' })

      const ok = await ensureNitraCursorInRootDevDependencies(join(dir, 'npm'), {
        bundledVersion: '1.2.3',
        silent: true
      })

      expect(ok).toBe(false)
      const rootPkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
      const leafPkg = JSON.parse(await readFile(join(dir, 'npm', 'package.json'), 'utf8'))
      expect(rootPkg.devDependencies).toBeUndefined()
      expect(leafPkg.devDependencies).toBeUndefined()
    })
  })
})

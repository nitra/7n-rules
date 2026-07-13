/**
 * Тести дописування `\@7n/rules` у `devDependencies` workspace-root package.json.
 */
import { describe, expect, test } from 'vitest'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { ensureNRulesInRootDevDependencies, readBundledPackageVersion } from '../ensure-n-rules-dev-dependencies.mjs'
import { withTmpDir, writeJson } from '../utils/test-helpers.mjs'

const SEMVER_RE = /^\d+\.\d+\.\d+/u

describe('ensureNRulesInRootDevDependencies', () => {
  test('дописує devDependencies, якщо пакету ще немає', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'x', version: '0.0.0', workspaces: ['npm'] })
      const ok = await ensureNRulesInRootDevDependencies(dir, {
        bundledVersion: '1.2.3',
        silent: true
      })
      expect(ok).toBe(true)
      const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
      expect(pkg.devDependencies['@7n/rules']).toBe('^1.2.3')
    })
  })

  test('не змінює package.json, якщо @7n/rules уже в devDependencies', async () => {
    await withTmpDir(async dir => {
      const before = {
        name: 'x',
        workspaces: ['npm'],
        devDependencies: { '@7n/rules': '^9.0.0' }
      }
      await writeJson(join(dir, 'package.json'), before)
      const ok = await ensureNRulesInRootDevDependencies(dir, {
        bundledVersion: '1.2.3',
        silent: true
      })
      expect(ok).toBe(false)
      const raw = await readFile(join(dir, 'package.json'), 'utf8')
      expect(raw).toContain('^9.0.0')
    })
  })

  test('апгрейдить пін у devDependencies, коли bundled новіша', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), {
        name: 'x',
        workspaces: ['npm'],
        devDependencies: { '@7n/rules': '^12.19.0' }
      })
      const ok = await ensureNRulesInRootDevDependencies(dir, {
        bundledVersion: '13.2.6',
        silent: true
      })
      expect(ok).toBe(true)
      const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
      expect(pkg.devDependencies['@7n/rules']).toBe('^13.2.6')
    })
  })

  test('не понижує пін, коли bundled старіша за поточний', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), {
        name: 'x',
        workspaces: ['npm'],
        devDependencies: { '@7n/rules': '^13.5.0' }
      })
      const ok = await ensureNRulesInRootDevDependencies(dir, {
        bundledVersion: '13.2.6',
        silent: true
      })
      expect(ok).toBe(false)
      const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
      expect(pkg.devDependencies['@7n/rules']).toBe('^13.5.0')
    })
  })

  test('не чіпає нечисловий специфікатор (workspace:*/latest)', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), {
        name: 'x',
        workspaces: ['npm'],
        devDependencies: { '@7n/rules': 'workspace:*' }
      })
      const ok = await ensureNRulesInRootDevDependencies(dir, {
        bundledVersion: '13.2.6',
        silent: true
      })
      expect(ok).toBe(false)
      const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
      expect(pkg.devDependencies['@7n/rules']).toBe('workspace:*')
    })
  })

  test('не дописує, якщо @7n/rules лише в dependencies', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), {
        name: 'x',
        workspaces: ['npm'],
        dependencies: { '@7n/rules': '1.0.0' }
      })
      const ok = await ensureNRulesInRootDevDependencies(dir, {
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
      const ok = await ensureNRulesInRootDevDependencies(dir, {
        bundledVersion: '1.0.0',
        silent: true
      })
      expect(ok).toBe(false)
    })
  })

  test('не дописує у package.json без workspaces', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'leaf', version: '0.0.0' })
      const ok = await ensureNRulesInRootDevDependencies(dir, {
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
      await writeJson(join(dir, 'npm', 'package.json'), { name: '@7n/rules', version: '0.0.0' })

      const ok = await ensureNRulesInRootDevDependencies(join(dir, 'npm'), {
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

  test('не дописує коли package.json з недійсним JSON', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'package.json'), 'invalid json{{{', 'utf8')
      const ok = await ensureNRulesInRootDevDependencies(dir, { bundledVersion: '1.2.3', silent: true })
      expect(ok).toBe(false)
    })
  })

  test('дописує і виводить у консоль коли silent не задано', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'x', workspaces: ['npm'] })
      const ok = await ensureNRulesInRootDevDependencies(dir, { bundledVersion: '1.2.3' })
      expect(ok).toBe(true)
    })
  })
})

describe('readBundledPackageVersion', () => {
  test('повертає рядок з реального package.json', async () => {
    const ver = await readBundledPackageVersion()
    expect(typeof ver).toBe('string')
    expect(ver).toMatch(SEMVER_RE)
  })
})

/**
 * Тести дописування `\@nitra/cursor` у `devDependencies` кореневого package.json.
 */
import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'

import { ensureNitraCursorInRootDevDependencies } from './ensure-nitra-cursor-dev-dependencies.mjs'
import { withTmpCwd, writeJson } from './utils/test-helpers.mjs'

describe('ensureNitraCursorInRootDevDependencies', () => {
  test('дописує devDependencies, якщо пакету ще немає', async () => {
    await withTmpCwd(async dir => {
      await writeJson('package.json', { name: 'x', version: '0.0.0' })
      const ok = await ensureNitraCursorInRootDevDependencies(dir, {
        bundledVersion: '1.2.3',
        silent: true
      })
      expect(ok).toBe(true)
      const pkg = JSON.parse(await readFile('package.json', 'utf8'))
      expect(pkg.devDependencies['@nitra/cursor']).toBe('^1.2.3')
    })
  })

  test('не змінює package.json, якщо @nitra/cursor уже в devDependencies', async () => {
    await withTmpCwd(async dir => {
      const before = {
        name: 'x',
        devDependencies: { '@nitra/cursor': '^9.0.0' }
      }
      await writeJson('package.json', before)
      const ok = await ensureNitraCursorInRootDevDependencies(dir, {
        bundledVersion: '1.2.3',
        silent: true
      })
      expect(ok).toBe(false)
      const raw = await readFile('package.json', 'utf8')
      expect(raw).toContain('^9.0.0')
    })
  })

  test('не дописує, якщо @nitra/cursor лише в dependencies', async () => {
    await withTmpCwd(async dir => {
      await writeJson('package.json', {
        name: 'x',
        dependencies: { '@nitra/cursor': '1.0.0' }
      })
      const ok = await ensureNitraCursorInRootDevDependencies(dir, {
        bundledVersion: '1.2.3',
        silent: true
      })
      expect(ok).toBe(false)
      const pkg = JSON.parse(await readFile('package.json', 'utf8'))
      expect(pkg.devDependencies).toBeUndefined()
    })
  })

  test('без package.json — false', async () => {
    await withTmpCwd(async dir => {
      const ok = await ensureNitraCursorInRootDevDependencies(dir, {
        bundledVersion: '1.0.0',
        silent: true
      })
      expect(ok).toBe(false)
    })
  })
})

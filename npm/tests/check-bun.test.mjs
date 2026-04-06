/**
 * Тести check-bun у ізольованих тимчасових каталогах.
 */
import { describe, expect, test } from 'bun:test'
import { writeFile } from 'node:fs/promises'

import { check } from '../scripts/check-bun.mjs'
import { withTmpCwd, writeJson } from './helpers.mjs'

describe('check-bun', () => {
  test('успіх: bun.lock, мінімальний package.json', async () => {
    await withTmpCwd(async () => {
      await writeFile('bun.lock', '', 'utf8')
      await writeJson('package.json', { name: 't', private: true })
      expect(await check()).toBe(0)
    })
  })

  test('помилка: заборонений package-lock.json', async () => {
    await withTmpCwd(async () => {
      await writeFile('bun.lock', '', 'utf8')
      await writeFile('package-lock.json', '{}', 'utf8')
      await writeJson('package.json', { name: 't' })
      expect(await check()).toBe(1)
    })
  })

  test('помилка: packageManager у package.json', async () => {
    await withTmpCwd(async () => {
      await writeFile('bun.lock', '', 'utf8')
      await writeJson('package.json', {
        name: 't',
        packageManager: 'yarn@1.0.0'
      })
      expect(await check()).toBe(1)
    })
  })

  test('docker у .n-cursor.json вимагає lint-docker', async () => {
    await withTmpCwd(async () => {
      await writeFile('bun.lock', '', 'utf8')
      await writeJson('.n-cursor.json', { rules: ['docker'] })
      await writeJson('package.json', { name: 't', scripts: {} })
      expect(await check()).toBe(1)
    })
  })

  test('docker + lint-docker — OK', async () => {
    await withTmpCwd(async () => {
      await writeFile('bun.lock', '', 'utf8')
      await writeJson('.n-cursor.json', { rules: ['docker'] })
      await writeJson('package.json', {
        name: 't',
        scripts: {
          'lint-docker': 'echo',
          lint: 'bun run lint-docker && oxfmt .'
        }
      })
      expect(await check()).toBe(0)
    })
  })
})

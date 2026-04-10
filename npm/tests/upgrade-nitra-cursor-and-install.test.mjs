/**
 * Тести для upgrade-nitra-cursor-and-install.mjs: пропуск workspace/file/link, визначення шляху
 * до node_modules, парсинг відповіді npm (через mock fetch).
 */

import { afterEach, describe, expect, mock, test } from 'bun:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  fetchLatestNitraCursorVersionFromNpm,
  resolveInstalledPackageRoot,
  shouldSkipNpmVersionUpgrade
} from '../scripts/upgrade-nitra-cursor-and-install.mjs'
import { withTmpCwd } from './helpers.mjs'

describe('shouldSkipNpmVersionUpgrade', () => {
  test('semver з діапазоном — не пропускати', () => {
    expect(shouldSkipNpmVersionUpgrade('^1.2.3')).toBe(false)
    expect(shouldSkipNpmVersionUpgrade('~4.0.0')).toBe(false)
    expect(shouldSkipNpmVersionUpgrade('1.0.0')).toBe(false)
  })

  test('workspace та протоколи — пропускати', () => {
    expect(shouldSkipNpmVersionUpgrade('workspace:*')).toBe(true)
    expect(shouldSkipNpmVersionUpgrade('file:../npm')).toBe(true)
    expect(shouldSkipNpmVersionUpgrade('link:./x')).toBe(true)
    expect(shouldSkipNpmVersionUpgrade('portal:../y')).toBe(true)
    expect(shouldSkipNpmVersionUpgrade('git+ssh://x')).toBe(true)
    expect(shouldSkipNpmVersionUpgrade('https://a/b.tgz')).toBe(true)
    expect(shouldSkipNpmVersionUpgrade('./local')).toBe(true)
  })
})

describe('resolveInstalledPackageRoot', () => {
  test('fallback якщо node_modules немає', async () => {
    await withTmpCwd(async dir => {
      const fb = join(dir, 'fallback')
      await mkdir(fb, { recursive: true })
      expect(resolveInstalledPackageRoot(dir, fb)).toBe(fb)
    })
  })

  test('node_modules/@nitra/cursor з package.json', async () => {
    await withTmpCwd(async dir => {
      const installed = join(dir, 'node_modules', '@nitra/cursor')
      await mkdir(installed, { recursive: true })
      await writeFile(
        join(installed, 'package.json'),
        JSON.stringify({ name: '@nitra/cursor', version: '9.9.9' }),
        'utf8'
      )
      const fb = join(dir, 'fallback')
      expect(resolveInstalledPackageRoot(dir, fb)).toBe(installed)
    })
  })
})

describe('fetchLatestNitraCursorVersionFromNpm', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('повертає version з тіла відповіді', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ version: '1.2.99' })
      })
    )

    await expect(fetchLatestNitraCursorVersionFromNpm()).resolves.toBe('1.2.99')
  })

  test('кидає при не-ok', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: false,
        status: 500,
        statusText: 'err'
      })
    )

    await expect(fetchLatestNitraCursorVersionFromNpm()).rejects.toThrow('npm registry')
  })
})

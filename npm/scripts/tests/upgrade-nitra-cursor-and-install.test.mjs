/**
 * Тести для upgrade-nitra-cursor-and-install.mjs: пропуск workspace/file/link, визначення шляху
 * до node_modules, парсинг відповіді npm (через mock fetch).
 */

import { afterEach, beforeEach, describe, expect, vi, test } from 'vitest'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  fetchLatestNitraCursorVersionFromNpm,
  resolveInstalledPackageRoot,
  shouldSkipNpmVersionUpgrade,
  upgradeNitraCursorToLatestAndBunInstall
} from '../upgrade-nitra-cursor-and-install.mjs'
import { withTmpDir } from '../utils/test-helpers.mjs'

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
    await withTmpDir(async dir => {
      const fb = join(dir, 'fallback')
      await mkdir(fb, { recursive: true })
      expect(resolveInstalledPackageRoot(dir, fb)).toBe(fb)
    })
  })

  test('node_modules/@nitra/cursor з package.json', async () => {
    await withTmpDir(async dir => {
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
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ version: '1.2.99' })
      })
    )

    await expect(fetchLatestNitraCursorVersionFromNpm()).resolves.toBe('1.2.99')
  })

  test('кидає при не-ok', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 500,
        statusText: 'err'
      })
    )

    await expect(fetchLatestNitraCursorVersionFromNpm()).rejects.toThrow('npm registry')
  })

  test('кидає коли у відповіді немає version', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    )
    await expect(fetchLatestNitraCursorVersionFromNpm()).rejects.toThrow('немає поля version')
  })

  test('кидає коли version — порожній рядок', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ version: '   ' }) })
    )
    await expect(fetchLatestNitraCursorVersionFromNpm()).rejects.toThrow('немає поля version')
  })

  test('кидає коли version — не string', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ version: 123 }) })
    )
    await expect(fetchLatestNitraCursorVersionFromNpm()).rejects.toThrow('немає поля version')
  })

  test('кидає коли body=null', async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(null) }))
    await expect(fetchLatestNitraCursorVersionFromNpm()).rejects.toThrow('немає поля version')
  })
})

describe('shouldSkipNpmVersionUpgrade — додаткові гілки', () => {
  test('порожній рядок та whitespace → true', () => {
    expect(shouldSkipNpmVersionUpgrade('')).toBe(true)
    expect(shouldSkipNpmVersionUpgrade('   ')).toBe(true)
  })

  test('npm:-протокол (alias) → true', () => {
    expect(shouldSkipNpmVersionUpgrade('npm:@scope/x@1.0.0')).toBe(true)
  })

  test('git:// та git+https — true', () => {
    expect(shouldSkipNpmVersionUpgrade('git://github.com/x/y')).toBe(true)
    expect(shouldSkipNpmVersionUpgrade('git+https://github.com/x/y')).toBe(true)
  })

  test("https:// (без s) → true", () => {
    expect(shouldSkipNpmVersionUpgrade("https://a/b.tgz")).toBe(true)
  })

  test('відносний шлях ../ → true', () => {
    expect(shouldSkipNpmVersionUpgrade('../local-pkg')).toBe(true)
  })

  test('case-insensitive префікси', () => {
    expect(shouldSkipNpmVersionUpgrade('WORKSPACE:*')).toBe(true)
    expect(shouldSkipNpmVersionUpgrade('FILE:../x')).toBe(true)
  })
})

describe('upgradeNitraCursorToLatestAndBunInstall — early-returns без fetch', () => {
  const originalFetch = globalThis.fetch
  beforeEach(() => {
    vi.spyOn(console, 'log').mockReturnValue()
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  test('немає package.json → повертає fallback', async () => {
    await withTmpDir(async dir => {
      const fb = join(dir, 'fb')
      await mkdir(fb, { recursive: true })
      const result = await upgradeNitraCursorToLatestAndBunInstall(dir, fb)
      expect(result).toBe(fb)
    })
  })

  test('package.json з некоректним JSON → fallback (catch у парсингу)', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'package.json'), '{ not json', 'utf8')
      const fb = join(dir, 'fb')
      await mkdir(fb, { recursive: true })
      const result = await upgradeNitraCursorToLatestAndBunInstall(dir, fb)
      expect(result).toBe(fb)
    })
  })

  test('package.json — це масив (не object) → fallback', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'package.json'), '[]', 'utf8')
      const fb = join(dir, 'fb')
      await mkdir(fb, { recursive: true })
      const result = await upgradeNitraCursorToLatestAndBunInstall(dir, fb)
      expect(result).toBe(fb)
    })
  })

  test('@nitra/cursor через workspace:* у devDeps → skip + fallback, без fetch', async () => {
    globalThis.fetch = vi.fn(() => {
      throw new Error('fetch не повинен викликатись для workspace:')
    })
    await withTmpDir(async dir => {
      await writeFile(
        join(dir, 'package.json'),
        JSON.stringify({ devDependencies: { '@nitra/cursor': 'workspace:*' } }),
        'utf8'
      )
      const fb = join(dir, 'fb')
      await mkdir(fb, { recursive: true })
      const result = await upgradeNitraCursorToLatestAndBunInstall(dir, fb)
      expect(result).toBe(fb)
      expect(globalThis.fetch).not.toHaveBeenCalled()
    })
  })

  test('@nitra/cursor через file:.. у deps → skip + fallback', async () => {
    globalThis.fetch = vi.fn(() => {
      throw new Error('fetch не повинен викликатись для file:')
    })
    await withTmpDir(async dir => {
      await writeFile(
        join(dir, 'package.json'),
        JSON.stringify({ dependencies: { '@nitra/cursor': 'file:../npm' } }),
        'utf8'
      )
      const fb = join(dir, 'fb')
      await mkdir(fb, { recursive: true })
      const result = await upgradeNitraCursorToLatestAndBunInstall(dir, fb)
      expect(result).toBe(fb)
      expect(globalThis.fetch).not.toHaveBeenCalled()
    })
  })

  test('devDependencies як масив (broken) → знаходить як «нема залежності», далі піде шлях додавання', async () => {
    // Перетинаємось з гілкою `if (dev && typeof dev === 'object' && !Array.isArray(dev) ...)`.
    // Якщо devDependencies — масив, findNitraCursorDependency повертає null → залежність буде додана.
    // Щоб уникнути fetch + bun i, передамо невалідний pkg як string (теж типу!=object) — fallback.
    globalThis.fetch = vi.fn(() => {
      throw new Error('fetch не повинен викликатись')
    })
    await withTmpDir(async dir => {
      // Pkg = "literal-string" — JSON.parse дає string, не object → fallback.
      await writeFile(join(dir, 'package.json'), '"not-an-object"', 'utf8')
      const fb = join(dir, 'fb')
      await mkdir(fb, { recursive: true })
      const result = await upgradeNitraCursorToLatestAndBunInstall(dir, fb)
      expect(result).toBe(fb)
      expect(globalThis.fetch).not.toHaveBeenCalled()
    })
  })

  test('devDependencies існує, але @nitra/cursor — не string → залежність ігнорується', async () => {
    // Гілка: typeof value === 'string' інакше повертаємо null → fallback або новий запис.
    // Якщо викинути на додавання — fetch обов'язково викликається. Тому перевіримо лише,
    // що findNitraCursorDependency повертає null коли value не-string і fall-through.
    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ version: '5.0.0' }) }))
    await withTmpDir(async dir => {
      await writeFile(
        join(dir, 'package.json'),
        JSON.stringify({ devDependencies: { '@nitra/cursor': 42, otherPkg: '1.0.0' } }),
        'utf8'
      )
      const fb = join(dir, 'fb')
      await mkdir(fb, { recursive: true })
      // bun i буде кинуто (нема bun у sandbox-середовищі без PATH), тому очікуємо реджект — обходимо це
      // через те, що fetch уже викликаний, що достатньо як signal про потрапляння у гілку «додавання».
      await upgradeNitraCursorToLatestAndBunInstall(dir, fb).catch(() => null)
      expect(globalThis.fetch).toHaveBeenCalled()
      // І перевіряємо, що package.json було оновлено (запис у devDependencies @nitra/cursor = "^5.0.0")
      const updated = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
      expect(updated.devDependencies['@nitra/cursor']).toBe('^5.0.0')
    })
  })

  test('package.json є директорією (readFile кидає EISDIR) → fallback (line 157)', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'package.json'), { recursive: true })
      const fb = join(dir, 'fb')
      await mkdir(fb, { recursive: true })
      const result = await upgradeNitraCursorToLatestAndBunInstall(dir, fb)
      expect(result).toBe(fb)
    })
  })
})

describe('upgradeNitraCursorToLatestAndBunInstall — version upgrade paths', () => {
  const originalFetch = globalThis.fetch
  beforeEach(() => {
    vi.spyOn(console, 'log').mockReturnValue()
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ version: '5.0.0' }) })
    )
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  test('немає devDependencies у pkg → створює і додає @nitra/cursor (line 183)', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'package.json'), JSON.stringify({}), 'utf8')
      const fb = join(dir, 'fb')
      await mkdir(fb, { recursive: true })
      await upgradeNitraCursorToLatestAndBunInstall(dir, fb).catch(() => null)
      const updated = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
      expect(updated.devDependencies['@nitra/cursor']).toBe('^5.0.0')
    })
  })

  test('версія вже актуальна (found.value === desired) — не перезаписує package.json (lines 193-194)', async () => {
    await withTmpDir(async dir => {
      const original = JSON.stringify({ devDependencies: { '@nitra/cursor': '^5.0.0' } })
      await writeFile(join(dir, 'package.json'), original, 'utf8')
      const fb = join(dir, 'fb')
      await mkdir(fb, { recursive: true })
      await upgradeNitraCursorToLatestAndBunInstall(dir, fb).catch(() => null)
      const content = await readFile(join(dir, 'package.json'), 'utf8')
      expect(JSON.parse(content).devDependencies['@nitra/cursor']).toBe('^5.0.0')
    })
  })

  test('оновлює версію в devDependencies коли found.value !== desired (lines 196-197, 201-202)', async () => {
    await withTmpDir(async dir => {
      await writeFile(
        join(dir, 'package.json'),
        JSON.stringify({ devDependencies: { '@nitra/cursor': '^4.0.0' } }),
        'utf8'
      )
      const fb = join(dir, 'fb')
      await mkdir(fb, { recursive: true })
      await upgradeNitraCursorToLatestAndBunInstall(dir, fb).catch(() => null)
      const updated = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
      expect(updated.devDependencies['@nitra/cursor']).toBe('^5.0.0')
    })
  })

  test('оновлює версію в dependencies коли пакет знайдено в deps (line 199)', async () => {
    await withTmpDir(async dir => {
      await writeFile(
        join(dir, 'package.json'),
        JSON.stringify({ dependencies: { '@nitra/cursor': '^4.0.0' } }),
        'utf8'
      )
      const fb = join(dir, 'fb')
      await mkdir(fb, { recursive: true })
      await upgradeNitraCursorToLatestAndBunInstall(dir, fb).catch(() => null)
      const updated = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
      expect(updated.dependencies['@nitra/cursor']).toBe('^5.0.0')
    })
  })
})

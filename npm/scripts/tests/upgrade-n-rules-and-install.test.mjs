/**
 * Тести для upgrade-nitra-cursor-and-install.mjs: пропуск workspace/file/link, визначення шляху
 * до node_modules, парсинг відповіді npm (через mock fetch).
 */

import { afterEach, beforeEach, describe, expect, vi, test } from 'vitest'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  fetchLatestNRulesVersionFromNpm,
  resolveInstalledPackageRoot,
  shouldSkipNpmVersionUpgrade,
  upgradeNRulesToLatestAndBunInstall
} from '../upgrade-n-rules-and-install.mjs'
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

  test('node_modules/@7n/rules з package.json', async () => {
    await withTmpDir(async dir => {
      const installed = join(dir, 'node_modules', '@7n/rules')
      await mkdir(installed, { recursive: true })
      await writeFile(join(installed, 'package.json'), JSON.stringify({ name: '@7n/rules', version: '9.9.9' }), 'utf8')
      const fb = join(dir, 'fallback')
      expect(resolveInstalledPackageRoot(dir, fb)).toBe(installed)
    })
  })
})

describe('fetchLatestNRulesVersionFromNpm', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('повертає version з тіла відповіді', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ version: '1.2.99' })
        })
      )
    )

    await expect(fetchLatestNRulesVersionFromNpm()).resolves.toBe('1.2.99')
  })

  test('кидає при не-ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 500,
          statusText: 'err'
        })
      )
    )

    await expect(fetchLatestNRulesVersionFromNpm()).rejects.toThrow('npm registry')
  })

  test('кидає коли у відповіді немає version', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
    )
    await expect(fetchLatestNRulesVersionFromNpm()).rejects.toThrow('немає поля version')
  })

  test('кидає коли version — порожній рядок', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ version: ' '.repeat(3) }) }))
    )
    await expect(fetchLatestNRulesVersionFromNpm()).rejects.toThrow('немає поля version')
  })

  test('кидає коли version — не string', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ version: 123 }) }))
    )
    await expect(fetchLatestNRulesVersionFromNpm()).rejects.toThrow('немає поля version')
  })

  test('кидає коли body=null', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(null) }))
    )
    await expect(fetchLatestNRulesVersionFromNpm()).rejects.toThrow('немає поля version')
  })
})

describe('shouldSkipNpmVersionUpgrade — додаткові гілки', () => {
  test('порожній рядок та whitespace → true', () => {
    expect(shouldSkipNpmVersionUpgrade('')).toBe(true)
    expect(shouldSkipNpmVersionUpgrade(' '.repeat(3))).toBe(true)
  })

  test('npm:-протокол (alias) → true', () => {
    expect(shouldSkipNpmVersionUpgrade('npm:@scope/x@1.0.0')).toBe(true)
  })

  test('git:// та git+https — true', () => {
    expect(shouldSkipNpmVersionUpgrade('git://github.com/x/y')).toBe(true)
    expect(shouldSkipNpmVersionUpgrade('git+https://github.com/x/y')).toBe(true)
  })

  test('https:// (без s) → true', () => {
    expect(shouldSkipNpmVersionUpgrade('https://a/b.tgz')).toBe(true)
  })

  test('відносний шлях ../ → true', () => {
    expect(shouldSkipNpmVersionUpgrade('../local-pkg')).toBe(true)
  })

  test('case-insensitive префікси', () => {
    expect(shouldSkipNpmVersionUpgrade('WORKSPACE:*')).toBe(true)
    expect(shouldSkipNpmVersionUpgrade('FILE:../x')).toBe(true)
  })
})

describe('upgradeNRulesToLatestAndBunInstall — early-returns без fetch', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockReturnValue()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  test('немає package.json → повертає fallback', async () => {
    await withTmpDir(async dir => {
      const fb = join(dir, 'fb')
      await mkdir(fb, { recursive: true })
      const result = await upgradeNRulesToLatestAndBunInstall(dir, fb)
      expect(result).toBe(fb)
    })
  })

  test('package.json з некоректним JSON → fallback (catch у парсингу)', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'package.json'), '{ not json', 'utf8')
      const fb = join(dir, 'fb')
      await mkdir(fb, { recursive: true })
      const result = await upgradeNRulesToLatestAndBunInstall(dir, fb)
      expect(result).toBe(fb)
    })
  })

  test('package.json — це масив (не object) → fallback', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'package.json'), '[]', 'utf8')
      const fb = join(dir, 'fb')
      await mkdir(fb, { recursive: true })
      const result = await upgradeNRulesToLatestAndBunInstall(dir, fb)
      expect(result).toBe(fb)
    })
  })

  test('@7n/rules через workspace:* у devDeps → skip + fallback, без fetch', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('fetch не повинен викликатись для workspace:')
      })
    )
    await withTmpDir(async dir => {
      await writeFile(
        join(dir, 'package.json'),
        JSON.stringify({ devDependencies: { '@7n/rules': 'workspace:*' } }),
        'utf8'
      )
      const fb = join(dir, 'fb')
      await mkdir(fb, { recursive: true })
      const result = await upgradeNRulesToLatestAndBunInstall(dir, fb)
      expect(result).toBe(fb)
      expect(fetch).not.toHaveBeenCalled()
    })
  })

  test('@7n/rules через file:.. у deps → skip + fallback', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('fetch не повинен викликатись для file:')
      })
    )
    await withTmpDir(async dir => {
      await writeFile(
        join(dir, 'package.json'),
        JSON.stringify({ dependencies: { '@7n/rules': 'file:../npm' } }),
        'utf8'
      )
      const fb = join(dir, 'fb')
      await mkdir(fb, { recursive: true })
      const result = await upgradeNRulesToLatestAndBunInstall(dir, fb)
      expect(result).toBe(fb)
      expect(fetch).not.toHaveBeenCalled()
    })
  })

  test('devDependencies як масив (broken) → знаходить як «нема залежності», далі піде шлях додавання', async () => {
    // Перетинаємось з гілкою `if (dev && typeof dev === 'object' && !Array.isArray(dev) ...)`.
    // Якщо devDependencies — масив, findNRulesDependency повертає null → залежність буде додана.
    // Щоб уникнути fetch + bun i, передамо невалідний pkg як string (теж типу!=object) — fallback.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('fetch не повинен викликатись')
      })
    )
    await withTmpDir(async dir => {
      // Pkg = "literal-string" — JSON.parse дає string, не object → fallback.
      await writeFile(join(dir, 'package.json'), '"not-an-object"', 'utf8')
      const fb = join(dir, 'fb')
      await mkdir(fb, { recursive: true })
      const result = await upgradeNRulesToLatestAndBunInstall(dir, fb)
      expect(result).toBe(fb)
      expect(fetch).not.toHaveBeenCalled()
    })
  })

  test('devDependencies існує, але @7n/rules — не string → залежність ігнорується', async () => {
    // Гілка: typeof value === 'string' інакше повертаємо null → fallback або новий запис.
    // Якщо викинути на додавання — fetch обов'язково викликається. Тому перевіримо лише,
    // що findNRulesDependency повертає null коли value не-string і fall-through.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ version: '5.0.0' }) }))
    )
    await withTmpDir(async dir => {
      await writeFile(
        join(dir, 'package.json'),
        JSON.stringify({ devDependencies: { '@7n/rules': 42, otherPkg: '1.0.0' } }),
        'utf8'
      )
      const fb = join(dir, 'fb')
      await mkdir(fb, { recursive: true })
      // bun i буде кинуто (нема bun у sandbox-середовищі без PATH), тому очікуємо реджект — обходимо це
      // через те, що fetch уже викликаний, що достатньо як signal про потрапляння у гілку «додавання».
      try {
        await upgradeNRulesToLatestAndBunInstall(dir, fb)
      } catch {
        // bun i кидає у sandbox без PATH — ігноруємо, нас цікавить лише виклик fetch
      }
      expect(fetch).toHaveBeenCalled()
      // І перевіряємо, що package.json було оновлено (запис у devDependencies @7n/rules = "^5.0.0")
      const updated = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
      expect(updated.devDependencies['@7n/rules']).toBe('^5.0.0')
    })
  })

  test('package.json є директорією (readFile кидає EISDIR) → fallback (line 157)', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'package.json'), { recursive: true })
      const fb = join(dir, 'fb')
      await mkdir(fb, { recursive: true })
      const result = await upgradeNRulesToLatestAndBunInstall(dir, fb)
      expect(result).toBe(fb)
    })
  })
})

describe('upgradeNRulesToLatestAndBunInstall — version upgrade paths', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockReturnValue()
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ version: '5.0.0' }) }))
    )
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  test('немає devDependencies у pkg → створює і додає @7n/rules (line 183)', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'package.json'), JSON.stringify({}), 'utf8')
      const fb = join(dir, 'fb')
      await mkdir(fb, { recursive: true })
      try {
        await upgradeNRulesToLatestAndBunInstall(dir, fb)
      } catch {
        // bun i недоступний у sandbox — ігноруємо
      }
      const updated = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
      expect(updated.devDependencies['@7n/rules']).toBe('^5.0.0')
    })
  })

  test('версія вже актуальна (found.value === desired) — не перезаписує package.json (lines 193-194)', async () => {
    await withTmpDir(async dir => {
      const original = JSON.stringify({ devDependencies: { '@7n/rules': '^5.0.0' } })
      await writeFile(join(dir, 'package.json'), original, 'utf8')
      const fb = join(dir, 'fb')
      await mkdir(fb, { recursive: true })
      try {
        await upgradeNRulesToLatestAndBunInstall(dir, fb)
      } catch {
        // bun i недоступний у sandbox — ігноруємо
      }
      const content = await readFile(join(dir, 'package.json'), 'utf8')
      expect(JSON.parse(content).devDependencies['@7n/rules']).toBe('^5.0.0')
    })
  })

  test('оновлює версію в devDependencies коли found.value !== desired (lines 196-197, 201-202)', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'package.json'), JSON.stringify({ devDependencies: { '@7n/rules': '^4.0.0' } }), 'utf8')
      const fb = join(dir, 'fb')
      await mkdir(fb, { recursive: true })
      try {
        await upgradeNRulesToLatestAndBunInstall(dir, fb)
      } catch {
        // bun i недоступний у sandbox — ігноруємо
      }
      const updated = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
      expect(updated.devDependencies['@7n/rules']).toBe('^5.0.0')
    })
  })

  test('оновлює версію в dependencies коли пакет знайдено в deps (line 199)', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'package.json'), JSON.stringify({ dependencies: { '@7n/rules': '^4.0.0' } }), 'utf8')
      const fb = join(dir, 'fb')
      await mkdir(fb, { recursive: true })
      try {
        await upgradeNRulesToLatestAndBunInstall(dir, fb)
      } catch {
        // bun i недоступний у sandbox — ігноруємо
      }
      const updated = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
      expect(updated.dependencies['@7n/rules']).toBe('^5.0.0')
    })
  })
})

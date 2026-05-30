/**
 * Тести rules/capacitor/fix.mjs: semver-підмноги, обхід `package.json` і iOS.
 */
import { describe, expect, test } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  capacitorSegmentMinMajor,
  capacitorVersionRangeMinMajor,
  check,
  collectCapacitorDataFromAllPackageJson,
  isCapacitorCoreVersionAtLeast8,
  findFirstPodfileUnderIosExcludingPods,
  nitrAObjectAllowsIosCocoaPods,
  recordCapacitorFromOnePackageJson,
  walkIosForPodfileSkipPods
} from '../platforms.mjs'
import { withTmpDir, writeJson, ensureDir } from '../../../../scripts/utils/test-helpers.mjs'

describe('isCapacitorCoreVersionAtLeast8 / semver helpers', () => {
  test('^8.0.0 — ok', () => {
    expect(isCapacitorCoreVersionAtLeast8('^8.0.0')).toBe(true)
  })
  test('^7.0.0 — не ok', () => {
    expect(isCapacitorCoreVersionAtLeast8('^7.0.0')).toBe(false)
  })
  test('* — не ok', () => {
    expect(isCapacitorCoreVersionAtLeast8('*')).toBe(false)
  })
  test('7 || 8 — не ok (7 у зʼєднанні)', () => {
    expect(isCapacitorCoreVersionAtLeast8('^7.0.0 || ^8.0.0')).toBe(false)
  })
  test('^9.0.0 — ok', () => {
    expect(isCapacitorCoreVersionAtLeast8('^9.0.0')).toBe(true)
  })
  test('nitrAObjectAllowsIosCocoaPods', () => {
    expect(nitrAObjectAllowsIosCocoaPods({ iosCocoaPodsBecausePluginsLackSpm: true })).toBe(true)
    expect(nitrAObjectAllowsIosCocoaPods({ iosCocoaPodsAllowed: true })).toBe(true)
    expect(nitrAObjectAllowsIosCocoaPods({})).toBe(false)
    expect(nitrAObjectAllowsIosCocoaPods(null)).toBe(false)
  })
  test('capacitorVersionRangeMinMajor: >=8.0.0 <9', () => {
    expect(capacitorVersionRangeMinMajor('>=8.0.0 <9.0.0')).toBe(8)
  })
  test('capacitorSegmentMinMajor: * — null', () => {
    expect(capacitorSegmentMinMajor('*')).toBeNull()
  })
})

describe('check (інтеграція)', () => {
  test('0 — не Capacitor-проєкт', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'x', private: true })
      expect(await check(dir)).toBe(0)
    })
  })

  test('0 — @capacitor/core ^8, без ios', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), {
        name: 'x',
        private: true,
        dependencies: { '@capacitor/core': '^8.0.0' }
      })
      expect(await check(dir)).toBe(0)
    })
  })

  test('1 — @capacitor/core ^7', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), {
        name: 'x',
        private: true,
        dependencies: { '@capacitor/core': '^7.0.0' }
      })
      expect(await check(dir)).toBe(1)
    })
  })

  test('1 — capacitor.config.json без @capacitor/core', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'capacitor.config.json'), '{}\n', 'utf8')
      await writeJson(join(dir, 'package.json'), { name: 'x', private: true })
      expect(await check(dir)).toBe(1)
    })
  })

  test('1 — ios/Podfile', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), {
        name: 'x',
        private: true,
        dependencies: { '@capacitor/core': '^8.0.0' }
      })
      await ensureDir(join(dir, 'ios'))
      await writeFile(join(dir, 'ios/Podfile'), "platform :ios, '15.0'\n", 'utf8')
      expect(await check(dir)).toBe(1)
    })
  })

  test('0 — ios/Podfile з винятком nitra у package.json', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), {
        name: 'x',
        private: true,
        dependencies: { '@capacitor/core': '^8.0.0' },
        nitra: { iosCocoaPodsBecausePluginsLackSpm: true }
      })
      await ensureDir(join(dir, 'ios'))
      await writeFile(join(dir, 'ios/Podfile'), "platform :ios, '15.0'\n", 'utf8')
      expect(await check(dir)).toBe(0)
    })
  })

  test('0 — ios/Podfile з винятком у capacitor.config.mjs', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), {
        name: 'x',
        private: true,
        dependencies: { '@capacitor/core': '^8.0.0' }
      })
      await writeFile(
        join(dir, 'capacitor.config.mjs'),
        `const c = { appId: "a", nitra: { iosCocoaPodsBecausePluginsLackSpm: true } }\nexport default c\n`,
        'utf8'
      )
      await ensureDir(join(dir, 'ios'))
      await writeFile(join(dir, 'ios/Podfile'), "platform :ios, '15.0'\n", 'utf8')
      expect(await check(dir)).toBe(0)
    })
  })

  test('0 — ios без Podfile', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), {
        name: 'x',
        private: true,
        dependencies: { '@capacitor/core': '^8.0.0' }
      })
      await ensureDir(join(dir, 'ios/App'))
      await writeFile(join(dir, 'ios/App/Info.plist'), '<?xml version="1.0"?>\n', 'utf8')
      expect(await check(dir)).toBe(0)
    })
  })
})

describe('findFirstPodfileUnderIosExcludingPods', () => {
  test('null без ios/', async () => {
    await withTmpDir(async dir => {
      expect(await findFirstPodfileUnderIosExcludingPods(dir)).toBeNull()
    })
  })

  test('виявляє ios/Podfile', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'ios'))
      await writeFile(join(dir, 'ios/Podfile'), "platform :ios, '16'\n", 'utf8')
      const p = await findFirstPodfileUnderIosExcludingPods(dir)
      expect(p).toBe('ios/Podfile')
    })
  })

  test('Podfile у Pods/ — пропускається', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'ios/Pods'))
      await writeFile(join(dir, 'ios/Pods/Podfile'), "pod 'AFNetworking'\n", 'utf8')
      expect(await findFirstPodfileUnderIosExcludingPods(dir)).toBeNull()
    })
  })
})

describe('walkIosForPodfileSkipPods: build/ і DerivedData/ пропускаються', () => {
  test('Podfile у build/ — пропускається', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'ios/build'))
      await writeFile(join(dir, 'ios/build/Podfile'), 'pod\n', 'utf8')
      let found = null
      await walkIosForPodfileSkipPods(dir, join(dir, 'ios'), rel => {
        found = rel
      })
      expect(found).toBeNull()
    })
  })
})

describe('capacitorSegmentMinMajor: крайні випадки', () => {
  test('non-string → null', () => {
    expect(capacitorSegmentMinMajor(/** @type {string} */ (null))).toBeNull()
  })

  test('порожній рядок → null', () => {
    expect(capacitorSegmentMinMajor('')).toBeNull()
  })

  test('x → null', () => {
    expect(capacitorSegmentMinMajor('x')).toBeNull()
  })

  test('latest → null', () => {
    expect(capacitorSegmentMinMajor('latest')).toBeNull()
  })

  test('<8.0.0 → 0 (тільки верхня межа)', () => {
    expect(capacitorSegmentMinMajor('<8.0.0')).toBe(0)
  })

  test('<=7.0.0 → 0', () => {
    expect(capacitorSegmentMinMajor('<=7.0.0')).toBe(0)
  })

  test('>7.0.0 (ексклюзивний, не >=) → 7', () => {
    expect(capacitorSegmentMinMajor('>7.0.0')).toBe(7)
  })

  test('7.0.0 - 9.0.0 (hyphen range) → 7', () => {
    expect(capacitorSegmentMinMajor('7.0.0 - 9.0.0')).toBe(7)
  })

  test('~8.0.0 → 8', () => {
    expect(capacitorSegmentMinMajor('~8.0.0')).toBe(8)
  })

  test('=8.0.0 → 8', () => {
    expect(capacitorSegmentMinMajor('=8.0.0')).toBe(8)
  })

  test('8.0.0 plain version → 8', () => {
    expect(capacitorSegmentMinMajor('8.0.0')).toBe(8)
  })
})

describe('recordCapacitorFromOnePackageJson: помилки читання', () => {
  test('файл не знайдено → тихо повертається', async () => {
    const out = { byPath: new Map(), anyCapacitor: false }
    await recordCapacitorFromOnePackageJson('/nonexistent/package.json', '/', out)
    expect(out.anyCapacitor).toBe(false)
    expect(out.byPath.size).toBe(0)
  })

  test('невалідний JSON → тихо повертається', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'package.json'), 'not json at all', 'utf8')
      const out = { byPath: new Map(), anyCapacitor: false }
      await recordCapacitorFromOnePackageJson(join(dir, 'package.json'), dir, out)
      expect(out.anyCapacitor).toBe(false)
    })
  })
})

describe('collectCapacitorDataFromAllPackageJson: out без byPath', () => {
  test('out без byPath → ініціалізується як new Map()', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), {
        name: 'x',
        dependencies: { '@capacitor/core': '^8.0.0' }
      })
      const out = /** @type {{ byPath: Map<string,string>, anyCapacitor: boolean }} */ ({
        anyCapacitor: false
      })
      await collectCapacitorDataFromAllPackageJson(dir, out)
      expect(out.byPath).toBeInstanceOf(Map)
      expect(out.anyCapacitor).toBe(true)
    })
  })
})

describe('check: nitra-виняток через capacitor.config.json та capacitor.config.ts', () => {
  test('0 — ios/Podfile з винятком у capacitor.config.json (iosCocoaPodsAllowed)', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), {
        name: 'x',
        private: true,
        dependencies: { '@capacitor/core': '^8.0.0' }
      })
      await writeJson(join(dir, 'capacitor.config.json'), { nitra: { iosCocoaPodsAllowed: true } })
      await ensureDir(join(dir, 'ios'))
      await writeFile(join(dir, 'ios/Podfile'), "platform :ios, '15.0'\n", 'utf8')
      expect(await check(dir)).toBe(0)
    })
  })

  test('0 — ios/Podfile з винятком у capacitor.config.ts (iosCocoaPodsAllowed)', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), {
        name: 'x',
        private: true,
        dependencies: { '@capacitor/core': '^8.0.0' }
      })
      await writeFile(
        join(dir, 'capacitor.config.ts'),
        `export default { appId: "a", nitra: { iosCocoaPodsAllowed: true } }\n`,
        'utf8'
      )
      await ensureDir(join(dir, 'ios'))
      await writeFile(join(dir, 'ios/Podfile'), "platform :ios, '15.0'\n", 'utf8')
      expect(await check(dir)).toBe(0)
    })
  })
})

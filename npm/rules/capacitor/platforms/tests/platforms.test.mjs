/**
 * Тести rules/capacitor/check.mjs: `@capacitor/core`-версія, iOS/CocoaPods-виняток.
 *
 * Прогін — через `runConcernDetector` (dispatch-рівень), не пряма функція: JS
 * `main.mjs` видалений (PURE-фінал фази 5), concern тепер живе лише в
 * `crates/rules-core/src/concerns/capacitor_platforms.rs` і виконується через
 * native-гілку `runConcernDetector`. Юніт-покриття чистих функцій
 * (`capacitorSegmentMinMajor`, `capacitorVersionRangeMinMajor`,
 * `nitrAObjectAllowsIosCocoaPods`, `findFirstPodfileUnderIosExcludingPods`,
 * власного npm-semver-парсера тощо) лишається в native-тестах
 * ported-модуля.
 */
import { describe, expect, test } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { runConcernDetector } from '../../../../scripts/lib/lint-surface/detect.mjs'
import { withTmpDir, writeJson, ensureDir } from '../../../../scripts/utils/test-helpers.mjs'

/** Абсолютний шлях теки концерну (тека з `concern.json`, без main.mjs — native-порт). */
const CONCERN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const CONCERN = { dir: CONCERN_DIR }
const ruleId = 'capacitor'
const concernId = 'platforms'

/**
 * Запускає detector у каталозі й повертає exit-подібний код (0 clean / 1 violation).
 * @param {string} dir корінь репозиторію
 * @returns {Promise<0 | 1>} код сумісності зі старим контрактом
 */
async function check(dir) {
  const { violations } = await runConcernDetector(CONCERN, { cwd: dir, ruleId, concernId, files: undefined })
  return violations.length > 0 ? 1 : 0
}

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

  test('1 — capacitor.config.ts без nitra → extractNitraObjectBodySource null', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), {
        name: 'x',
        private: true,
        dependencies: { '@capacitor/core': '^8.0.0' }
      })
      await writeFile(join(dir, 'capacitor.config.ts'), 'export default { appId: "a" }\n', 'utf8')
      await ensureDir(join(dir, 'ios'))
      await writeFile(join(dir, 'ios/Podfile'), "platform :ios, '15.0'\n", 'utf8')
      expect(await check(dir)).toBe(1)
    })
  })

  test('1 — capacitor.config.ts з незакритою дужкою у nitra → extractNitraObjectBodySource null', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), {
        name: 'x',
        private: true,
        dependencies: { '@capacitor/core': '^8.0.0' }
      })
      await writeFile(
        join(dir, 'capacitor.config.ts'),
        'export default { appId: "a", nitra: { iosCocoaPodsAllowed: true\n',
        'utf8'
      )
      await ensureDir(join(dir, 'ios'))
      await writeFile(join(dir, 'ios/Podfile'), "platform :ios, '15.0'\n", 'utf8')
      expect(await check(dir)).toBe(1)
    })
  })

  test('1 — capacitor.config.json з невалідним JSON → catch → fail', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), {
        name: 'x',
        private: true,
        dependencies: { '@capacitor/core': '^8.0.0' }
      })
      await writeFile(join(dir, 'capacitor.config.json'), '{ broken json', 'utf8')
      await ensureDir(join(dir, 'ios'))
      await writeFile(join(dir, 'ios/Podfile'), "platform :ios, '15.0'\n", 'utf8')
      expect(await check(dir)).toBe(1)
    })
  })
})

/**
 * Гейт «завантажується САМЕ той аддон, що очікується в цьому оточенні» —
 * на реальному оточенні прогону, без ін'єкцій (на відміну від
 * `native.test.mjs`, який перевіряє порядок на фейкових deps).
 *
 * Клас регресії, який гейт ловить (2026-08-03): `resolveNativeAddon` брав
 * опублікований platform-підпакет із `node_modules` ПЕРЕД свіжозібраним
 * `target/release`, тож крок `cargo build -p rules-napi` у
 * `.github/workflows/test.yml` збирав аддон, якого loader не бачив — усі
 * native-тести мовчки перевіряли попередню збірку, а зелений CI нічого не
 * доводив.
 *
 * Гейт активний і локально, і в CI. Якщо локальної збірки немає:
 * - у CI — падає (крок `Build rules-napi addon` обовʼязковий, його зникнення
 *   або перейменування артефакта має бути видимим, а не тихим);
 * - локально — тест мовчки проходить із підказкою, як зібрати.
 *
 * Під Stryker-sandbox тести пропускаються: sandbox — копія дерева без
 * `crates/`/`target/`, тож гейт там перевіряв би не те дерево (test.mdc,
 * sandbox-aware-test).
 */

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process, { env, platform as osPlatform } from 'node:process'
import { fileURLToPath } from 'node:url'

import { describe, expect, test } from 'vitest'

import { EXPECTED_CONTRACT_VERSION, resolveNativeAddon } from '../native.mjs'

/** Корінь репо: npm/scripts/lib/tests → up 4 (той самий, що рахує loader). */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')

/** Маркер вихідного дерева — той самий, за яким loader обирає порядок. */
const SOURCE_MARKER = join(REPO_ROOT, 'crates', 'rules-napi', 'Cargo.toml')

/** Ім'я cdylib для платформи (дзеркало `cdylibName` у loader-і). */
const CDYLIB = { darwin: 'librules_napi.dylib', win32: 'rules_napi.dll' }[osPlatform] ?? 'librules_napi.so'

/**
 * Перший наявний артефакт локальної збірки (`cargo build -p rules-napi`,
 * release перед debug) або `null`, якщо нічого не зібрано.
 * @returns {string | null} шлях або null
 */
function localBuild() {
  for (const profile of ['release', 'debug']) {
    const p = join(REPO_ROOT, 'target', profile, CDYLIB)
    if (existsSync(p)) return p
  }
  return null
}

/**
 * Резолв аддона, що не кидає: `null`, якщо на цій машині немає ні локальної
 * збірки, ні підпакета (свіжий checkout без cargo build).
 * @returns {string | null} шлях до аддона або null
 */
function safeResolve() {
  try {
    return resolveNativeAddon()
  } catch {
    return null
  }
}

describe('гейт джерела native-аддона (реальне оточення)', () => {
  test.skipIf(env.STRYKER_MUTATOR_WORKER)(
    'тест живе у вихідному дереві — маркер crates/rules-napi/Cargo.toml на місці',
    () => {
      // Якщо це впало — REPO_ROOT порахований неправильно, і решта гейта
      // перевіряла б не те дерево (мовчазний no-op замість перевірки).
      expect(existsSync(SOURCE_MARKER)).toBe(true)
    }
  )

  test.skipIf(env.STRYKER_MUTATOR_WORKER)(
    'у вихідному дереві резолвиться локальна збірка, а не опублікований підпакет',
    () => {
      const override = env.N_RULES_NATIVE_ADDON
      if (override) {
        // Явний override — контракт №1 loader-а; гейт звіряє його, а не target/.
        expect(resolveNativeAddon()).toBe(override)
        return
      }

      const built = localBuild()
      if (built === null) {
        // У CI відсутність збірки — це поламаний крок workflow, а не «ще не збирав».
        expect(env.CI, `немає target/{release,debug}/${CDYLIB}: збери cargo build --release -p rules-napi`).toBeFalsy()
        return
      }

      expect(resolveNativeAddon()).toBe(built)
    }
  )

  test.skipIf(env.STRYKER_MUTATOR_WORKER)(
    'резолвлений аддон реально відкривається і має очікувану версію контракту',
    () => {
      const resolved = safeResolve()
      if (resolved === null) return

      const mod = { exports: {} }
      process.dlopen(mod, resolved)
      expect(mod.exports.contractVersion()).toBe(EXPECTED_CONTRACT_VERSION)
    }
  )
})

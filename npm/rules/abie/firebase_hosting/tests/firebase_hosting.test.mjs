/**
 * Тести concern-а abie/js/firebase_hosting: у підкаталогах 1-го рівня
 * (без .git/node_modules) не має бути `.firebaserc`, `firebase.json`, `.firebase/`.
 * У самому корені — не перевіряється.
 *
 * Прогін — через `runConcernDetector` (dispatch-рівень), не пряма функція: JS
 * `main.mjs` видалений (F2 фази 5 батчу 2), concern тепер живе лише в
 * `crates/rules-core/src/concerns/firebase_hosting.rs` і виконується через
 * native-гілку `runConcernDetector`.
 */
import { describe, expect, test } from 'vitest'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { runConcernDetector } from '../../../../scripts/lib/lint-surface/detect.mjs'
import { ensureDir, withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'
import { writeFile } from 'node:fs/promises'

/** Абсолютний шлях теки концерну (тека з `concern.json`, без main.mjs — native-порт). */
const CONCERN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const CONCERN = { dir: CONCERN_DIR }

// Формат ruleId/concernId — короткий (без `rules/`-префікса): `detect.mjs` матчить
// `${ruleId}/${concernId}` проти `NATIVE_CONCERNS` (`abie/firebase_hosting`), тож
// саме цей формат — не старий `'rules/abie'`, який ігнорувався прямим `lint()`.
const ruleId = 'abie'
const concernId = 'firebase_hosting'
const run = dir => runConcernDetector(CONCERN, { cwd: dir, ruleId, concernId, files: undefined })

describe('abie firebase_hosting concern', () => {
  test('порожній каталог → clean', async () => {
    await withTmpDir(async dir => {
      const result = await run(dir)
      expect(result.violations).toEqual([])
    })
  })

  test('файли тільки в корені → clean (корінь не перевіряється)', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, '.firebaserc'), '{}', 'utf8')
      await writeFile(join(dir, 'firebase.json'), '{}', 'utf8')
      await ensureDir(join(dir, '.firebase'))
      const result = await run(dir)
      expect(result.violations).toEqual([])
    })
  })

  test('.firebaserc у підкаталозі → violation', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'pkg'))
      await writeFile(join(dir, 'pkg/.firebaserc'), '{}', 'utf8')
      const result = await run(dir)
      expect(result.violations.length).toBeGreaterThan(0)
    })
  })

  test('firebase.json у підкаталозі → violation', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'pkg'))
      await writeFile(join(dir, 'pkg/firebase.json'), '{}', 'utf8')
      const result = await run(dir)
      expect(result.violations.length).toBeGreaterThan(0)
    })
  })

  test('.firebase/ директорія у підкаталозі → violation', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'pkg/.firebase'))
      const result = await run(dir)
      expect(result.violations.length).toBeGreaterThan(0)
    })
  })

  test('.git/ і node_modules/ ігноруються — артефакти всередині не призводять до violation', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, '.git'))
      await ensureDir(join(dir, 'node_modules'))
      await writeFile(join(dir, '.git/.firebaserc'), '{}', 'utf8')
      await writeFile(join(dir, 'node_modules/firebase.json'), '{}', 'utf8')
      await ensureDir(join(dir, 'node_modules/.firebase'))
      const result = await run(dir)
      expect(result.violations).toEqual([])
    })
  })

  test('файли тільки на 1-му рівні; глибші — не сканяться', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'pkg/nested'))
      await writeFile(join(dir, 'pkg/nested/firebase.json'), '{}', 'utf8')
      const result = await run(dir)
      expect(result.violations).toEqual([])
    })
  })

  test('кілька підкаталогів — один з артефактом → violation', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'pkg-a'))
      await ensureDir(join(dir, 'pkg-b'))
      await writeFile(join(dir, 'pkg-b/.firebaserc'), '{}', 'utf8')
      const result = await run(dir)
      expect(result.violations.length).toBeGreaterThan(0)
    })
  })

  test('readdir на неіснуючому шляху → violation (помилка читання)', async () => {
    const fakePath = join('/no-such-path', `n-rules-test-${Date.now()}`)
    const result = await run(fakePath)
    expect(result.violations.length).toBeGreaterThan(0)
  })
})

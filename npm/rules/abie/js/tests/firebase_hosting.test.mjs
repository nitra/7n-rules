/**
 * Тести concern-а abie/js/firebase_hosting: у підкаталогах 1-го рівня
 * (без .git/node_modules) не має бути `.firebaserc`, `firebase.json`, `.firebase/`.
 * У самому корені — не перевіряється.
 */
import { describe, expect, test } from 'vitest'
import { join } from 'node:path'

import { check } from '../firebase_hosting.mjs'
import { ensureDir, withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'
import { writeFile } from 'node:fs/promises'

describe('abie firebase_hosting concern', () => {
  test('порожній каталог → 0 (pass)', async () => {
    await withTmpDir(async dir => {
      expect(await check(dir)).toBe(0)
    })
  })

  test('файли тільки в корені → 0 (корінь не перевіряється)', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, '.firebaserc'), '{}', 'utf8')
      await writeFile(join(dir, 'firebase.json'), '{}', 'utf8')
      await ensureDir(join(dir, '.firebase'))
      expect(await check(dir)).toBe(0)
    })
  })

  test('.firebaserc у підкаталозі → 1 (fail)', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'pkg'))
      await writeFile(join(dir, 'pkg/.firebaserc'), '{}', 'utf8')
      expect(await check(dir)).toBe(1)
    })
  })

  test('firebase.json у підкаталозі → 1 (fail)', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'pkg'))
      await writeFile(join(dir, 'pkg/firebase.json'), '{}', 'utf8')
      expect(await check(dir)).toBe(1)
    })
  })

  test('.firebase/ директорія у підкаталозі → 1 (fail)', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'pkg/.firebase'))
      expect(await check(dir)).toBe(1)
    })
  })

  test('.git/ і node_modules/ ігноруються — артефакти всередині не призводять до fail', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, '.git'))
      await ensureDir(join(dir, 'node_modules'))
      await writeFile(join(dir, '.git/.firebaserc'), '{}', 'utf8')
      await writeFile(join(dir, 'node_modules/firebase.json'), '{}', 'utf8')
      await ensureDir(join(dir, 'node_modules/.firebase'))
      expect(await check(dir)).toBe(0)
    })
  })

  test('файли тільки на 1-му рівні; глибші — не сканяться', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'pkg/nested'))
      await writeFile(join(dir, 'pkg/nested/firebase.json'), '{}', 'utf8')
      expect(await check(dir)).toBe(0)
    })
  })

  test('кілька підкаталогів — один з артефактом → 1', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'pkg-a'))
      await ensureDir(join(dir, 'pkg-b'))
      await writeFile(join(dir, 'pkg-b/.firebaserc'), '{}', 'utf8')
      expect(await check(dir)).toBe(1)
    })
  })

  test('readdir на неіснуючому шляху → 1 (fail з повідомленням про помилку)', async () => {
    const fakePath = join('/no-such-path', `n-cursor-test-${Date.now()}`)
    expect(await check(fakePath)).toBe(1)
  })
})

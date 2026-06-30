/**
 * Тести concern-а abie/js/firebase_hosting: у підкаталогах 1-го рівня
 * (без .git/node_modules) не має бути `.firebaserc`, `firebase.json`, `.firebase/`.
 * У самому корені — не перевіряється.
 */
import { describe, expect, test } from 'vitest'
import { join } from 'node:path'

import { lint } from '../main.mjs'
import { ensureDir, withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'
import { writeFile } from 'node:fs/promises'

const ruleId = 'rules/abie'
const concernId = 'rules/abie/firebase_hosting'
const run = dir => lint({ cwd: dir, ruleId, concernId, files: undefined })

describe('abie firebase_hosting concern', () => {
  test('порожній каталог → clean', async () => {
    await withTmpDir(async dir => {
      expect((await run(dir)).violations).toEqual([])
    })
  })

  test('файли тільки в корені → clean (корінь не перевіряється)', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, '.firebaserc'), '{}', 'utf8')
      await writeFile(join(dir, 'firebase.json'), '{}', 'utf8')
      await ensureDir(join(dir, '.firebase'))
      expect((await run(dir)).violations).toEqual([])
    })
  })

  test('.firebaserc у підкаталозі → violation', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'pkg'))
      await writeFile(join(dir, 'pkg/.firebaserc'), '{}', 'utf8')
      expect((await run(dir)).violations.length).toBeGreaterThan(0)
    })
  })

  test('firebase.json у підкаталозі → violation', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'pkg'))
      await writeFile(join(dir, 'pkg/firebase.json'), '{}', 'utf8')
      expect((await run(dir)).violations.length).toBeGreaterThan(0)
    })
  })

  test('.firebase/ директорія у підкаталозі → violation', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'pkg/.firebase'))
      expect((await run(dir)).violations.length).toBeGreaterThan(0)
    })
  })

  test('.git/ і node_modules/ ігноруються — артефакти всередині не призводять до violation', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, '.git'))
      await ensureDir(join(dir, 'node_modules'))
      await writeFile(join(dir, '.git/.firebaserc'), '{}', 'utf8')
      await writeFile(join(dir, 'node_modules/firebase.json'), '{}', 'utf8')
      await ensureDir(join(dir, 'node_modules/.firebase'))
      expect((await run(dir)).violations).toEqual([])
    })
  })

  test('файли тільки на 1-му рівні; глибші — не сканяться', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'pkg/nested'))
      await writeFile(join(dir, 'pkg/nested/firebase.json'), '{}', 'utf8')
      expect((await run(dir)).violations).toEqual([])
    })
  })

  test('кілька підкаталогів — один з артефактом → violation', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'pkg-a'))
      await ensureDir(join(dir, 'pkg-b'))
      await writeFile(join(dir, 'pkg-b/.firebaserc'), '{}', 'utf8')
      expect((await run(dir)).violations.length).toBeGreaterThan(0)
    })
  })

  test('readdir на неіснуючому шляху → violation (помилка читання)', async () => {
    const fakePath = join('/no-such-path', `n-cursor-test-${Date.now()}`)
    expect((await run(fakePath)).violations.length).toBeGreaterThan(0)
  })
})

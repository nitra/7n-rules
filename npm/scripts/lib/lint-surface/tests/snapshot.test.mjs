/**
 * Тести central pre-image snapshot/rollback: класичний rollback-контракт і
 * durable-write семантика (issue nitra/cursor#16 — rollback після fix-timeout
 * стирав уже згенеровані doc-files доки; durable-файли мають переживати rollback).
 */
import { describe, expect, test } from 'vitest'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { createSnapshot } from '../snapshot.mjs'
import { withTmpDir } from '../../../utils/test-helpers.mjs'

describe('createSnapshot — класичний rollback-контракт', () => {
  test('record(ABSENT) → rollback видаляє створений файл; record(наявний) → відновлює pre-image', async () => {
    await withTmpDir(async dir => {
      const existing = join(dir, 'existing.txt')
      await writeFile(existing, 'original', 'utf8')
      const fresh = join(dir, 'fresh.txt')

      const snapshot = createSnapshot()
      snapshot.record(existing)
      snapshot.record(fresh)
      writeFileSync(existing, 'mutated')
      writeFileSync(fresh, 'created')

      snapshot.rollback()
      expect(readFileSync(existing, 'utf8')).toBe('original')
      expect(existsSync(fresh)).toBe(false)
    })
  })

  test('modifiedExisting: лише наявні на S1 і реально змінені файли', async () => {
    await withTmpDir(async dir => {
      const touchedFile = join(dir, 'a.txt')
      const untouched = join(dir, 'b.txt')
      await writeFile(touchedFile, 'a', 'utf8')
      await writeFile(untouched, 'b', 'utf8')
      const fresh = join(dir, 'new.txt')

      const snapshot = createSnapshot()
      for (const p of [touchedFile, untouched, fresh]) snapshot.record(p)
      writeFileSync(touchedFile, 'a2')
      writeFileSync(fresh, 'x')

      expect(snapshot.modifiedExisting()).toEqual([touchedFile])
    })
  })
})

describe('createSnapshot — durable-write семантика (issue #16)', () => {
  test('репро: durable-доки, записані до таймауту, переживають rollback; прогрес не стирається', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'docs'), { recursive: true })
      const docs = ['a.md', 'b.md', 'c.md', 'd.md', 'e.md'].map(f => join(dir, 'docs', f))

      const snapshot = createSnapshot()
      // Як doc-files fix-worker: durable-реєстрація ВСІЄЇ doc-черги до генерації.
      for (const d of docs) snapshot.recordDurable(d)
      // Встигли записати 2 з 5 до backstop-таймауту.
      for (const d of docs.slice(0, 2)) writeFileSync(d, '# готова дока\n')

      // … fix timeout → re-detect не clean → rollback
      snapshot.rollback()
      expect(docs.map(d => existsSync(d))).toEqual([true, true, false, false, false])
    })
  })

  test('durable поверх record: pre-image знято, але rollback шлях не чіпає', async () => {
    await withTmpDir(async dir => {
      const doc = join(dir, 'doc.md')
      await writeFile(doc, 'стара дока', 'utf8')

      const snapshot = createSnapshot()
      snapshot.record(doc)
      snapshot.recordDurable(doc)
      writeFileSync(doc, 'свіжа дока з новим CRC')

      snapshot.rollback()
      expect(readFileSync(doc, 'utf8')).toBe('свіжа дока з новим CRC')
      // Durable-файл — оголошений цільовий артефакт, не collateral.
      expect(snapshot.modifiedExisting()).toEqual([])
      expect(snapshot.touched()).toContain(doc)
    })
  })

  test('durable не вимикає rollback для сусідніх не-durable записів', async () => {
    await withTmpDir(async dir => {
      const durableDoc = join(dir, 'doc.md')
      const collateral = join(dir, 'App.vue')
      await writeFile(collateral, 'original', 'utf8')

      const snapshot = createSnapshot()
      snapshot.recordDurable(durableDoc)
      snapshot.record(collateral)
      writeFileSync(durableDoc, 'дока')
      writeFileSync(collateral, 'hardcoded')

      snapshot.rollback()
      expect(existsSync(durableDoc)).toBe(true)
      expect(readFileSync(collateral, 'utf8')).toBe('original')
    })
  })
})

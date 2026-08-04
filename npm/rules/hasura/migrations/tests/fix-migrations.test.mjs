/**
 * Тести T0-фіксу `hasura/migrations`: видалення заборонених `down.sql`.
 *
 * `lint()`-виклики для before/after-стану — через `runConcernDetector`
 * (dispatch-рівень): JS `main.mjs` видалений (F2 фази 5 батчу 2), детектор
 * тепер живе лише в `crates/rules-core/src/concerns/hasura_migrations.rs`.
 *
 * T0-фікс (T1 зрізу 4 фази 7): JS `fix-migrations.mjs` теж видалений — логіка
 * видалення `down.sql` тепер у `crates/rules-core/src/concerns/fix.rs`
 * (`run_concern_fix`), а JS-бік отримує синтетичний T0Pattern через
 * `loadT0Patterns` (`run-fix.mjs`, реєстр `NATIVE_FIXES`). Тести нижче
 * дзеркалять старі кейси через ЦЮ обгортку, не пряму функцію concern-а.
 */
import { describe, expect, test, vi } from 'vitest'
import { existsSync } from 'node:fs'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { runConcernDetector } from '../../../../scripts/lib/lint-surface/detect.mjs'
import { loadT0Patterns } from '../../../../scripts/lib/lint-surface/run-fix.mjs'
import { createSnapshot } from '../../../../scripts/lib/lint-surface/snapshot.mjs'
import { withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'

/** Абсолютний шлях теки концерну (тека з `concern.json`, без main.mjs/fix-*.mjs — native-порт). */
const CONCERN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const CONCERN = { dir: CONCERN_DIR }

const ruleId = 'hasura'
const concernId = 'migrations'
const ctxFor = dir => ({ cwd: dir, ruleId, concernId, files: undefined })
const lint = ctx => runConcernDetector(CONCERN, ctx)
/**
 * Резолвить синтетичний T0Pattern для `dir` (той самий, що бере реальний fix-pipeline).
 * @param {string} dir тимчасова тека-репо тесту.
 * @returns {Promise<import('../../../../scripts/lib/lint-surface/run-fix.mjs').T0Pattern[]>} патерни концерну.
 */
const patternsFor = dir => loadT0Patterns(CONCERN_DIR, concernId, ruleId, dir)

const exists = async p => {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

describe('native-fix hasura/migrations (обгортка над T0Pattern)', () => {
  test('loadT0Patterns повертає синтетичний native-fix pattern', async () => {
    await withTmpDir(async dir => {
      const patterns = await patternsFor(dir)
      expect(patterns).toHaveLength(1)
      expect(patterns[0].id).toBe(`native-fix:${ruleId}/${concernId}`)
    })
  })

  test('test: true за наявності down-sql-forbidden, false інакше', async () => {
    await withTmpDir(async dir => {
      const [pattern] = await patternsFor(dir)
      expect(pattern.test([{ reason: 'down-sql-forbidden', message: 'm', file: 'x' }])).toBe(true)
      expect(pattern.test([])).toBe(false)
      expect(pattern.test([{ reason: 'other', message: 'm' }])).toBe(false)
    })
  })

  test('apply: видаляє down.sql, залишає up.sql', async () => {
    await withTmpDir(async dir => {
      const migDir = join(dir, 'hasura/migrations/default/1000_add_foo')
      await mkdir(migDir, { recursive: true })
      await writeFile(join(migDir, 'up.sql'), '-- up\n')
      await writeFile(join(migDir, 'down.sql'), '-- down\n')

      const { violations: before } = await lint(ctxFor(dir))
      expect(before.length).toBe(1)

      const [pattern] = await patternsFor(dir)
      const res = await pattern.apply(before, { ...ctxFor(dir), recordWrite: vi.fn() })
      expect(res.touchedFiles).toHaveLength(1)
      // touchedFiles — абсолютні шляхи (доккомент `nativeFixPattern`, `run-fix.mjs`).
      expect(res.touchedFiles[0]).toBe(join(migDir, 'down.sql'))

      expect(await exists(join(migDir, 'down.sql'))).toBe(false)
      expect(await exists(join(migDir, 'up.sql'))).toBe(true)

      const { violations: after } = await lint(ctxFor(dir))
      expect(after).toEqual([])
    })
  })

  test('apply: no-op, якщо порушень немає', async () => {
    await withTmpDir(async dir => {
      const [pattern] = await patternsFor(dir)
      const res = await pattern.apply([], { ...ctxFor(dir), recordWrite: vi.fn() })
      expect(res.touchedFiles).toEqual([])
    })
  })

  test('rollback-контракт: ctx.recordWrite викликається ДО видалення — rollback відновлює вміст down.sql', async () => {
    await withTmpDir(async dir => {
      const migDir = join(dir, 'hasura/migrations/default/1000_add_foo')
      await mkdir(migDir, { recursive: true })
      const downPath = join(migDir, 'down.sql')
      await writeFile(downPath, '-- down original\n')

      const snapshot = createSnapshot()
      const [pattern] = await patternsFor(dir)
      const violations = [
        { reason: 'down-sql-forbidden', message: 'm', file: 'hasura/migrations/default/1000_add_foo/down.sql' }
      ]

      let existedAtRecordWriteTime = null
      const ctx = {
        ...ctxFor(dir),
        recordWrite: absPath => {
          // recordWrite ДО unlink: у момент виклику файл ще існує з
          // ОРИГІНАЛЬНИМ вмістом — інакше знята pre-image була б ABSENT, і
          // rollback не зміг би відновити видалений down.sql.
          existedAtRecordWriteTime = existsSync(absPath)
          snapshot.record(absPath)
        }
      }
      await pattern.apply(violations, ctx)
      expect(existedAtRecordWriteTime).toBe(true)
      expect(await exists(downPath)).toBe(false)

      snapshot.rollback()
      expect(await exists(downPath)).toBe(true)
      expect(await readFile(downPath, 'utf8')).toBe('-- down original\n')
    })
  })
})

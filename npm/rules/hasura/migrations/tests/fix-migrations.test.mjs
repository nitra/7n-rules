/**
 * Тести T0-фіксера `fix-migrations.mjs`: видалення заборонених `down.sql`.
 *
 * `lint()`-виклики для before/after-стану — через `runConcernDetector`
 * (dispatch-рівень): JS `main.mjs` видалений (F2 фази 5 батчу 2), детектор
 * тепер живе лише в `crates/rules-core/src/concerns/hasura_migrations.rs`.
 * Сам T0-фіксер (`fix-migrations.mjs`) лишається JS і не імпортує з main.mjs —
 * матчиться по формі violation (`reason === 'down-sql-forbidden'`), тож
 * незалежний від того, native чи JS породив ці violations.
 */
import { describe, expect, test } from 'vitest'
import { access, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { runConcernDetector } from '../../../../scripts/lib/lint-surface/detect.mjs'
import { patterns } from '../fix-migrations.mjs'
import { withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'

/** Абсолютний шлях теки концерну (тека з `concern.json`, без main.mjs — native-порт). */
const CONCERN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const CONCERN = { dir: CONCERN_DIR }

const P = patterns[0]
const ctxFor = dir => ({ cwd: dir, ruleId: 'hasura', concernId: 'migrations', files: undefined })
const lint = ctx => runConcernDetector(CONCERN, ctx)

const exists = async p => {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

describe('hasura-migrations-remove-down-sql pattern', () => {
  test('test: true за наявності down-sql-forbidden, false інакше', () => {
    expect(P.test([{ reason: 'down-sql-forbidden', message: 'm', file: 'x' }])).toBe(true)
    expect(P.test([])).toBe(false)
    expect(P.test([{ reason: 'other', message: 'm' }])).toBe(false)
  })

  test('apply: видаляє down.sql, залишає up.sql', async () => {
    await withTmpDir(async dir => {
      const migDir = join(dir, 'hasura/migrations/default/1000_add_foo')
      await mkdir(migDir, { recursive: true })
      await writeFile(join(migDir, 'up.sql'), '-- up\n')
      await writeFile(join(migDir, 'down.sql'), '-- down\n')

      const { violations: before } = await lint(ctxFor(dir))
      expect(before.length).toBe(1)

      const res = await P.apply(before, ctxFor(dir))
      expect(res.touchedFiles).toHaveLength(1)

      expect(await exists(join(migDir, 'down.sql'))).toBe(false)
      expect(await exists(join(migDir, 'up.sql'))).toBe(true)

      const { violations: after } = await lint(ctxFor(dir))
      expect(after).toEqual([])
    })
  })

  test('apply: no-op, якщо порушень немає', async () => {
    await withTmpDir(async dir => {
      const res = await P.apply([], ctxFor(dir))
      expect(res.touchedFiles).toEqual([])
    })
  })
})

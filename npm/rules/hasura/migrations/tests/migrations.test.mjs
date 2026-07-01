/**
 * Тести правила hasura.mdc (concern migrations): перевірка відсутності `down.sql`
 * у директоріях міграцій `hasura/migrations/`.
 */
import { describe, expect, test } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { lint } from '../main.mjs'
import { withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'

const check = async dir => {
  const r = await lint({ cwd: dir, ruleId: 'hasura', concernId: 'migrations', files: undefined })
  return r.violations
}

describe('check hasura.migrations', () => {
  test('успіх: hasura/migrations/ відсутній → exit 0', async () => {
    await withTmpDir(async dir => {
      expect(await check(dir)).toEqual([])
    })
  })

  test('успіх: є лише up.sql → exit 0', async () => {
    await withTmpDir(async dir => {
      const migDir = join(dir, 'hasura/migrations/default/1000_add_foo')
      await mkdir(migDir, { recursive: true })
      await writeFile(join(migDir, 'up.sql'), 'CREATE TABLE foo (id INT);\n')
      expect(await check(dir)).toEqual([])
    })
  })

  test('порушення: down.sql у директорії міграції → exit 1', async () => {
    await withTmpDir(async dir => {
      const migDir = join(dir, 'hasura/migrations/default/1000_add_foo')
      await mkdir(migDir, { recursive: true })
      await writeFile(join(migDir, 'up.sql'), 'CREATE TABLE foo (id INT);\n')
      await writeFile(join(migDir, 'down.sql'), 'DROP TABLE foo;\n')
      expect((await check(dir)).length).toBeGreaterThan(0)
    })
  })

  test('порушення: кілька down.sql у різних міграціях — усі репортуються', async () => {
    await withTmpDir(async dir => {
      for (const name of ['1000_add_foo', '2000_add_bar']) {
        const d = join(dir, 'hasura/migrations/default', name)
        await mkdir(d, { recursive: true })
        await writeFile(join(d, 'up.sql'), '-- up\n')
        await writeFile(join(d, 'down.sql'), '-- down\n')
      }
      expect((await check(dir)).length).toBe(2)
    })
  })

  test('порушення: down.sql у вкладеній директорії → exit 1', async () => {
    await withTmpDir(async dir => {
      const deep = join(dir, 'hasura/migrations/other_db/1234_nested/sub')
      await mkdir(deep, { recursive: true })
      await writeFile(join(deep, 'down.sql'), '-- down\n')
      expect((await check(dir)).length).toBeGreaterThan(0)
    })
  })

  test('успіх: файл з іменем down.sql.bak поза межами правила → exit 0', async () => {
    await withTmpDir(async dir => {
      const migDir = join(dir, 'hasura/migrations/default/1000_add_foo')
      await mkdir(migDir, { recursive: true })
      await writeFile(join(migDir, 'up.sql'), '-- up\n')
      await writeFile(join(migDir, 'down.sql.bak'), '-- bak\n')
      expect(await check(dir)).toEqual([])
    })
  })

  test('успіх: down.sql поза hasura/migrations/ не сканується → exit 0', async () => {
    await withTmpDir(async dir => {
      const other = join(dir, 'some/other/dir')
      await mkdir(join(dir, 'hasura/migrations/default/1_foo'), { recursive: true })
      await writeFile(join(dir, 'hasura/migrations/default/1_foo/up.sql'), '-- up\n')
      await mkdir(other, { recursive: true })
      await writeFile(join(other, 'down.sql'), '-- irrelevant\n')
      expect(await check(dir)).toEqual([])
    })
  })
})

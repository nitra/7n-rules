/**
 * Тести check-js-bun-db в ізольованих тимчасових каталогах.
 */
import { describe, expect, test } from 'bun:test'
import { writeFile } from 'node:fs/promises'

import { check } from '../scripts/check-js-bun-db.mjs'
import { ensureDir, withTmpCwd, writeJson } from './helpers.mjs'

describe('check-js-bun-db', () => {
  test('пропускає, якщо немає кореневого package.json', async () => {
    await withTmpCwd(async () => {
      expect(await check()).toBe(0)
    })
  })

  test('успіх: чистий package.json без pg/mysql2 та без Bun SQL у коді', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', { name: 't' })
      await ensureDir('src')
      await writeFile('src/app.js', 'export const x = 1\n', 'utf8')
      expect(await check()).toBe(0)
    })
  })

  test('помилка: dependencies.pg у кореневому package.json', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', {
        name: 't',
        dependencies: { pg: '^8.13.0' }
      })
      expect(await check()).toBe(1)
    })
  })

  test('помилка: dependencies.mysql2 у workspace-пакеті', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', {
        name: 'mono',
        private: true,
        workspaces: ['apps/*']
      })
      await ensureDir('apps/api')
      await writeJson('apps/api/package.json', {
        name: 'api',
        dependencies: { mysql2: '^3.10.0' }
      })
      expect(await check()).toBe(1)
    })
  })

  test('успіх: Bun SQL використовується безпечно (singleton + tagged template)', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', { name: 't' })
      await ensureDir('src')
      await writeFile(
        'src/db.ts',
        [
          "import { SQL, sql } from 'bun'",
          'export const db = new SQL(process.env.DATABASE_URL)',
          'export async function getUser(id: number) {',
          '  return sql`SELECT * FROM users WHERE id = ${id}`',
          '}',
          ''
        ].join('\n'),
        'utf8'
      )
      expect(await check()).toBe(0)
    })
  })

  test('помилка: new SQL(...) всередині функції', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', { name: 't' })
      await ensureDir('src')
      await writeFile(
        'src/db.ts',
        [
          "import { SQL } from 'bun'",
          'export function getUser(id: number) {',
          '  const db = new SQL(process.env.DATABASE_URL)',
          '  return db`SELECT * FROM users WHERE id = ${id}`',
          '}',
          ''
        ].join('\n'),
        'utf8'
      )
      expect(await check()).toBe(1)
    })
  })

  test('помилка: sql.unsafe з інтерпольованим TemplateLiteral', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', { name: 't' })
      await ensureDir('src')
      await writeFile(
        'src/db.ts',
        [
          "import { sql } from 'bun'",
          'export async function find(id: number) {',
          '  return sql.unsafe(`SELECT * FROM users WHERE id = ${id}`)',
          '}',
          ''
        ].join('\n'),
        'utf8'
      )
      expect(await check()).toBe(1)
    })
  })

  test('успіх: sql.unsafe зі статичним рядком і параметрами', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', { name: 't' })
      await ensureDir('src')
      await writeFile(
        'src/db.ts',
        [
          "import { sql } from 'bun'",
          "export const ping = () => sql.unsafe('SELECT 1')",
          ''
        ].join('\n'),
        'utf8'
      )
      expect(await check()).toBe(0)
    })
  })

  test("помилка: динамічний список через .join(',') у IN(...)", async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', { name: 't' })
      await ensureDir('src')
      await writeFile(
        'src/db.ts',
        [
          "import { sql } from 'bun'",
          'export async function findMany(ids: number[]) {',
          "  return sql`SELECT * FROM users WHERE id IN (${ids.join(',')})`",
          '}',
          ''
        ].join('\n'),
        'utf8'
      )
      expect(await check()).toBe(1)
    })
  })
})

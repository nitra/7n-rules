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

  test('помилка: dependencies.pg-format у кореневому package.json', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', {
        name: 't',
        dependencies: { 'pg-format': '^1.0.4' }
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
        `import { SQL, sql } from 'bun'
export const db = new SQL(process.env.DATABASE_URL)
export async function getUser(id: number) {
  return sql\`SELECT * FROM users WHERE id = \${id}\`
}
`,
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
        `import { SQL } from 'bun'
export function getUser(id: number) {
  const db = new SQL(process.env.DATABASE_URL)
  return db\`SELECT * FROM users WHERE id = \${id}\`
}
`,
        'utf8'
      )
      expect(await check()).toBe(1)
    })
  })

  test('помилка: sql.unsafe без маркера allow-unsafe (інтерпольований TemplateLiteral)', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', { name: 't' })
      await ensureDir('src')
      await writeFile(
        'src/db.ts',
        `import { sql } from 'bun'
export async function find(id: number) {
  return sql.unsafe(\`SELECT * FROM users WHERE id = \${id}\`)
}
`,
        'utf8'
      )
      expect(await check()).toBe(1)
    })
  })

  test('помилка: sql.unsafe без маркера allow-unsafe (навіть статичний рядок)', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', { name: 't' })
      await ensureDir('src')
      await writeFile(
        'src/db.ts',
        `import { sql } from 'bun'
export const ping = () => sql.unsafe('SELECT 1')
`,
        'utf8'
      )
      expect(await check()).toBe(1)
    })
  })

  test('успіх: sql.unsafe з маркером allow-unsafe на тому ж рядку', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', { name: 't' })
      await ensureDir('src')
      await writeFile(
        'src/db.ts',
        `import { sql } from 'bun'
export const ping = () => sql.unsafe('SELECT 1') // allow-unsafe: ping — не tagged template
`,
        'utf8'
      )
      expect(await check()).toBe(0)
    })
  })

  test('успіх: sql.unsafe з маркером allow-unsafe на попередньому рядку (DDL)', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', { name: 't' })
      await ensureDir('src')
      await writeFile(
        'src/db.ts',
        `import { sql } from 'bun'
const TABLE = 'users_2026'
export async function migrate() {
  // allow-unsafe: DDL — назву таблиці параметризувати не можна
  return sql.unsafe(\`CREATE TABLE \${TABLE} (id int)\`)
}
`,
        'utf8'
      )
      expect(await check()).toBe(0)
    })
  })

  test('помилка: маркер allow-unsafe без причини', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', { name: 't' })
      await ensureDir('src')
      await writeFile(
        'src/db.ts',
        `import { sql } from 'bun'
export const ping = () => sql.unsafe('SELECT 1') // allow-unsafe:
`,
        'utf8'
      )
      expect(await check()).toBe(1)
    })
  })

  test('помилка: pool.connect() без маркера у файлі з Bun SQL', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', { name: 't' })
      await ensureDir('src')
      await writeFile(
        'src/db.ts',
        `import { sql } from 'bun'
declare const pool: { connect(): Promise<void> }
export async function getOne() {
  await pool.connect()
  return sql\`SELECT 1\`
}
`,
        'utf8'
      )
      expect(await check()).toBe(1)
    })
  })

  test('помилка: client.end() без маркера у файлі з Bun SQL', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', { name: 't' })
      await ensureDir('src')
      await writeFile(
        'src/shutdown.ts',
        `import { sql } from 'bun'
declare const client: { end(): Promise<void> }
export const close = () => client.end()
export const ping = () => sql\`SELECT 1\`
`,
        'utf8'
      )
      expect(await check()).toBe(1)
    })
  })

  test('успіх: sql.end() у graceful shutdown з маркером allow-pg-leftover', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', { name: 't' })
      await ensureDir('src')
      await writeFile(
        'src/shutdown.ts',
        `import { sql } from 'bun'
export async function shutdown() {
  // allow-pg-leftover: graceful shutdown — закриваємо пул перед exit
  await sql.end()
}
`,
        'utf8'
      )
      expect(await check()).toBe(0)
    })
  })

  test('успіх: .connect() з trailing-маркером allow-pg-leftover (WebSocket)', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', { name: 't' })
      await ensureDir('src')
      await writeFile(
        'src/ws.ts',
        `import { sql } from 'bun'
declare const ws: { connect(url: string): void }
export async function boot(url: string) {
  ws.connect(url) // allow-pg-leftover: WebSocket, не pg
  return sql\`SELECT 1\`
}
`,
        'utf8'
      )
      expect(await check()).toBe(0)
    })
  })

  test('успіх: .end() у не-Bun-SQL файлі не флагається', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', { name: 't' })
      await ensureDir('src')
      await writeFile(
        'src/stream.ts',
        `declare const stream: { end(): void }
export const stop = () => stream.end()
`,
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
        `import { sql } from 'bun'
export async function findMany(ids: number[]) {
  return sql\`SELECT * FROM users WHERE id IN (\${ids.join(',')})\`
}
`,
        'utf8'
      )
      expect(await check()).toBe(1)
    })
  })
})

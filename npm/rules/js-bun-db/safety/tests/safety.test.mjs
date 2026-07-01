/**
 * Тести check-js-bun-db в ізольованих тимчасових каталогах.
 */
import { describe, expect, test } from 'vitest'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'

import { lint } from '../main.mjs'
import { ensureDir, withTmpDir, writeJson } from '../../../../scripts/utils/test-helpers.mjs'

/**
 * Запускає detector у whole-repo режимі і повертає кількість порушень.
 * @param {string} dir корінь тимчасового проєкту
 * @returns {Promise<number>} кількість LintViolation
 */
const check = async dir => {
  const { violations } = await lint({ cwd: dir, ruleId: 'js-bun-db', concernId: 'safety', files: undefined })
  return violations.length
}

describe('check-js-bun-db', () => {
  test('пропускає, якщо немає кореневого package.json', async () => {
    await withTmpDir(async dir => {
      expect(await check(dir)).toBe(0)
    })
  })

  test('успіх: чистий package.json без pg/mysql2 та без Bun SQL у коді', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 't' })
      await ensureDir(join(dir, 'src'))
      await writeFile(join(dir, 'src/app.js'), 'export const x = 1\n', 'utf8')
      expect(await check(dir)).toBe(0)
    })
  })

  // Перевірки `dependencies.{pg, pg-format, mysql2}` тепер у Rego-полісі
  // `npm/policy/js_bun_db/package_json/`; тестуються через conftest, не тут.

  test('успіх: Bun SQL використовується безпечно (singleton + tagged template)', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 't' })
      await ensureDir(join(dir, 'src'))
      await writeFile(
        join(dir, 'src/db.ts'),
        `import { SQL, sql } from 'bun'
export const db = new SQL(process.env.DATABASE_URL)
export async function getUser(id: number) {
  return sql\`SELECT * FROM users WHERE id = \${id}\`
}
`,
        'utf8'
      )
      expect(await check(dir)).toBe(0)
    })
  })

  test('помилка: new SQL(...) всередині функції', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 't' })
      await ensureDir(join(dir, 'src'))
      await writeFile(
        join(dir, 'src/db.ts'),
        `import { SQL } from 'bun'
export function getUser(id: number) {
  const db = new SQL(process.env.DATABASE_URL)
  return db\`SELECT * FROM users WHERE id = \${id}\`
}
`,
        'utf8'
      )
      expect(await check(dir)).toBeGreaterThan(0)
    })
  })

  test('помилка: sql.unsafe без маркера allow-unsafe (інтерпольований TemplateLiteral)', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 't' })
      await ensureDir(join(dir, 'src'))
      await writeFile(
        join(dir, 'src/db.ts'),
        `import { sql } from 'bun'
export async function find(id: number) {
  return sql.unsafe(\`SELECT * FROM users WHERE id = \${id}\`)
}
`,
        'utf8'
      )
      expect(await check(dir)).toBeGreaterThan(0)
    })
  })

  test('помилка: sql.unsafe без маркера allow-unsafe (навіть статичний рядок)', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 't' })
      await ensureDir(join(dir, 'src'))
      await writeFile(
        join(dir, 'src/db.ts'),
        `import { sql } from 'bun'
export const ping = () => sql.unsafe('SELECT 1')
`,
        'utf8'
      )
      expect(await check(dir)).toBeGreaterThan(0)
    })
  })

  test('успіх: sql.unsafe з маркером allow-unsafe на тому ж рядку', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 't' })
      await ensureDir(join(dir, 'src'))
      await writeFile(
        join(dir, 'src/db.ts'),
        `import { sql } from 'bun'
export const ping = () => sql.unsafe('SELECT 1') // allow-unsafe: ping — не tagged template
`,
        'utf8'
      )
      expect(await check(dir)).toBe(0)
    })
  })

  test('успіх: sql.unsafe з маркером allow-unsafe + @scaleleap/pg-format для DDL identifier', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 't' })
      await ensureDir(join(dir, 'src'))
      await writeFile(
        join(dir, 'src/db.ts'),
        `import { sql } from 'bun'
import format from '@scaleleap/pg-format'
const TABLE = 'users_2026'
export async function migrate() {
  const query = format('CREATE TABLE %I (id int)', TABLE)
  // allow-unsafe: DDL — назву таблиці параметризувати не можна; ідентифікатор екранує pg-format
  return sql.unsafe(query)
}
`,
        'utf8'
      )
      expect(await check(dir)).toBe(0)
    })
  })

  test('помилка: sql.unsafe з template-літералом і інтерполяцією навіть з allow-unsafe маркером', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 't' })
      await ensureDir(join(dir, 'src'))
      await writeFile(
        join(dir, 'src/db.ts'),
        `import { sql } from 'bun'
const TABLE = 'users_2026'
export async function migrate() {
  // allow-unsafe: DDL — назву таблиці параметризувати не можна
  return sql.unsafe(\`CREATE TABLE \${TABLE} (id int)\`)
}
`,
        'utf8'
      )
      expect(await check(dir)).toBeGreaterThan(0)
    })
  })

  test('успіх: sql.unsafe з template-літералом БЕЗ інтерполяції (статичний DDL)', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 't' })
      await ensureDir(join(dir, 'src'))
      await writeFile(
        join(dir, 'src/db.ts'),
        `import { sql } from 'bun'
export const init = () => sql.unsafe(\`CREATE TABLE users (id int)\`) // allow-unsafe: статичний DDL
`,
        'utf8'
      )
      expect(await check(dir)).toBe(0)
    })
  })

  test('помилка: маркер allow-unsafe без причини', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 't' })
      await ensureDir(join(dir, 'src'))
      await writeFile(
        join(dir, 'src/db.ts'),
        `import { sql } from 'bun'
export const ping = () => sql.unsafe('SELECT 1') // allow-unsafe:
`,
        'utf8'
      )
      expect(await check(dir)).toBeGreaterThan(0)
    })
  })

  test('помилка: pool.connect() без маркера у файлі з Bun SQL', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 't' })
      await ensureDir(join(dir, 'src'))
      await writeFile(
        join(dir, 'src/db.ts'),
        `import { sql } from 'bun'
declare const pool: { connect(): Promise<void> }
export async function getOne() {
  await pool.connect()
  return sql\`SELECT 1\`
}
`,
        'utf8'
      )
      expect(await check(dir)).toBeGreaterThan(0)
    })
  })

  test('помилка: client.end() без маркера у файлі з Bun SQL', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 't' })
      await ensureDir(join(dir, 'src'))
      await writeFile(
        join(dir, 'src/shutdown.ts'),
        `import { sql } from 'bun'
declare const client: { end(): Promise<void> }
export const close = () => client.end()
export const ping = () => sql\`SELECT 1\`
`,
        'utf8'
      )
      expect(await check(dir)).toBeGreaterThan(0)
    })
  })

  test('успіх: sql.end() у graceful shutdown з маркером allow-pg-leftover', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 't' })
      await ensureDir(join(dir, 'src'))
      await writeFile(
        join(dir, 'src/shutdown.ts'),
        `import { sql } from 'bun'
export async function shutdown() {
  // allow-pg-leftover: graceful shutdown — закриваємо пул перед exit
  await sql.end()
}
`,
        'utf8'
      )
      expect(await check(dir)).toBe(0)
    })
  })

  test('успіх: .connect() з trailing-маркером allow-pg-leftover (WebSocket)', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 't' })
      await ensureDir(join(dir, 'src'))
      await writeFile(
        join(dir, 'src/ws.ts'),
        `import { sql } from 'bun'
declare const ws: { connect(url: string): void }
export async function boot(url: string) {
  ws.connect(url) // allow-pg-leftover: WebSocket, не pg
  return sql\`SELECT 1\`
}
`,
        'utf8'
      )
      expect(await check(dir)).toBe(0)
    })
  })

  test('успіх: .end() у не-Bun-SQL файлі не флагається', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 't' })
      await ensureDir(join(dir, 'src'))
      await writeFile(
        join(dir, 'src/stream.ts'),
        `declare const stream: { end(): void }
export const stop = () => stream.end()
`,
        'utf8'
      )
      expect(await check(dir)).toBe(0)
    })
  })

  // ── виключення `pg` для LISTEN/NOTIFY ───────────────────────────────────────

  test("успіх: dependencies.pg + import 'pg' у файлі з .query('LISTEN ...')", async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 't', dependencies: { pg: '^8.0.0' } })
      await ensureDir(join(dir, 'src'))
      await writeFile(
        join(dir, 'src/pg-listen.ts'),
        `import { Client } from 'pg'
const client = new Client()
export async function start() {
  await client.connect() // allow-pg-leftover: pg LISTEN-клієнт, не Bun SQL
  await client.query('LISTEN orders_channel')
  client.on('notification', msg => console.log(msg))
}
`,
        'utf8'
      )
      expect(await check(dir)).toBe(0)
    })
  })

  test("успіх: dependencies.pg + .on('notification', ...) без явного LISTEN-запиту", async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 't', dependencies: { pg: '^8.0.0' } })
      await ensureDir(join(dir, 'src'))
      await writeFile(
        join(dir, 'src/notify-bus.ts'),
        `import { Client } from 'pg'
const client = new Client()
export const subscribe = () => client.on('notification', msg => console.log(msg))
`,
        'utf8'
      )
      expect(await check(dir)).toBe(0)
    })
  })

  test('помилка: dependencies.pg без LISTEN/NOTIFY у проекті', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 't', dependencies: { pg: '^8.0.0' } })
      await ensureDir(join(dir, 'src'))
      await writeFile(
        join(dir, 'src/app.ts'),
        `import { Client } from 'pg'
const client = new Client()
export const findUser = (id: number) => client.query('SELECT * FROM users WHERE id = $1', [id])
`,
        'utf8'
      )
      expect(await check(dir)).toBeGreaterThan(0)
    })
  })

  test("помилка: import 'pg' у файлі без LISTEN/NOTIFY (а в іншому файлі LISTEN є)", async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 't', dependencies: { pg: '^8.0.0' } })
      await ensureDir(join(dir, 'src'))
      await writeFile(
        join(dir, 'src/pg-listen.ts'),
        `import { Client } from 'pg'
const listener = new Client()
export const start = () => listener.query('LISTEN orders_channel')
`,
        'utf8'
      )
      await writeFile(
        join(dir, 'src/users.ts'),
        `import { Client } from 'pg'
const db = new Client()
export const getUser = (id: number) => db.query('SELECT * FROM users WHERE id = $1', [id])
`,
        'utf8'
      )
      expect(await check(dir)).toBeGreaterThan(0)
    })
  })

  test('успіх: NOTIFY-запит теж виправдовує dependencies.pg', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 't', dependencies: { pg: '^8.0.0' } })
      await ensureDir(join(dir, 'src'))
      await writeFile(
        join(dir, 'src/notify.ts'),
        `import { Client } from 'pg'
const client = new Client()
export const notify = (msg: string) => client.query(\`NOTIFY orders_channel, '\${msg}'\`)
`,
        'utf8'
      )
      expect(await check(dir)).toBe(0)
    })
  })

  test('успіх: dependencies без pg і без LISTEN/NOTIFY у коді — pg-перевірка пропускає', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 't', dependencies: { lodash: '^4.0.0' } })
      await ensureDir(join(dir, 'src'))
      await writeFile(join(dir, 'src/app.js'), 'export const x = 1\n', 'utf8')
      expect(await check(dir)).toBe(0)
    })
  })

  test("помилка: динамічний список через .join(',') у IN(...)", async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 't' })
      await ensureDir(join(dir, 'src'))
      await writeFile(
        join(dir, 'src/db.ts'),
        `import { sql } from 'bun'
export async function findMany(ids: number[]) {
  return sql\`SELECT * FROM users WHERE id IN (\${ids.join(',')})\`
}
`,
        'utf8'
      )
      expect(await check(dir)).toBeGreaterThan(0)
    })
  })

  test('пропускає: кореневий package.json є, але немає JS/TS-файлів (lines 357-358)', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 't' })
      await writeFile(join(dir, 'README.md'), '# hello\n', 'utf8')
      expect(await check(dir)).toBe(0)
    })
  })

  test('продовжує без краш на невалідний JSON у вкладеному package.json (line 268)', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 't' })
      await ensureDir(join(dir, 'sub'))
      await writeFile(join(dir, 'sub/package.json'), 'NOT_VALID_JSON', 'utf8')
      await ensureDir(join(dir, 'src'))
      await writeFile(join(dir, 'src/app.js'), 'export const x = 1\n', 'utf8')
      expect(await check(dir)).toBe(0)
    })
  })

  test('помилка: функція format з pg-format placeholder — format_function kind (lines 212-214)', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 't' })
      await ensureDir(join(dir, 'src'))
      await writeFile(
        join(dir, 'src/db.js'),
        "import { sql } from 'bun'\nfunction format(tmpl, ...vals) {\n  return tmpl.replace('%L', vals[0])\n}\n",
        'utf8'
      )
      expect(await check(dir)).toBeGreaterThan(0)
    })
  })

  test('помилка: quoteLiteral — pg-format quote-хелпер, quote_helper kind (line 220)', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 't' })
      await ensureDir(join(dir, 'src'))
      await writeFile(
        join(dir, 'src/db.js'),
        'import { sql } from \'bun\'\nfunction quoteLiteral(val) { return "\'" + String(val) + "\'" }\n',
        'utf8'
      )
      expect(await check(dir)).toBeGreaterThan(0)
    })
  })

  test('помилка: query(text, params)-обгортка над .unsafe — queryWrapper (lines 228-229)', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 't' })
      await ensureDir(join(dir, 'src'))
      await writeFile(
        join(dir, 'src/db.js'),
        "import { sql } from 'bun'\nconst db = { query(text, params) { return sql.unsafe(text, params) } }\n",
        'utf8'
      )
      expect(await check(dir)).toBeGreaterThan(0)
    })
  })

  test('помилка: IN-список без перевірки на пустоту — missing_guard reason (line 311)', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 't' })
      await ensureDir(join(dir, 'src'))
      await writeFile(
        join(dir, 'src/db.js'),
        `import { sql } from 'bun'\nexport async function findMany(ids) {\n  return sql\`SELECT * FROM users WHERE id IN (\${ids})\`\n}\n`,
        'utf8'
      )
      expect(await check(dir)).toBeGreaterThan(0)
    })
  })

  test('помилка: sql(не-ідентифікатор) у IN-списку — sql_helper_not_var reason (line 317)', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 't' })
      await ensureDir(join(dir, 'src'))
      await writeFile(
        join(dir, 'src/db.js'),
        `import { sql } from 'bun'\nexport async function findMany(ids) {\n  return sql\`SELECT * FROM users WHERE id IN (\${sql(ids.filter(Boolean))})\`\n}\n`,
        'utf8'
      )
      expect(await check(dir)).toBeGreaterThan(0)
    })
  })
})

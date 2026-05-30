/**
 * Тести для bun-sql-scan.mjs: pure-функції та AST-сканери.
 */
import { describe, expect, test } from 'vitest'

import {
  findBunSqlPgLeftoverCallInText,
  findBunSqlPerRequestConnectionInText,
  findBunSqlUnsafeUseWithoutAllowMarkerInText,
  findBunSqlUnsafeWithInterpolatedTemplateInText,
  findPgLibImportInText,
  findUnsafeBunSqlDynamicSqlListInText,
  isBunSqlScanSourceFile,
  textHasBunSqlImport,
  textHasPgLibImport
} from '../bun-sql-scan.mjs'

describe('isBunSqlScanSourceFile', () => {
  test('true для .mjs, .ts, .tsx, .cjs', () => {
    expect(isBunSqlScanSourceFile('src/db.mjs')).toBe(true)
    expect(isBunSqlScanSourceFile('src/model.ts')).toBe(true)
    expect(isBunSqlScanSourceFile('components/App.tsx')).toBe(true)
    expect(isBunSqlScanSourceFile('lib/helper.cjs')).toBe(true)
  })

  test('false для .d.ts (декларації)', () => {
    expect(isBunSqlScanSourceFile('types/index.d.ts')).toBe(false)
  })

  test('false для нерелевантних розширень', () => {
    expect(isBunSqlScanSourceFile('data.json')).toBe(false)
    expect(isBunSqlScanSourceFile('README.md')).toBe(false)
    expect(isBunSqlScanSourceFile('deploy.yaml')).toBe(false)
  })

  test('true для .js (base case)', () => {
    expect(isBunSqlScanSourceFile('app.js')).toBe(true)
  })
})

describe('textHasBunSqlImport', () => {
  test('true для import { sql } from "bun"', () => {
    expect(textHasBunSqlImport(`import { sql } from "bun"\n`)).toBe(true)
  })

  test('true для import { SQL } from "bun"', () => {
    expect(textHasBunSqlImport(`import { SQL } from 'bun'\n`)).toBe(true)
  })

  test('true для import { sql, type Row } from "bun"', () => {
    expect(textHasBunSqlImport(`import { sql, type Row } from "bun"\n`)).toBe(true)
  })

  test('false для import without sql', () => {
    expect(textHasBunSqlImport(`import { readFile } from 'bun'\n`)).toBe(false)
  })

  test('false для порожнього рядка', () => {
    expect(textHasBunSqlImport('')).toBe(false)
  })
})

describe('textHasPgLibImport', () => {
  test('true для import pg from "pg"', () => {
    expect(textHasPgLibImport(`import pg from 'pg'\n`)).toBe(true)
  })

  test('true для require("pg")', () => {
    expect(textHasPgLibImport(`const pg = require('pg')\n`)).toBe(true)
  })

  test('false для import from "pg-format"', () => {
    expect(textHasPgLibImport(`import { format } from 'pg-format'\n`)).toBe(false)
  })

  test('false без pg імпорту', () => {
    expect(textHasPgLibImport(`import { readFile } from 'node:fs/promises'\n`)).toBe(false)
  })
})

describe('findPgLibImportInText', () => {
  test('знаходить import default з pg', () => {
    const code = `import pg from 'pg'\nconst { Pool } = pg\n`
    const hits = findPgLibImportInText(code)
    expect(hits.length).toBe(1)
    expect(hits[0].line).toBe(1)
    expect(hits[0].snippet).toContain('pg')
  })

  test('знаходить require("pg")', () => {
    const code = `const pg = require('pg')\n`
    const hits = findPgLibImportInText(code, 'db.cjs')
    expect(hits.length).toBe(1)
  })

  test('не знаходить pg-format', () => {
    const code = `import { format } from 'pg-format'\n`
    expect(findPgLibImportInText(code)).toHaveLength(0)
  })

  test('порожній масив для синтаксичної помилки', () => {
    expect(findPgLibImportInText('import { from broken\n', 'bad.mjs')).toHaveLength(0)
  })
})

describe('findBunSqlPerRequestConnectionInText', () => {
  test('знаходить new SQL() всередині функції', () => {
    const code = `
import { SQL } from 'bun'
export function handler() {
  const db = new SQL({ url: process.env.DB_URL })
  return db.query('SELECT 1')
}
`
    const hits = findBunSqlPerRequestConnectionInText(code)
    expect(hits.length).toBe(1)
    expect(hits[0].snippet).toContain('SQL')
  })

  test('не знаходить new SQL() на рівні модуля (singleton)', () => {
    const code = `
import { SQL } from 'bun'
const db = new SQL({ url: process.env.DB_URL })
export { db }
`
    expect(findBunSqlPerRequestConnectionInText(code)).toHaveLength(0)
  })

  test('порожній масив для коду без SQL', () => {
    expect(findBunSqlPerRequestConnectionInText('export const x = 1\n')).toHaveLength(0)
  })
})

describe('findBunSqlUnsafeUseWithoutAllowMarkerInText', () => {
  test('знаходить sql.unsafe() без маркера', () => {
    const code = `
import { sql } from 'bun'
const r = sql.unsafe('SELECT * FROM users')
`
    const hits = findBunSqlUnsafeUseWithoutAllowMarkerInText(code)
    expect(hits.length).toBe(1)
  })

  test('пропускає sql.unsafe() з маркером // allow-unsafe: <reason>', () => {
    const code = `
import { sql } from 'bun'
// allow-unsafe: dynamic table name controlled by config
const r = sql.unsafe('SELECT * FROM ' + tableName)
`
    expect(findBunSqlUnsafeUseWithoutAllowMarkerInText(code)).toHaveLength(0)
  })

  test('порожній масив для коду без unsafe', () => {
    const code = `const r = sql\`SELECT 1\`\n`
    expect(findBunSqlUnsafeUseWithoutAllowMarkerInText(code)).toHaveLength(0)
  })
})

describe('findBunSqlUnsafeWithInterpolatedTemplateInText', () => {
  test('знаходить sql.unsafe з template literal + interpolation', () => {
    const code = `
import { sql } from 'bun'
const r = sql.unsafe(\`SELECT * FROM \${tableName}\`)
`
    const hits = findBunSqlUnsafeWithInterpolatedTemplateInText(code)
    expect(hits.length).toBe(1)
  })

  test('не знаходить sql.unsafe з статичним рядком', () => {
    const code = `
import { sql } from 'bun'
const r = sql.unsafe('SELECT 1')
`
    expect(findBunSqlUnsafeWithInterpolatedTemplateInText(code)).toHaveLength(0)
  })
})

describe('findBunSqlPgLeftoverCallInText', () => {
  test('знаходить .connect() у файлі з bun sql import', () => {
    const code = `
import { sql } from 'bun'
import { Pool } from 'pg'
const pool = new Pool()
await pool.connect()
`
    const hits = findBunSqlPgLeftoverCallInText(code)
    expect(hits.some(h => h.methodName === 'connect')).toBe(true)
  })

  test('не знаходить .connect() у файлі БЕЗ bun sql import', () => {
    const code = `
import { Pool } from 'pg'
const pool = new Pool()
await pool.connect()
`
    expect(findBunSqlPgLeftoverCallInText(code)).toHaveLength(0)
  })

  test('порожній масив для синтаксичної помилки', () => {
    expect(findBunSqlPgLeftoverCallInText('import { from broken\n', 'bad.mjs')).toHaveLength(0)
  })
})

describe('findUnsafeBunSqlDynamicSqlListInText', () => {
  test('знаходить arr.join у контексті IN (...)', () => {
    const code = `
import { sql } from 'bun'
const ids = [1, 2, 3]
const r = sql\`SELECT * FROM users WHERE id IN (\${ids.join(',')})\`
`
    const hits = findUnsafeBunSqlDynamicSqlListInText(code)
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  test('не знаходить звичайний запит без join у IN', () => {
    const code = `
import { sql } from 'bun'
const r = sql\`SELECT * FROM users WHERE id = \${userId}\`
`
    expect(findUnsafeBunSqlDynamicSqlListInText(code)).toHaveLength(0)
  })
})

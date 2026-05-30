/**
 * Тести для bun-sql-scan.mjs: pure-функції та AST-сканери.
 */
import { describe, expect, test } from 'vitest'

import {
  findBunSqlPgLeftoverCallInText,
  findBunSqlPerRequestConnectionInText,
  findBunSqlUnsafeUseWithoutAllowMarkerInText,
  findBunSqlUnsafeWithInterpolatedTemplateInText,
  findPgFormatLikeQueryWrapperInText,
  findPgFormatShimDefinitionInText,
  findPgLibImportInText,
  findPgListenNotifyUsageInText,
  findUnsafeBunSqlDynamicSqlListInText,
  findUnsafeBunSqlInListMissingEmptyGuardInText,
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

describe('findPgFormatShimDefinitionInText', () => {
  test('[] — без bun sql import', () => {
    const code = `function quoteIdent(val) { return '"' + val + '"' }\n`
    expect(findPgFormatShimDefinitionInText(code)).toHaveLength(0)
  })

  test('знаходить quoteLiteral — quote_helper', () => {
    const code = `
import { sql } from 'bun'
function quoteLiteral(val) { return "'" + val + "'" }
`
    const hits = findPgFormatShimDefinitionInText(code)
    expect(hits.length).toBe(1)
    expect(hits[0].kind).toBe('quote_helper')
    expect(hits[0].name).toBe('quoteLiteral')
  })

  test('знаходить pgFormat з %L у тілі — format_function', () => {
    const code = `
import { sql } from 'bun'
function pgFormat(val) { const tpl = '%L'; return tpl + val }
`
    const hits = findPgFormatShimDefinitionInText(code)
    expect(hits.length).toBe(1)
    expect(hits[0].kind).toBe('format_function')
    expect(hits[0].name).toBe('pgFormat')
  })

  test('format без %L/%I/%s у тілі — не знаходиться', () => {
    const code = `
import { sql } from 'bun'
function format(date) { return date.toISOString() }
`
    expect(findPgFormatShimDefinitionInText(code)).toHaveLength(0)
  })

  test('синтаксична помилка → []', () => {
    expect(findPgFormatShimDefinitionInText('import { from broken\n', 'bad.mjs')).toHaveLength(0)
  })

  test('знаходить format_function: %L у template literal у тілі', () => {
    const code = `
import { sql } from 'bun'
function pgFormat(val) { const tpl = \`%L\`; return tpl + val }
`
    const hits = findPgFormatShimDefinitionInText(code)
    expect(hits.length).toBe(1)
    expect(hits[0].kind).toBe('format_function')
  })

  test('знаходить format_function: %I у regex literal у тілі', () => {
    const code = `
import { sql } from 'bun'
function sqlFormat(val) { const re = /%I/u; return re.test(val) ? val : '?' }
`
    const hits = findPgFormatShimDefinitionInText(code)
    expect(hits.length).toBe(1)
    expect(hits[0].kind).toBe('format_function')
  })
})

describe('findPgFormatLikeQueryWrapperInText', () => {
  test('[] — без bun sql import', () => {
    const code = `const shim = { query(text) { return pool.query(text) } }\n`
    expect(findPgFormatLikeQueryWrapperInText(code)).toHaveLength(0)
  })

  test('знаходить { query(text, params) { return sql.unsafe(text) } }', () => {
    const code = `
import { sql } from 'bun'
const pgShim = { query(text, params) { return sql.unsafe(text, params) } }
`
    const hits = findPgFormatLikeQueryWrapperInText(code)
    expect(hits.length).toBe(1)
  })

  test('не знаходить wrapper без unsafe', () => {
    const code = `
import { sql } from 'bun'
const safe = { query(text, params) { return sql\`SELECT 1\` } }
`
    expect(findPgFormatLikeQueryWrapperInText(code)).toHaveLength(0)
  })

  test('синтаксична помилка → []', () => {
    expect(findPgFormatLikeQueryWrapperInText('import { from broken\n', 'bad.mjs')).toHaveLength(0)
  })
})

describe('findUnsafeBunSqlInListMissingEmptyGuardInText', () => {
  test('знаходить IN (${ids}) без guard перед запитом', () => {
    const code = `
import { sql } from 'bun'
const ids = [1, 2, 3]
const r = sql\`SELECT * FROM users WHERE id IN (\${ids})\`
`
    const hits = findUnsafeBunSqlInListMissingEmptyGuardInText(code)
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].reason).toBe('missing_guard')
  })

  test('звичайний запит без IN контексту → []', () => {
    const code = `
import { sql } from 'bun'
const r = sql\`SELECT \${1 + 1}\`
`
    expect(findUnsafeBunSqlInListMissingEmptyGuardInText(code)).toHaveLength(0)
  })

  test('синтаксична помилка → []', () => {
    expect(findUnsafeBunSqlInListMissingEmptyGuardInText('import { from broken\n')).toHaveLength(0)
  })
})

describe('findPgListenNotifyUsageInText', () => {
  test('знаходить LISTEN у .query()', () => {
    const code = `
const pool = {}
await pool.query('LISTEN my_channel')
`
    const hits = findPgListenNotifyUsageInText(code)
    expect(hits.length).toBe(1)
    expect(hits[0].kind).toBe('listen_sql')
  })

  test('знаходить UNLISTEN у .query()', () => {
    const code = `
const client = {}
await client.query('UNLISTEN *')
`
    const hits = findPgListenNotifyUsageInText(code)
    expect(hits.length).toBe(1)
    expect(hits[0].kind).toBe('unlisten_sql')
  })

  test('знаходить .on("notification", ...) listener', () => {
    const code = `
const client = {}
client.on('notification', (msg) => console.log(msg))
`
    const hits = findPgListenNotifyUsageInText(code)
    expect(hits.length).toBe(1)
    expect(hits[0].kind).toBe('notification_listener')
  })

  test('знаходить NOTIFY у tagged template', () => {
    const code = `
import { sql } from 'bun'
const r = sql\`NOTIFY my_channel\`
`
    const hits = findPgListenNotifyUsageInText(code)
    expect(hits.length).toBe(1)
    expect(hits[0].kind).toBe('notify_sql')
  })

  test('звичайний SELECT — не знаходить', () => {
    const code = `await pool.query('SELECT * FROM users')\n`
    expect(findPgListenNotifyUsageInText(code)).toHaveLength(0)
  })

  test('синтаксична помилка → []', () => {
    expect(findPgListenNotifyUsageInText('import { from broken\n')).toHaveLength(0)
  })

  test('знаходить LISTEN у template literal у .query()', () => {
    const code = `
const pool = {}
await pool.query(\`LISTEN my_channel\`)
`
    const hits = findPgListenNotifyUsageInText(code)
    expect(hits.length).toBe(1)
    expect(hits[0].kind).toBe('listen_sql')
  })

  test('не знаходить template literal з SELECT', () => {
    const code = `
const pool = {}
await pool.query(\`SELECT * FROM users\`)
`
    expect(findPgListenNotifyUsageInText(code)).toHaveLength(0)
  })
})

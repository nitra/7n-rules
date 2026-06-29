/**
 * Юніт-тести для нейминга файлів у `#conn/` (js-run.mdc → «Нейминг файлів у `src/conn/`»):
 * валідація `ql-` / `pg-` / `mysql-` / `mssql-` та camelCase-перетворення basename.
 */
import { describe, expect, test } from 'vitest'

import {
  findConnFileRuleViolations,
  isConnFileNameValid,
  isConnFileRulesSourceFile,
  kebabToCamel
} from '../../lib/conn-file-rules.mjs'

describe('isConnFileNameValid: префікс mssql-', () => {
  test('mssql-read / mssql-write приймаються', () => {
    expect(isConnFileNameValid('src/conn/mssql-read.js')).toBe(true)
    expect(isConnFileNameValid('src/conn/mssql-write.js')).toBe(true)
  })

  test('mssql-{read|write}-<id> приймається з різними розширеннями', () => {
    expect(isConnFileNameValid('src/conn/mssql-write-b2b.mts')).toBe(true)
    expect(isConnFileNameValid('src/conn/mssql-read-warehouse.ts')).toBe(true)
    expect(isConnFileNameValid('src/conn/mssql-write-tenant.cjs')).toBe(true)
  })
})

describe('isConnFileNameValid: префікс mysql- (backward-compat)', () => {
  test('mysql-read / mysql-write далі валідні', () => {
    expect(isConnFileNameValid('src/conn/mysql-read.js')).toBe(true)
    expect(isConnFileNameValid('src/conn/mysql-write-tenant.cjs')).toBe(true)
  })
})

describe('isConnFileNameValid: невалідні префікси', () => {
  test('mssql без read/write — порушення', () => {
    expect(isConnFileNameValid('src/conn/mssql.js')).toBe(false)
  })

  test('msql / ms-sql / sqlserver — не приймаються', () => {
    expect(isConnFileNameValid('src/conn/msql-read.js')).toBe(false)
    expect(isConnFileNameValid('src/conn/ms-sql-read.js')).toBe(false)
    expect(isConnFileNameValid('src/conn/sqlserver-read.js')).toBe(false)
  })
})

describe('kebabToCamel: префікс mssql', () => {
  test('mssql-write → mssqlWrite', () => {
    expect(kebabToCamel('mssql-write')).toBe('mssqlWrite')
  })

  test('mssql-{read|write}-<id> → camelCase', () => {
    expect(kebabToCamel('mssql-read-b2b')).toBe('mssqlReadB2b')
    expect(kebabToCamel('mssql-write-warehouse')).toBe('mssqlWriteWarehouse')
  })
})

describe('isConnFileRulesSourceFile', () => {
  test('.js, .ts, .mjs, .cjs — true', () => {
    expect(isConnFileRulesSourceFile('src/conn/pg-write.js')).toBe(true)
    expect(isConnFileRulesSourceFile('src/conn/pg-read.ts')).toBe(true)
    expect(isConnFileRulesSourceFile('src/conn/ql-api.mjs')).toBe(true)
    expect(isConnFileRulesSourceFile('src/conn/pg-write.cjs')).toBe(true)
  })

  test('.d.ts — false (декларації)', () => {
    expect(isConnFileRulesSourceFile('types/index.d.ts')).toBe(false)
  })

  test('нерелевантні розширення — false', () => {
    expect(isConnFileRulesSourceFile('data.json')).toBe(false)
    expect(isConnFileRulesSourceFile('README.md')).toBe(false)
  })
})

describe('isConnFileNameValid: ql- та pg- префікси', () => {
  test('ql-<id> приймається', () => {
    expect(isConnFileNameValid('src/conn/ql-dashboard.js')).toBe(true)
    expect(isConnFileNameValid('src/conn/ql-my-service.mjs')).toBe(true)
  })

  test('ql без id — відхиляється (потрібен мінімум один символ id)', () => {
    expect(isConnFileNameValid('src/conn/ql-.js')).toBe(false)
    expect(isConnFileNameValid('src/conn/ql.js')).toBe(false)
  })

  test('pg-read / pg-write приймаються', () => {
    expect(isConnFileNameValid('src/conn/pg-read.js')).toBe(true)
    expect(isConnFileNameValid('src/conn/pg-write.ts')).toBe(true)
  })

  test('pg-read-<id> / pg-write-<id> приймаються', () => {
    expect(isConnFileNameValid('src/conn/pg-read-analytics.js')).toBe(true)
    expect(isConnFileNameValid('src/conn/pg-write-tenant.mts')).toBe(true)
  })
})

describe('findConnFileRuleViolations: ql- і pg- та різні форми export', () => {
  test('ql-api: export const qlApi → без порушень', () => {
    const code = `import { request } from '@/client'\nexport const qlApi = request\n`
    expect(findConnFileRuleViolations(code, 'src/conn/ql-api.js')).toEqual([])
  })

  test('pg-read: export function pgRead() {} → без порушень', () => {
    const code = `export function pgRead() { return null }\n`
    expect(findConnFileRuleViolations(code, 'src/conn/pg-read.js')).toEqual([])
  })

  test('pg-write: export class PgWrite → порушення (клас, але неправильна назва pgWrite != PgWrite)', () => {
    const code = `export class PgWrite {}\n`
    const v = findConnFileRuleViolations(code, 'src/conn/pg-write.js')
    expect(v.length).toBe(1)
    expect(v[0].kind).toBe('export-name')
    expect(v[0].expectedName).toBe('pgWrite')
    expect(v[0].foundNames).toContain('PgWrite')
  })

  test('pg-read: export class pgRead → без порушень (клас з правильним іменем)', () => {
    const code = `export class pgRead {}\n`
    expect(findConnFileRuleViolations(code, 'src/conn/pg-read.js')).toEqual([])
  })

  test('export { myConn as pgRead } → без порушень (re-export з аліасом)', () => {
    const code = `import { pool } from './internal'\nexport { pool as pgRead }\n`
    expect(findConnFileRuleViolations(code, 'src/conn/pg-read.js')).toEqual([])
  })

  test('export { pgRead } → без порушень (re-export без аліаса)', () => {
    const code = `import { pgRead } from './internal'\nexport { pgRead }\n`
    expect(findConnFileRuleViolations(code, 'src/conn/pg-read.js')).toEqual([])
  })

  test("невалідне ім'я файлу + export default → обидва порушення", () => {
    const code = `export default {}\n`
    const v = findConnFileRuleViolations(code, 'src/conn/bad-name.js')
    expect(v.some(x => x.kind === 'name')).toBe(true)
    expect(v.some(x => x.kind === 'default-export')).toBe(true)
  })

  test('синтаксична помилка → порожній масив (парсер не падає)', () => {
    expect(findConnFileRuleViolations('import { from broken\n', 'src/conn/pg-read.js')).toEqual([])
  })
})

describe('findConnFileRuleViolations: mssql-write має іменований експорт mssqlWrite', () => {
  test('іменований mssqlWrite — без порушень', () => {
    const code = `import sql from 'mssql'\nexport const mssqlWrite = new sql.ConnectionPool({})\n`
    expect(findConnFileRuleViolations(code, 'src/conn/mssql-write.js')).toEqual([])
  })

  test('неправильне імʼя експорту — порушення export-name з очікуваним mssqlWrite', () => {
    const code = `import sql from 'mssql'\nexport const mssqlWriter = new sql.ConnectionPool({})\n`
    const v = findConnFileRuleViolations(code, 'src/conn/mssql-write.js')
    expect(v.length).toBe(1)
    expect(v[0].kind).toBe('export-name')
    expect(v[0].expectedName).toBe('mssqlWrite')
  })

  test('export default — порушення default-export', () => {
    const code = `import sql from 'mssql'\nexport default new sql.ConnectionPool({})\n`
    const violations = findConnFileRuleViolations(code, 'src/conn/mssql-write.js')
    expect(violations.some(v => v.kind === 'default-export')).toBe(true)
  })

  test('mssql-write-b2b → очікується mssqlWriteB2b', () => {
    const code = `import sql from 'mssql'\nexport const wrong = 1\n`
    const v = findConnFileRuleViolations(code, 'src/conn/mssql-write-b2b.mts')
    expect(v.length).toBe(1)
    expect(v[0].kind).toBe('export-name')
    expect(v[0].expectedName).toBe('mssqlWriteB2b')
  })
})

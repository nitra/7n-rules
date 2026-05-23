/**
 * Юніт-тести для нейминга файлів у `#conn/` (js-run.mdc → «Нейминг файлів у `src/conn/`»):
 * валідація `ql-` / `pg-` / `mysql-` / `mssql-` та camelCase-перетворення basename.
 */
import { describe, expect, test } from 'bun:test'

import { findConnFileRuleViolations, isConnFileNameValid, kebabToCamel } from '../conn-file-rules.mjs'

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

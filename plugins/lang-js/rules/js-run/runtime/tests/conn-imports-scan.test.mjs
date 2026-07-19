/**
 * Модульні тести для AST-сканера правила «Внутрішні аліаси» (js-run.mdc).
 */
import { describe, expect, test } from 'vitest'

import {
  findConnFactoryImportsInText,
  isConnImportsScanSourceFile,
  isInsideConnDir,
  resolveConnDirFromPackageJson
} from '../../lib/conn-imports-scan.mjs'

describe('conn-imports-scan: classify imports', () => {
  test("import { SQL } from 'bun' — порушення", () => {
    const hits = findConnFactoryImportsInText(`import { SQL } from 'bun'\n`, 'pkg/src/x.ts')
    expect(hits.length).toBe(1)
    expect(hits[0].module).toBe('bun')
    expect(hits[0].specifier).toBe('SQL')
  })

  test("import sql from 'mssql' — порушення", () => {
    const hits = findConnFactoryImportsInText(`import sql from 'mssql'\n`, 'pkg/src/x.ts')
    expect(hits.length).toBe(1)
    expect(hits[0].module).toBe('mssql')
    expect(hits[0].specifier).toBe('*')
  })

  test("import { GraphQLClient } from '@nitra/graphql-request' — порушення", () => {
    const hits = findConnFactoryImportsInText(
      `import { GraphQLClient } from '@nitra/graphql-request'\n`,
      'pkg/src/x.ts'
    )
    expect(hits.length).toBe(1)
    expect(hits[0].module).toBe('@nitra/graphql-request')
    expect(hits[0].specifier).toBe('GraphQLClient')
  })

  test("import { gql } from '@nitra/graphql-request' — без порушення", () => {
    expect(findConnFactoryImportsInText(`import { gql } from '@nitra/graphql-request'\n`, 'pkg/src/x.ts').length).toBe(
      0
    )
  })

  test("import { spawn } from 'bun' — без порушення", () => {
    expect(findConnFactoryImportsInText(`import { spawn } from 'bun'\n`, 'pkg/src/x.ts').length).toBe(0)
  })
})

describe('conn-imports-scan: resolveConnDirFromPackageJson', () => {
  test('за замовчуванням src/conn', () => {
    expect(resolveConnDirFromPackageJson(null)).toBe('src/conn')
    expect(resolveConnDirFromPackageJson({})).toBe('src/conn')
    expect(resolveConnDirFromPackageJson({ imports: {} })).toBe('src/conn')
  })

  test('читає imports["#conn/*"] як рядок', () => {
    expect(resolveConnDirFromPackageJson({ imports: { '#conn/*': './src/conn/*' } })).toBe('src/conn')
    expect(resolveConnDirFromPackageJson({ imports: { '#conn/*': './lib/connections/*' } })).toBe('lib/connections')
  })

  test('читає conditional exports {default}', () => {
    expect(resolveConnDirFromPackageJson({ imports: { '#conn/*': { default: './app/conn/*' } } })).toBe('app/conn')
  })
})

describe('conn-imports-scan: isInsideConnDir', () => {
  test('точно та вкладено — true', () => {
    expect(isInsideConnDir('src/conn', 'src/conn')).toBe(true)
    expect(isInsideConnDir('src/conn/pg.js', 'src/conn')).toBe(true)
    expect(isInsideConnDir('src/conn/sub/x.js', 'src/conn')).toBe(true)
  })
  test('поза каталогом — false', () => {
    expect(isInsideConnDir('src/index.js', 'src/conn')).toBe(false)
    expect(isInsideConnDir('src/connect.js', 'src/conn')).toBe(false)
  })
})

describe('conn-imports-scan: isConnImportsScanSourceFile', () => {
  test('фільтр розширень', () => {
    expect(isConnImportsScanSourceFile('src/a.ts')).toBe(true)
    expect(isConnImportsScanSourceFile('src/a.mjs')).toBe(true)
    expect(isConnImportsScanSourceFile('src/a.json')).toBe(false)
    expect(isConnImportsScanSourceFile('src/a.d.ts')).toBe(false)
  })
})

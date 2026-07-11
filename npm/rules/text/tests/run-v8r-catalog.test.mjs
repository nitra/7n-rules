/**
 * Тести наявності каталогу схем v8r у пакеті та експортованого запуску без CLI,
 * плюс guard-інваріанти вендорованих схем: self-contained $ref (жодних per-run
 * мережевих фетчів — v8r резолвить зовнішні $ref мережею відносно $id схеми)
 * і валідність локальних шляхів каталогу.
 */
import { describe, expect, test } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { glob } from 'node:fs/promises'

import { V8R_CATALOG_PATH, runV8rWithGlobs } from '../run-v8r/main.mjs'

const SCHEMAS_DIR = dirname(V8R_CATALOG_PATH)
const REMOTE_URL_RE = /^https?:\/\//u

/**
 * Рекурсивно збирає всі значення `$ref` у JSON-дереві.
 * @param {unknown} node вузол схеми
 * @param {string[]} acc акумулятор знайдених ref-ів
 * @returns {string[]} acc
 */
function collectRefs(node, acc = []) {
  if (Array.isArray(node)) {
    for (const item of node) collectRefs(item, acc)
    return acc
  }
  if (node && typeof node === 'object') {
    if (typeof node.$ref === 'string') acc.push(node.$ref)
    for (const value of Object.values(node)) collectRefs(value, acc)
  }
  return acc
}

describe('run-v8r', () => {
  test('v8r-catalog.json існує поруч із пакетом', () => {
    expect(existsSync(V8R_CATALOG_PATH)).toBe(true)
  })

  test('runV8rWithGlobs для glob без збігів завершується 0 або 98 (без падіння)', { timeout: 20_000 }, () => {
    const code = runV8rWithGlobs(['**/this-glob-should-not-exist-xyz-12345/*.json'])
    expect([0, 98]).toContain(code)
  })

  test('усі $ref у схемах npm/schemas/ внутрішні (#…) — інакше v8r фетчить їх мережею на кожен прогін', async () => {
    const offenders = []
    for await (const relPath of glob('**/*.json', { cwd: SCHEMAS_DIR })) {
      const schema = JSON.parse(readFileSync(join(SCHEMAS_DIR, relPath), 'utf8'))
      const external = collectRefs(schema).filter(ref => !ref.startsWith('#'))
      if (external.length > 0) offenders.push(`${relPath}: ${[...new Set(external)].join(', ')}`)
    }
    expect(offenders).toEqual([])
  })

  test('кожен локальний url у v8r-catalog.json вказує на існуючий файл під npm/schemas/', () => {
    const catalog = JSON.parse(readFileSync(V8R_CATALOG_PATH, 'utf8'))
    const missing = catalog.schemas
      .filter(({ url }) => !REMOTE_URL_RE.test(url))
      .filter(({ url }) => !existsSync(join(SCHEMAS_DIR, url)))
      .map(({ url }) => url)
    expect(missing).toEqual([])
  })
})

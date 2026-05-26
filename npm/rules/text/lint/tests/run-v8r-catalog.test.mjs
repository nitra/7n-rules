/**
 * Тести наявності каталогу схем v8r у пакеті та експортованого запуску без CLI.
 */
import { describe, expect, test } from 'vitest'
import { existsSync } from 'node:fs'

import { getV8rCatalogPath, runV8rWithGlobs } from '../run-v8r.mjs'

describe('run-v8r', () => {
  test('v8r-catalog.json існує поруч із пакетом', () => {
    const p = getV8rCatalogPath()
    expect(existsSync(p)).toBe(true)
  })

  test(
    'runV8rWithGlobs для glob без збігів завершується 0 або 98 (без падіння)',
    { timeout: 20_000 },
    () => {
      const code = runV8rWithGlobs(['**/this-glob-should-not-exist-xyz-12345/*.json'])
      expect([0, 98]).toContain(code)
    }
  )
})

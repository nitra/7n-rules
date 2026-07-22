import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { lint, readThresholds } from '../main.mjs'

describe('readThresholds', () => {
  let dir

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cov-thresholds-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test('без .n-rules.json → дефолти 80/80 і classify вимкнено (1.1)', async () => {
    expect(await readThresholds(dir)).toEqual({ coverage: 80, mutation: 80, classify: 1.1 })
  })

  test('пороги читаються з .n-rules.json#coverage', async () => {
    writeFileSync(
      join(dir, '.n-rules.json'),
      JSON.stringify({ rules: [], coverage: { coverageThreshold: 60, mutationThreshold: 50, classifyConfidenceThreshold: 0.7 } })
    )
    expect(await readThresholds(dir)).toEqual({ coverage: 60, mutation: 50, classify: 0.7 })
  })

  test('битий JSON → дефолти без крешу', async () => {
    writeFileSync(join(dir, '.n-rules.json'), '{broken')
    expect(await readThresholds(dir)).toEqual({ coverage: 80, mutation: 80, classify: 1.1 })
  })
})

describe('lint', () => {
  test('проєкт без плагінів-провайдерів → нуль порушень (порожній гейт)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cov-lint-'))
    try {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 't' }))
      const result = await lint({ cwd: dir, ruleId: 'test', concernId: 'coverage', files: ['src/a.mjs'] })
      expect(result.violations).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

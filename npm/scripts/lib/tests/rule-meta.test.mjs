import { describe, expect, test } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { parseRuleAutoSpec, parseRuleLintPhase, readRuleMetaRaw } from '../rule-meta.mjs'
import { withTmpDir, writeJson } from '../../utils/test-helpers.mjs'

describe('parseRuleAutoSpec', () => {
  test('"завжди" → { always: true }', () => {
    expect(parseRuleAutoSpec('завжди')).toEqual({ always: true })
  })
  test('масив правил → { rules }', () => {
    expect(parseRuleAutoSpec(['bun'])).toEqual({ rules: ['bun'] })
    expect(parseRuleAutoSpec(['vue', 'image-compress'])).toEqual({ rules: ['vue', 'image-compress'] })
  })
  test('порожній масив → null', () => {
    expect(parseRuleAutoSpec([])).toBeNull()
  })
  test('glob рядок → { glob: [рядок] }', () => {
    expect(parseRuleAutoSpec({ glob: '**/*.vue' })).toEqual({ glob: ['**/*.vue'] })
  })
  test('glob масив → { glob }', () => {
    expect(parseRuleAutoSpec({ glob: ['**/Dockerfile', '**/Dockerfile.*'] })).toEqual({
      glob: ['**/Dockerfile', '**/Dockerfile.*']
    })
  })
  test('predicate без arg → { predicate }', () => {
    expect(parseRuleAutoSpec({ predicate: 'gqlTaggedTemplate' })).toEqual({ predicate: 'gqlTaggedTemplate', arg: undefined })
  })
  test('predicate з arg → { predicate, arg }', () => {
    expect(parseRuleAutoSpec({ predicate: 'depInAnyPackageJson', arg: ['mssql'] })).toEqual({
      predicate: 'depInAnyPackageJson',
      arg: ['mssql']
    })
  })
  test('невалідне → null', () => {
    expect(parseRuleAutoSpec(undefined)).toBeNull()
    expect(parseRuleAutoSpec('always')).toBeNull()
    expect(parseRuleAutoSpec({ glob: 42 })).toBeNull()
    expect(parseRuleAutoSpec({ predicate: 42 })).toBeNull()
    expect(parseRuleAutoSpec({})).toBeNull()
  })
})

describe('parseRuleLintPhase', () => {
  test('"quick" / "ci" → значення', () => {
    expect(parseRuleLintPhase('quick')).toBe('quick')
    expect(parseRuleLintPhase('ci')).toBe('ci')
  })
  test('відсутнє / невалідне → null', () => {
    expect(parseRuleLintPhase(undefined)).toBeNull()
    expect(parseRuleLintPhase('all')).toBeNull()
    expect(parseRuleLintPhase(42)).toBeNull()
  })
})

describe('readRuleMetaRaw', () => {
  test('валідний meta.json → обʼєкт', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'meta.json'), { auto: 'завжди' })
      expect(readRuleMetaRaw(dir)).toEqual({ auto: 'завжди' })
    })
  })
  test('відсутній → null', async () => {
    await withTmpDir(async dir => {
      expect(readRuleMetaRaw(dir)).toBeNull()
    })
  })
  test('невалідний JSON → null', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'meta.json'), '{{{', 'utf8')
      expect(readRuleMetaRaw(dir)).toBeNull()
    })
  })
})

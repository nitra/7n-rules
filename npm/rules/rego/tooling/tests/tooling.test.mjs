/**
 * Тести правила rego.mdc (concern tooling): перевірка наявності .regal/config.yaml.
 */
import { describe, expect, test } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { lint } from '../main.mjs'
import { withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'

const run = dir => lint({ cwd: dir, ruleId: 'rego', concernId: 'tooling', files: undefined })

describe('check rego.tooling', () => {
  test('успіх: .regal/config.yaml існує → 0 violations', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, '.regal'), { recursive: true })
      await writeFile(
        join(dir, '.regal', 'config.yaml'),
        'rules:\n  idiomatic:\n    no-defined-entrypoint:\n      level: ignore\n'
      )
      const result = await run(dir)
      expect(result.violations).toEqual([])
    })
  })

  test('порушення: .regal/config.yaml відсутній → violation', async () => {
    await withTmpDir(async dir => {
      const result = await run(dir)
      expect(result.violations.length).toBeGreaterThan(0)
    })
  })

  test('порушення: є .regal/ без config.yaml → violation', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, '.regal'), { recursive: true })
      const result = await run(dir)
      expect(result.violations.length).toBeGreaterThan(0)
    })
  })
})

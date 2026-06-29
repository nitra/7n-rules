/**
 * Тести правила rego.mdc (concern tooling): перевірка наявності .regal/config.yaml.
 */
import { describe, expect, test } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { main as check } from '../main.mjs'
import { withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'

describe('check rego.tooling', () => {
  test('успіх: .regal/config.yaml існує → exit 0', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, '.regal'), { recursive: true })
      await writeFile(
        join(dir, '.regal', 'config.yaml'),
        'rules:\n  idiomatic:\n    no-defined-entrypoint:\n      level: ignore\n'
      )
      expect(await check(dir)).toBe(0)
    })
  })

  test('порушення: .regal/config.yaml відсутній → exit 1', async () => {
    await withTmpDir(async dir => {
      expect(await check(dir)).toBe(1)
    })
  })

  test('порушення: є .regal/ без config.yaml → exit 1', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, '.regal'), { recursive: true })
      expect(await check(dir)).toBe(1)
    })
  })
})

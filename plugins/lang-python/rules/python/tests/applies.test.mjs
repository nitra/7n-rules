/**
 * Тести rules/python/js/applies.mjs: гейт за наявністю `pyproject.toml` у корені.
 *
 * Без `process.chdir` — через `withTmpDir` + `applies(dir)` (контракт test-helpers).
 */
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import { applies } from '../applies/main.mjs'
import { withTmpDir } from '@7n/rules/scripts/utils/test-helpers.mjs'

describe('python applies', () => {
  test('true коли pyproject.toml у cwd', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'pyproject.toml'), '[project]\nname = "demo"\nversion = "0.1.0"\n', 'utf8')
      await expect(applies(dir)).resolves.toBe(true)
    })
  })

  test('false коли pyproject.toml відсутній', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'package.json'), '{}', 'utf8')
      await expect(applies(dir)).resolves.toBe(false)
    })
  })
})

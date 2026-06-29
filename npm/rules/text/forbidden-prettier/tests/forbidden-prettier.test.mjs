/**
 * Тести `text.forbidden-prettier`: жоден з .prettierignore / .prettierrc* / prettier.config.*
 * не може лежати в корені проєкту. Якщо файл є — concern має повернути 1.
 */
import { describe, expect, test } from 'vitest'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'

import { main as check } from '../main.mjs'
import { withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'

describe('check text.forbidden-prettier', () => {
  test('успіх: жодного Prettier-артефакту в корені → exit 0', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'package.json'), '{}\n', 'utf8')
      expect(check(dir)).toBe(0)
    })
  })

  test('порушення: .prettierignore у корені → exit 1', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, '.prettierignore'), 'dist\n', 'utf8')
      expect(check(dir)).toBe(1)
    })
  })

  test('порушення: .prettierrc у корені → exit 1', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, '.prettierrc'), '{}\n', 'utf8')
      expect(check(dir)).toBe(1)
    })
  })

  test('порушення: prettier.config.mjs у корені → exit 1', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'prettier.config.mjs'), 'export default {}\n', 'utf8')
      expect(check(dir)).toBe(1)
    })
  })

  test('порушення: .prettierrc.yaml у корені → exit 1', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, '.prettierrc.yaml'), 'semi: false\n', 'utf8')
      expect(check(dir)).toBe(1)
    })
  })
})

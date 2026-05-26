/**
 * Тести `text.forbidden-prettier`: жоден з .prettierignore / .prettierrc* / prettier.config.*
 * не може лежати в корені проєкту. Якщо файл є — concern має повернути 1.
 */
import { describe, expect, test } from 'vitest'
import { writeFile } from 'node:fs/promises'

import { check } from '../forbidden-prettier.mjs'
import { withTmpCwd } from '../../../../scripts/utils/test-helpers.mjs'

describe('check text.forbidden-prettier', () => {
  test('успіх: жодного Prettier-артефакту в корені → exit 0', async () => {
    await withTmpCwd(async () => {
      await writeFile('package.json', '{}\n', 'utf8')
      expect(check()).toBe(0)
    })
  })

  test('порушення: .prettierignore у корені → exit 1', async () => {
    await withTmpCwd(async () => {
      await writeFile('.prettierignore', 'dist\n', 'utf8')
      expect(check()).toBe(1)
    })
  })

  test('порушення: .prettierrc у корені → exit 1', async () => {
    await withTmpCwd(async () => {
      await writeFile('.prettierrc', '{}\n', 'utf8')
      expect(check()).toBe(1)
    })
  })

  test('порушення: prettier.config.mjs у корені → exit 1', async () => {
    await withTmpCwd(async () => {
      await writeFile('prettier.config.mjs', 'export default {}\n', 'utf8')
      expect(check()).toBe(1)
    })
  })

  test('порушення: .prettierrc.yaml у корені → exit 1', async () => {
    await withTmpCwd(async () => {
      await writeFile('.prettierrc.yaml', 'semi: false\n', 'utf8')
      expect(check()).toBe(1)
    })
  })
})

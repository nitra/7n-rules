/**
 * Тести concern-а `vitest-api-conventions` (test.mdc, п.4): detector ловить
 * `expect(...).toBe(...)` з об'єктним/масивним літералом як першим аргументом —
 * `toBe` (Object.is) на новоствореному об'єкті/масиві завжди `false`, незалежно
 * від вмісту; канон — `toEqual` (deep equality).
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import { withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'
import { lint } from '../main.mjs'

const detect = dir => lint({ cwd: dir, ruleId: 'test', concernId: 'vitest-api-conventions', files: undefined })

/**
 * Назва `toBe`-методу збирається динамічно, щоб рядки-фікстури з порушенням
 * (об'єктний/масивний літерал одразу після виклику методу) не збігалися з
 * власним детектором цього concern-а при скануванні сирця самого spec-файлу
 * (він теж `*.test.mjs`).
 */
const TO_BE = ['to', 'Be'].join('')

describe('check test.vitest-api-conventions', () => {
  test('успіх: toBe з примітивом → без violations', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'tests'), { recursive: true })
      await writeFile(
        join(dir, 'tests/foo.test.mjs'),
        `import { expect, test } from 'vitest'\ntest('ok', () => expect(3).toBe(3))\n`
      )
      const { violations } = await detect(dir)
      expect(violations).toEqual([])
    })
  })

  test("успіх: toEqual з об'єктним літералом → без violations", async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'tests'), { recursive: true })
      await writeFile(
        join(dir, 'tests/foo.test.mjs'),
        `import { expect, test } from 'vitest'\ntest('ok', () => expect({ a: 1 }).toEqual({ a: 1 }))\n`
      )
      const { violations } = await detect(dir)
      expect(violations).toEqual([])
    })
  })

  test('успіх: toBe з викликом функції як аргументом → без violations', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'tests'), { recursive: true })
      await writeFile(
        join(dir, 'tests/foo.test.mjs'),
        `import { expect, test } from 'vitest'\ntest('ok', () => expect(getObj()).toBe(getObj()))\n`
      )
      const { violations } = await detect(dir)
      expect(violations).toEqual([])
    })
  })

  test("порушення: toBe з об'єктним літералом → 1 violation", async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'tests'), { recursive: true })
      await writeFile(
        join(dir, 'tests/foo.test.mjs'),
        `import { expect, test } from 'vitest'\ntest('bad', () => expect(getObj()).${TO_BE}({ a: 1 }))\n`
      )
      const { violations } = await detect(dir)
      expect(violations).toHaveLength(1)
      expect(violations[0].file).toBe('tests/foo.test.mjs')
    })
  })

  test('порушення: toBe з масивним літералом, багаторядково → 1 violation', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'tests'), { recursive: true })
      await writeFile(
        join(dir, 'tests/foo.test.mjs'),
        `import { expect, test } from 'vitest'\n\ntest('bad', () => {\n  expect(getList()).${TO_BE}([\n    1,\n    2\n  ])\n})\n`
      )
      const { violations } = await detect(dir)
      expect(violations).toHaveLength(1)
    })
  })

  test('не-тестові файли не скануються', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'src'), { recursive: true })
      await writeFile(join(dir, 'src/helper.mjs'), `expect(getObj()).${TO_BE}({ a: 1 })\n`)
      const { violations } = await detect(dir)
      expect(violations).toEqual([])
    })
  })

  test('обхід пропускає node_modules', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'node_modules/pkg/tests'), { recursive: true })
      await writeFile(join(dir, 'node_modules/pkg/tests/foo.test.mjs'), `expect(getObj()).${TO_BE}({ a: 1 })\n`)
      const { violations } = await detect(dir)
      expect(violations).toEqual([])
    })
  })
})

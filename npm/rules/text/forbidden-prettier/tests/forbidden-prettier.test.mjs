/**
 * Тести `text.forbidden-prettier`: жоден з .prettierignore / .prettierrc* / prettier.config.*
 * не може лежати в корені проєкту. Якщо файл є — concern має повернути 1.
 *
 * Прогін — через `runConcernDetector` (dispatch-рівень), не пряма функція: JS
 * `main.mjs` видалений (E2 фази 5 `docs/specs/2026-07-30-rules-v2-rust-core-migration.md`),
 * concern тепер живе лише в `crates/rules-core/src/concerns/forbidden_prettier.rs`
 * і виконується через native-гілку `runConcernDetector` — тому саме dispatch і є
 * parity-гейтом, а не виклик функції напряму.
 */
import { describe, expect, test } from 'vitest'
import { join, dirname } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { runConcernDetector } from '../../../../scripts/lib/lint-surface/detect.mjs'
import { withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'

/** Абсолютний шлях теки концерну (тека з `concern.json`, без main.mjs — native-порт). */
const CONCERN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const CONCERN = { dir: CONCERN_DIR }

const check = async dir => {
  const { violations } = await runConcernDetector(CONCERN, {
    cwd: dir,
    ruleId: 'text',
    concernId: 'forbidden-prettier',
    files: undefined
  })
  return violations.length > 0 ? 1 : 0
}

describe('check text.forbidden-prettier', () => {
  test('успіх: жодного Prettier-артефакту в корені → exit 0', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'package.json'), '{}\n', 'utf8')
      expect(await check(dir)).toBe(0)
    })
  })

  test('порушення: .prettierignore у корені → exit 1', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, '.prettierignore'), 'dist\n', 'utf8')
      expect(await check(dir)).toBe(1)
    })
  })

  test('порушення: .prettierrc у корені → exit 1', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, '.prettierrc'), '{}\n', 'utf8')
      expect(await check(dir)).toBe(1)
    })
  })

  test('порушення: prettier.config.mjs у корені → exit 1', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'prettier.config.mjs'), 'export default {}\n', 'utf8')
      expect(await check(dir)).toBe(1)
    })
  })

  test('порушення: .prettierrc.yaml у корені → exit 1', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, '.prettierrc.yaml'), 'semi: false\n', 'utf8')
      expect(await check(dir)).toBe(1)
    })
  })
})

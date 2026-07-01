/**
 * Тести правила test.mdc (concern sandbox-aware-test): сканер тестів з
 * `import.meta.dirname/url`-навігацією ≥4 рівнів `..` без ізоляції.
 */
import { describe, expect, test } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { lint } from '../main.mjs'
import { withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'

const check = async dir => {
  const { violations } = await lint({
    cwd: dir,
    ruleId: 'test',
    concernId: 'sandbox-aware-test',
    files: undefined
  })
  return violations.length > 0 ? 1 : 0
}

// Глибока навігація через import.meta.dirname (≥4 `..`)
const DEEP_NAV = "const ROOT = join(import.meta.dirname, '..', '..', '..', '..')\n"

// Та ж навігація, але захищена withTmpDir
const DEEP_WITH_TMP =
  "const ROOT = join(import.meta.dirname, '..', '..', '..', '..')\nwithTmpDir(async dir => {})\n"

// Та ж навігація, але захищена test.skipIf(env.STRYKER_MUTATOR_WORKER)
const DEEP_WITH_SKIP_IF = `const ROOT = join(import.meta.dirname, '..', '..', '..', '..')
import { env } from "node:process"
test.skipIf(env.STRYKER_MUTATOR_WORKER)("live-repo", async () => {})
`

// Мілка навігація (3 рівні — нижче порогу 4)
const SHALLOW_NAV = "const DIR = join(import.meta.dirname, '..', '..', '..')\n"

describe('check test.sandbox-aware-test', () => {
  test('успіх: тест без import.meta навігації → exit 0', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'tests'), { recursive: true })
      await writeFile(join(dir, 'tests/foo.test.mjs'), 'import { test } from "vitest"\ntest("ok", () => {})\n')
      expect(await check(dir)).toBe(0)
    })
  })

  test('успіх: мілка навігація (3 рівні) → exit 0', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'tests'), { recursive: true })
      await writeFile(join(dir, 'tests/shallow.test.mjs'), SHALLOW_NAV)
      expect(await check(dir)).toBe(0)
    })
  })

  test('порушення: глибока навігація (4 рівні) без захисту → exit 1', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'tests'), { recursive: true })
      await writeFile(join(dir, 'tests/deep.test.mjs'), DEEP_NAV)
      expect(await check(dir)).toBe(1)
    })
  })

  test('успіх: глибока навігація + withTmpDir → exit 0', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'tests'), { recursive: true })
      await writeFile(join(dir, 'tests/deep-protected.test.mjs'), DEEP_WITH_TMP)
      expect(await check(dir)).toBe(0)
    })
  })

  test('успіх: глибока навігація + test.skipIf(env.STRYKER_MUTATOR_WORKER) → exit 0', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'tests'), { recursive: true })
      await writeFile(join(dir, 'tests/live-repo.test.mjs'), DEEP_WITH_SKIP_IF)
      expect(await check(dir)).toBe(0)
    })
  })

  test('успіх: 5+ рівнів ".." з withTmpDir → exit 0', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'tests'), { recursive: true })
      await writeFile(
        join(dir, 'tests/very-deep.test.mjs'),
        "const R = join(import.meta.dirname, '..', '..', '..', '..', '..')\nwithTmpDir(async dir => {})\n"
      )
      expect(await check(dir)).toBe(0)
    })
  })

  test('не-тестові файли не скануються → exit 0', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'src'), { recursive: true })
      await writeFile(join(dir, 'src/helper.mjs'), DEEP_NAV)
      expect(await check(dir)).toBe(0)
    })
  })

  test('*.test.js (не mjs) теж сканується → exit 1', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'tests'), { recursive: true })
      await writeFile(join(dir, 'tests/deep.test.js'), DEEP_NAV)
      expect(await check(dir)).toBe(1)
    })
  })

  test('обхід пропускає node_modules', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'node_modules/pkg/tests'), { recursive: true })
      await writeFile(join(dir, 'node_modules/pkg/tests/deep.test.mjs'), DEEP_NAV)
      expect(await check(dir)).toBe(0)
    })
  })

  test('import.meta.url (не лише dirname) теж детектується → exit 1', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'tests'), { recursive: true })
      await writeFile(
        join(dir, 'tests/url-based.test.mjs'),
        "const d = dirname(fileURLToPath(import.meta.url))\nconst R = join(d, '..', '..', '..', '..')\n"
      )
      expect(await check(dir)).toBe(1)
    })
  })
})

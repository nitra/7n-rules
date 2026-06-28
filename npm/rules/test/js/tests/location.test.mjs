/**
 * Тести правила test.mdc (concern location): сканер `*.test.mjs` поза каталогом `tests/`.
 */
import { describe, expect, test } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { main } from '../location.mjs'
import { withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'

describe('check test.location', () => {
  test('успіх: усі *.test.mjs у tests/ → exit 0', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'rules/foo/js/bar/tests'), { recursive: true })
      await writeFile(join(dir, 'rules/foo/js/bar/check.mjs'), 'export function check() {}\n')
      await writeFile(join(dir, 'rules/foo/js/bar/tests/check.test.mjs'), 'import { test } from "bun:test"\n')
      expect(await check(dir)).toBe(0)
    })
  })

  test('порушення: тест поряд із джерелом → exit 1', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'rules/foo/js/bar'), { recursive: true })
      await writeFile(join(dir, 'rules/foo/js/bar/check.mjs'), 'export function check() {}\n')
      await writeFile(join(dir, 'rules/foo/js/bar/check.test.mjs'), 'import { test } from "bun:test"\n')
      expect(await check(dir)).toBe(1)
    })
  })

  test('порушення: тест у довільному НЕ-tests каталозі → exit 1', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'scripts/spec'), { recursive: true })
      await writeFile(join(dir, 'scripts/spec/foo.test.mjs'), 'import { test } from "bun:test"\n')
      expect(await check(dir)).toBe(1)
    })
  })

  test('успіх: проєкт без жодного *.test.mjs → exit 0', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'src'), { recursive: true })
      await writeFile(join(dir, 'src/index.mjs'), 'export const x = 1\n')
      expect(await check(dir)).toBe(0)
    })
  })

  test('успіх: integration-тести у root tests/ → exit 0', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'tests'), { recursive: true })
      await writeFile(join(dir, 'tests/integration.test.mjs'), 'import { test } from "bun:test"\n')
      expect(await check(dir)).toBe(0)
    })
  })

  test('обхід пропускає node_modules', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'node_modules/some-pkg'), { recursive: true })
      await writeFile(join(dir, 'node_modules/some-pkg/foo.test.mjs'), 'import { test } from "bun:test"\n')
      expect(await check(dir)).toBe(0)
    })
  })

  test('*_test.rego поряд із полісі НЕ є порушенням (OPA convention)', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'rules/foo/policy/bar'), { recursive: true })
      await writeFile(join(dir, 'rules/foo/policy/bar/bar.rego'), 'package foo.bar\n')
      await writeFile(join(dir, 'rules/foo/policy/bar/bar_test.rego'), 'package foo.bar_test\n')
      expect(await check(dir)).toBe(0)
    })
  })
})

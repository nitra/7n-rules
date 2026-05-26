/**
 * Тести правила test.mdc (concern location): сканер `*.test.mjs` поза каталогом `tests/`.
 */
import { describe, expect, test } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { check } from '../location.mjs'
import { withTmpCwd } from '../../../../scripts/utils/test-helpers.mjs'

describe('check test.location', () => {
  test('успіх: усі *.test.mjs у tests/ → exit 0', async () => {
    await withTmpCwd(async () => {
      await mkdir(join('rules/foo/js/bar/tests'), { recursive: true })
      await writeFile(join('rules/foo/js/bar/check.mjs'), 'export function check() {}\n')
      await writeFile(join('rules/foo/js/bar/tests/check.test.mjs'), 'import { test } from "bun:test"\n')
      expect(await check()).toBe(0)
    })
  })

  test('порушення: тест поряд із джерелом → exit 1', async () => {
    await withTmpCwd(async () => {
      await mkdir(join('rules/foo/js/bar'), { recursive: true })
      await writeFile(join('rules/foo/js/bar/check.mjs'), 'export function check() {}\n')
      await writeFile(join('rules/foo/js/bar/check.test.mjs'), 'import { test } from "bun:test"\n')
      expect(await check()).toBe(1)
    })
  })

  test('порушення: тест у довільному НЕ-tests каталозі → exit 1', async () => {
    await withTmpCwd(async () => {
      await mkdir(join('scripts/spec'), { recursive: true })
      await writeFile(join('scripts/spec/foo.test.mjs'), 'import { test } from "bun:test"\n')
      expect(await check()).toBe(1)
    })
  })

  test('успіх: проєкт без жодного *.test.mjs → exit 0', async () => {
    await withTmpCwd(async () => {
      await mkdir(join('src'), { recursive: true })
      await writeFile(join('src/index.mjs'), 'export const x = 1\n')
      expect(await check()).toBe(0)
    })
  })

  test('успіх: integration-тести у root tests/ → exit 0', async () => {
    await withTmpCwd(async () => {
      await mkdir(join('tests'), { recursive: true })
      await writeFile(join('tests/integration.test.mjs'), 'import { test } from "bun:test"\n')
      expect(await check()).toBe(0)
    })
  })

  test('обхід пропускає node_modules', async () => {
    await withTmpCwd(async () => {
      await mkdir(join('node_modules/some-pkg'), { recursive: true })
      await writeFile(join('node_modules/some-pkg/foo.test.mjs'), 'import { test } from "bun:test"\n')
      expect(await check()).toBe(0)
    })
  })

  test('*_test.rego поряд із полісі НЕ є порушенням (OPA convention)', async () => {
    await withTmpCwd(async () => {
      await mkdir(join('rules/foo/policy/bar'), { recursive: true })
      await writeFile(join('rules/foo/policy/bar/bar.rego'), 'package foo.bar\n')
      await writeFile(join('rules/foo/policy/bar/bar_test.rego'), 'package foo.bar_test\n')
      expect(await check()).toBe(0)
    })
  })
})

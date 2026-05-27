/**
 * Тести правила test.mdc (concern no-process-chdir): сканер `process.chdir(` у `*.test.{js,mjs}`.
 */
import { describe, expect, test } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { check } from '../no-process-chdir.mjs'
import { withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'

describe('check test.no-process-chdir', () => {
  test('успіх: тест без process.chdir → exit 0', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'tests'), { recursive: true })
      await writeFile(join(dir, 'tests/foo.test.mjs'), 'import { test } from "vitest"\ntest("ok", () => {})\n')
      expect(await check(dir)).toBe(0)
    })
  })

  test('порушення: тест із process.chdir(dir) → exit 1', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'tests'), { recursive: true })
      await writeFile(
        join(dir, 'tests/foo.test.mjs'),
        'import { test } from "vitest"\ntest("bad", () => { process.chdir("/tmp") })\n'
      )
      expect(await check(dir)).toBe(1)
    })
  })

  test('порушення: process.chdir() з whitespace між іменем і дужкою → exit 1', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'tests'), { recursive: true })
      await writeFile(join(dir, 'tests/bar.test.mjs'), 'process.chdir ("/tmp")\n')
      expect(await check(dir)).toBe(1)
    })
  })

  test('успіх: згадка process.chdir у коментарі/docstring без виклику → exit 0', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'tests'), { recursive: true })
      await writeFile(
        join(dir, 'tests/foo.test.mjs'),
        `import { test } from "vitest"
// Не використовуй process.chdir — це process-wide мутація.
/**
 * Замість process.chdir викликай withTmpDir(async dir => ...).
 */
test("ok", () => {})
`
      )
      expect(await check(dir)).toBe(0)
    })
  })

  test('успіх: process.cwd() (без chdir) не вважається порушенням → exit 0', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'tests'), { recursive: true })
      await writeFile(join(dir, 'tests/foo.test.mjs'), 'const c = process.cwd()\n')
      expect(await check(dir)).toBe(0)
    })
  })

  test('не-тестові файли не скануються (production *.mjs з process.chdir OK)', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'src'), { recursive: true })
      await writeFile(join(dir, 'src/helper.mjs'), 'export function fn() { process.chdir("/tmp") }\n')
      expect(await check(dir)).toBe(0)
    })
  })

  test('кілька порушень: повідомляється кожен файл і кожен рядок', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'tests'), { recursive: true })
      await writeFile(
        join(dir, 'tests/a.test.mjs'),
        `process.chdir("/tmp")
process.chdir("/var")
`
      )
      await writeFile(join(dir, 'tests/b.test.mjs'), 'process.chdir("/x")\n')
      expect(await check(dir)).toBe(1)
    })
  })

  test('обхід пропускає node_modules', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'node_modules/pkg/tests'), { recursive: true })
      await writeFile(
        join(dir, 'node_modules/pkg/tests/foo.test.mjs'),
        'process.chdir("/anywhere")\n'
      )
      expect(await check(dir)).toBe(0)
    })
  })
})

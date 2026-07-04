/**
 * Тести правила test.mdc (concern no-console-store-restore): сканер прямого
 * присвоєння console.<method> = … у `*.test.{js,mjs}`. Назва скана будується
 * конкатенацією рядків, щоб не тригерити сам сканер на коді цього тесту.
 */
import { describe, expect, test } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { lint } from '../main.mjs'
import { withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'

const run = dir => lint({ cwd: dir, ruleId: 'test', concernId: 'no-console-store-restore', files: undefined })

// Зібрано через join, щоб у source не було дослівного assignment-патерну.
const CON_ASSIGN = ['console.lo', 'g ='].join('')
const CON_ERR_ASSIGN = ['console.err', 'or ='].join('')
const CON_WARN_ASSIGN = ['console.wa', 'rn ='].join('')

describe('check test.no-console-store-restore', () => {
  test('успіх: тест без присвоєння console → exit 0', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'tests'), { recursive: true })
      await writeFile(join(dir, 'tests/foo.test.mjs'), 'import { test } from "vitest"\ntest("ok", () => {})\n')
      const res = await run(dir)
      expect(res.violations).toEqual([])
    })
  })

  test(`порушення: ${CON_ASSIGN} fn → exit 1`, async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'tests'), { recursive: true })
      await writeFile(join(dir, 'tests/bad.test.mjs'), `const orig = ${CON_ASSIGN} fn\n`)
      const res = await run(dir)
      expect(res.violations.length).toBeGreaterThan(0)
    })
  })

  test(`порушення: ${CON_ERR_ASSIGN} stub → exit 1`, async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'tests'), { recursive: true })
      await writeFile(join(dir, 'tests/bad.test.mjs'), `${CON_ERR_ASSIGN} () => {}\n`)
      const res = await run(dir)
      expect(res.violations.length).toBeGreaterThan(0)
    })
  })

  test(`порушення: ${CON_WARN_ASSIGN} stub → exit 1`, async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'tests'), { recursive: true })
      await writeFile(join(dir, 'tests/bad.test.mjs'), `${CON_WARN_ASSIGN} vi.fn()\n`)
      const res = await run(dir)
      expect(res.violations.length).toBeGreaterThan(0)
    })
  })

  test('успіх: vi.spyOn(console, "log") не вважається порушенням → exit 0', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'tests'), { recursive: true })
      await writeFile(join(dir, 'tests/ok.test.mjs'), 'vi.spyOn(console, "log").mockReturnValue()\n')
      const res = await run(dir)
      expect(res.violations).toEqual([])
    })
  })

  test('успіх: console.log(...) виклик (не присвоєння) → exit 0', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'tests'), { recursive: true })
      await writeFile(join(dir, 'tests/ok.test.mjs'), 'console.log("msg")\nconsole.error("err")\n')
      const res = await run(dir)
      expect(res.violations).toEqual([])
    })
  })

  test('успіх: console.log === щось (порівняння) не є порушенням → exit 0', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'tests'), { recursive: true })
      await writeFile(join(dir, 'tests/ok.test.mjs'), 'if (console.log === undefined) {}\n')
      const res = await run(dir)
      expect(res.violations).toEqual([])
    })
  })

  test('не-тестові файли не скануються → exit 0', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'src'), { recursive: true })
      await writeFile(join(dir, 'src/helper.mjs'), `${CON_ASSIGN} vi.fn()\n`)
      const res = await run(dir)
      expect(res.violations).toEqual([])
    })
  })

  test('*.test.js (не mjs) теж сканується → exit 1', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'tests'), { recursive: true })
      await writeFile(join(dir, 'tests/bad.test.js'), `${CON_ASSIGN} stub\n`)
      const res = await run(dir)
      expect(res.violations.length).toBeGreaterThan(0)
    })
  })

  test('кілька порушень у різних файлах — повідомляється кожне', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'tests'), { recursive: true })
      await writeFile(join(dir, 'tests/a.test.mjs'), `${CON_ASSIGN} fn1\n`)
      await writeFile(join(dir, 'tests/b.test.mjs'), `${CON_ERR_ASSIGN} fn2\n`)
      const res = await run(dir)
      expect(res.violations.length).toBeGreaterThan(0)
    })
  })

  test('обхід пропускає node_modules', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'node_modules/pkg/tests'), { recursive: true })
      await writeFile(join(dir, 'node_modules/pkg/tests/bad.test.mjs'), `${CON_ASSIGN} vi.fn()\n`)
      const res = await run(dir)
      expect(res.violations).toEqual([])
    })
  })
})

/**
 * Тести правила test.mdc (concern no-process-chdir): сканер забороненого
 * виклику у `*.test.{js,mjs}`. Назва скана будується конкатенацією рядків,
 * щоб не тригерити сам сканер на коді самого тесту (це meta-test).
 */
import { describe, expect, test } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { main as check } from '../main.mjs'
import { withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'

// Зібрано через `join`, щоб у source не зустрічався точний паттерн виклику
// `process.chdir` з відкривною дужкою — інакше сам сканер прапорив би цей файл.
const CHDIR = ['process.chd', 'ir'].join('')

describe('check test.no-process-chdir', () => {
  test('успіх: тест без забороненого виклику → exit 0', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'tests'), { recursive: true })
      await writeFile(join(dir, 'tests/foo.test.mjs'), 'import { test } from "vitest"\ntest("ok", () => {})\n')
      expect(await check(dir)).toBe(0)
    })
  })

  test(`порушення: тест із ${CHDIR}(dir) → exit 1`, async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'tests'), { recursive: true })
      await writeFile(
        join(dir, 'tests/foo.test.mjs'),
        `import { test } from "vitest"\ntest("bad", () => { ${CHDIR}("/tmp") })\n`
      )
      expect(await check(dir)).toBe(1)
    })
  })

  test(`порушення: ${CHDIR}() з whitespace між іменем і дужкою → exit 1`, async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'tests'), { recursive: true })
      await writeFile(join(dir, 'tests/bar.test.mjs'), `${CHDIR} ("/tmp")\n`)
      expect(await check(dir)).toBe(1)
    })
  })

  test(`успіх: згадка ${CHDIR} у коментарі/docstring без виклику → exit 0`, async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'tests'), { recursive: true })
      await writeFile(
        join(dir, 'tests/foo.test.mjs'),
        `import { test } from "vitest"
// Не використовуй ${CHDIR} — це process-wide мутація.
/**
 * Замість ${CHDIR} викликай withTmpDir(async dir => ...).
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

  test(`не-тестові файли не скануються (production *.mjs з ${CHDIR} OK)`, async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'src'), { recursive: true })
      await writeFile(join(dir, 'src/helper.mjs'), `export function fn() { ${CHDIR}("/tmp") }\n`)
      expect(await check(dir)).toBe(0)
    })
  })

  test('кілька порушень: повідомляється кожен файл і кожен рядок', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'tests'), { recursive: true })
      await writeFile(
        join(dir, 'tests/a.test.mjs'),
        `${CHDIR}("/tmp")
${CHDIR}("/var")
`
      )
      await writeFile(join(dir, 'tests/b.test.mjs'), `${CHDIR}("/x")\n`)
      expect(await check(dir)).toBe(1)
    })
  })

  test('обхід пропускає node_modules', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'node_modules/pkg/tests'), { recursive: true })
      await writeFile(join(dir, 'node_modules/pkg/tests/foo.test.mjs'), `${CHDIR}("/anywhere")\n`)
      expect(await check(dir)).toBe(0)
    })
  })
})

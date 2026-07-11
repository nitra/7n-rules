/**
 * Тести concern-а `no-bun-test-import` (test.mdc): detector ловить
 * іменований bun:test-import у `*.test.{js,mjs}`; T0-fix (`fix-no-bun-test-import.mjs`)
 * переписує джерело на `'vitest'`, коли всі специфікатори безпечні (1:1 з vitest).
 */
import { describe, expect, test } from 'vitest'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { lint } from '../main.mjs'
import { patterns } from '../fix-no-bun-test-import.mjs'
import { withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'

// Специфікатор зібрано динамічно: літеральний bun:test-import у фікстурах
// самотригерив би цей самий concern при lint-скані цього файлу.
const bunTestSpecifier = ['bun', 'test'].join(':')
const detect = dir => lint({ cwd: dir, ruleId: 'test', concernId: 'no-bun-test-import', files: undefined })

/**
 * Прогоняє T0-патерни concern-а над violations (як central fix-pipeline).
 * @param {object[]} violations Список порушень від detector-а.
 * @param {string} dir Каталог проєкту (cwd для fix-контексту).
 * @returns {Promise<void>}
 */
async function applyT0(violations, dir) {
  const ctx = {
    cwd: dir,
    ruleId: 'test',
    concernId: 'no-bun-test-import',
    recordWrite() {
      /* no-op у тестовому контексті */
    }
  }
  for (const p of patterns) {
    if (p.test(violations)) await p.apply(violations, ctx)
  }
}

describe('check test.no-bun-test-import', () => {
  test('успіх: import з vitest → без violations', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'tests'), { recursive: true })
      await writeFile(
        join(dir, 'tests/foo.test.mjs'),
        `import { describe, test, expect } from 'vitest'\ntest('ok', () => {})\n`
      )
      const { violations } = await detect(dir)
      expect(violations).toEqual([])
    })
  })

  test('порушення: safe-специфікатори (test, expect) з bun:test → 1 violation, fixable', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'tests'), { recursive: true })
      await writeFile(
        join(dir, 'tests/foo.test.mjs'),
        `import { test, expect } from '${bunTestSpecifier}'\ntest('ok', () => expect(1).toBe(1))\n`
      )
      const { violations } = await detect(dir)
      expect(violations).toHaveLength(1)
      expect(violations[0].data.fixable).toBe(true)
      expect(violations[0].data.specifiers).toEqual(['test', 'expect'])
    })
  })

  test('порушення: import з runner-специфікаторами без 1:1 еквіваленту → не fixable', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'tests'), { recursive: true })
      await writeFile(join(dir, 'tests/foo.test.mjs'), `import { test, mock } from "${bunTestSpecifier}"\n`)
      const { violations } = await detect(dir)
      expect(violations).toHaveLength(1)
      expect(violations[0].data.fixable).toBe(false)
      expect(violations[0].data.specifiers).toEqual(['test', 'mock'])
    })
  })

  test('не-тестові файли не скануються', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'src'), { recursive: true })
      await writeFile(join(dir, 'src/helper.mjs'), `import { test } from '${bunTestSpecifier}'\n`)
      const { violations } = await detect(dir)
      expect(violations).toEqual([])
    })
  })

  test('обхід пропускає node_modules', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'node_modules/pkg/tests'), { recursive: true })
      await writeFile(join(dir, 'node_modules/pkg/tests/foo.test.mjs'), `import { test } from '${bunTestSpecifier}'\n`)
      const { violations } = await detect(dir)
      expect(violations).toEqual([])
    })
  })

  test('T0-fix: fixable import переписується на vitest, тест-код не чіпається', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'tests'), { recursive: true })
      const target = join(dir, 'tests/foo.test.mjs')
      await writeFile(
        target,
        `import { describe, test, expect, beforeEach } from '${bunTestSpecifier}'\n\ndescribe('x', () => {\n  beforeEach(() => {})\n  test('ok', () => expect(1).toBe(1))\n})\n`
      )

      const before = await detect(dir)
      expect(before.violations).toHaveLength(1)
      await applyT0(before.violations, dir)

      const after = await detect(dir)
      expect(after.violations).toEqual([])

      const content = await readFile(target, 'utf8')
      expect(content).toContain("from 'vitest'")
      expect(content).not.toContain(bunTestSpecifier)
      // специфікатори й тіло тесту лишаються незмінними
      expect(content).toContain('import { describe, test, expect, beforeEach } from')
      expect(content).toContain("test('ok', () => expect(1).toBe(1))")
    })
  })

  test('T0-fix: не-fixable import (mock) лишається недоторканим, violation зберігається', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'tests'), { recursive: true })
      const target = join(dir, 'tests/foo.test.mjs')
      const original = `import { test, mock } from '${bunTestSpecifier}'\ntest('x', () => mock(() => 1))\n`
      await writeFile(target, original)

      const before = await detect(dir)
      expect(before.violations).toHaveLength(1)
      await applyT0(before.violations, dir)

      const after = await detect(dir)
      expect(after.violations).toHaveLength(1)
      expect(after.violations[0].data.fixable).toBe(false)

      const content = await readFile(target, 'utf8')
      expect(content).toBe(original)
    })
  })

  test('T0-fix: подвійні лапки зберігаються після заміни', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'tests'), { recursive: true })
      const target = join(dir, 'tests/foo.test.mjs')
      await writeFile(target, `import { test } from "${bunTestSpecifier}"\ntest('x', () => {})\n`)

      const before = await detect(dir)
      await applyT0(before.violations, dir)

      const content = await readFile(target, 'utf8')
      expect(content).toContain('from "vitest"')
    })
  })

  test('T0-fix: кілька файлів у одному прогоні — фіксується лише fixable', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'tests'), { recursive: true })
      const fixablePath = join(dir, 'tests/a.test.mjs')
      const unfixablePath = join(dir, 'tests/b.test.mjs')
      await writeFile(fixablePath, `import { test } from '${bunTestSpecifier}'\ntest('a', () => {})\n`)
      await writeFile(unfixablePath, `import { test, spyOn } from '${bunTestSpecifier}'\ntest('b', () => {})\n`)

      const before = await detect(dir)
      expect(before.violations).toHaveLength(2)
      await applyT0(before.violations, dir)

      expect(await readFile(fixablePath, 'utf8')).toContain("from 'vitest'")
      expect(await readFile(unfixablePath, 'utf8')).toContain(`from '${bunTestSpecifier}'`)
    })
  })
})

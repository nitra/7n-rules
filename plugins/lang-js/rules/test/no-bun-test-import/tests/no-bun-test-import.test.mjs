/**
 * Тести concern-а `no-bun-test-import` (test.mdc): detector ловить іменований
 * import із bun:test у `*.test.{js,mjs}`.
 *
 * T0-fix (`fix-no-bun-test-import.mjs`) ВИДАЛЕНО — фікс портовано у
 * wasm-плагін `crates/plugin-lang-js` через `export fix` (пілот fix-контуру
 * contract v3). Кейси фіксу збережено на інших рівнях:
 * - unit-тести guest-логіки — `crates/plugin-lang-js/src/lib.rs`
 *   (`fix_no_bun_test_import_*`);
 * - живий host-виклик (включно з валідацією плану) —
 *   `crates/rules-plugin-host/tests/plugin_lang_js.rs`;
 * - dispatch-рівень (синтетичний T0Pattern `wasm-fix:*` через
 *   `loadT0Patterns`/`runFixPipeline`) —
 *   `npm/scripts/lib/lint-surface/tests/wasm-fix-e2e.test.mjs`.
 */
import { describe, expect, test } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { lint } from '../main.mjs'
import { withTmpDir } from '@7n/rules/scripts/utils/test-helpers.mjs'

const detect = dir => lint({ cwd: dir, ruleId: 'test', concernId: 'no-bun-test-import', files: undefined })

/**
 * Джерело bun:test у фікстурах збирається динамічно, щоб import-шейп у сирці
 * цього файлу не матчився BUN_TEST_IMPORT_RE детектора.
 */
const BUN_TEST = ['bun', 'test'].join(':')

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

  test('порушення: import з bun:test (test, expect) → 1 violation, fixable', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'tests'), { recursive: true })
      await writeFile(
        join(dir, 'tests/foo.test.mjs'),
        `import { test, expect } from '${BUN_TEST}'\ntest('ok', () => expect(1).toBe(1))\n`
      )
      const { violations } = await detect(dir)
      expect(violations).toHaveLength(1)
      expect(violations[0].data.fixable).toBe(true)
      expect(violations[0].data.specifiers).toEqual(['test', 'expect'])
    })
  })

  test('порушення: import з bun:test (test, mock) → не fixable (mock без еквіваленту)', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'tests'), { recursive: true })
      await writeFile(join(dir, 'tests/foo.test.mjs'), `import { test, mock } from "${BUN_TEST}"\n`)
      const { violations } = await detect(dir)
      expect(violations).toHaveLength(1)
      expect(violations[0].data.fixable).toBe(false)
      expect(violations[0].data.specifiers).toEqual(['test', 'mock'])
    })
  })

  test('не-тестові файли не скануються', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'src'), { recursive: true })
      await writeFile(join(dir, 'src/helper.mjs'), `import { test } from '${BUN_TEST}'\n`)
      const { violations } = await detect(dir)
      expect(violations).toEqual([])
    })
  })

  test('обхід пропускає node_modules', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'node_modules/pkg/tests'), { recursive: true })
      await writeFile(join(dir, 'node_modules/pkg/tests/foo.test.mjs'), `import { test } from '${BUN_TEST}'\n`)
      const { violations } = await detect(dir)
      expect(violations).toEqual([])
    })
  })
})

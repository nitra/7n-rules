import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

import { ensureDir, withTmpDir } from '@7n/rules/scripts/utils/test-helpers.mjs'
import { lint } from '../main.mjs'

const run = dir => lint({ cwd: dir, ruleId: 'style', concernId: 'admin_table', files: undefined })

describe('check (style admin_table)', () => {
  test('exit 0 — n-admin-table використано і визначено', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'src'))
      await writeFile(join(dir, 'src/Table.vue'), '<template><q-table class="n-admin-table" /></template>\n', 'utf8')
      await writeFile(join(dir, 'src/app.scss'), '.n-admin-table {\n  height: 100%;\n}\n', 'utf8')
      const result = await run(dir)
      expect(result.violations).toEqual([])
    })
  })

  test('exit 0 — n-admin-table взагалі не використовується', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'src'))
      await writeFile(join(dir, 'src/Table.vue'), '<template><q-table dense /></template>\n', 'utf8')
      const result = await run(dir)
      expect(result.violations).toEqual([])
    })
  })

  test('exit 1 — n-admin-table використано, але не визначено', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'src'))
      await writeFile(join(dir, 'src/Table.vue'), '<template><q-table class="n-admin-table" /></template>\n', 'utf8')
      await writeFile(join(dir, 'src/app.scss'), '.other { color: red; }\n', 'utf8')
      const result = await run(dir)
      expect(result.violations.length).toBeGreaterThan(0)
      expect(result.violations[0].reason).toBe('missing-admin-table-style')
    })
  })
})

import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

import { ensureDir, withTmpDir } from '@7n/rules/scripts/utils/test-helpers.mjs'
import { lint } from '../main.mjs'

const run = dir => lint({ cwd: dir, ruleId: 'style', concernId: 'quasar_fixes', files: undefined })

describe('check (style quasar_fixes)', () => {
  test('exit 0 — q-scroll-area використано і фікс визначено', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'src'))
      await writeFile(join(dir, 'src/List.vue'), '<template><q-scroll-area /></template>\n', 'utf8')
      await writeFile(join(dir, 'src/app.scss'), '.q-scrollarea {\n  display: flex;\n}\n', 'utf8')
      const result = await run(dir)
      expect(result.violations).toEqual([])
    })
  })

  test('exit 0 — жоден із компонентів не використовується', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'src'))
      await writeFile(join(dir, 'src/List.vue'), '<template><div /></template>\n', 'utf8')
      const result = await run(dir)
      expect(result.violations).toEqual([])
    })
  })

  test('exit 1 — q-tooltip використано, але фікс відсутній', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'src'))
      await writeFile(
        join(dir, 'src/Btn.vue'),
        '<template><q-btn><q-tooltip>hi</q-tooltip></q-btn></template>\n',
        'utf8'
      )
      await writeFile(join(dir, 'src/app.scss'), '.other { color: red; }\n', 'utf8')
      const result = await run(dir)
      expect(result.violations.length).toBeGreaterThan(0)
      expect(result.violations[0].reason).toBe('missing-quasar-fix')
      expect(result.violations[0].message).toContain('q-tooltip')
    })
  })
})

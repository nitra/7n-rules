import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

import { ensureDir, withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'
import { lint } from '../main.mjs'

const run = dir => lint({ cwd: dir, ruleId: 'style', concernId: 'gap', files: undefined })

describe('check (style gap)', () => {
  test('exit 0 — n-gap-md використано і визначено', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'src'))
      await writeFile(join(dir, 'src/Row.vue'), '<template><div class="row n-gap-md" /></template>\n', 'utf8')
      await writeFile(join(dir, 'src/app.scss'), '.n-gap-md {\n  gap: 16px;\n}\n', 'utf8')
      const result = await run(dir)
      expect(result.violations).toEqual([])
    })
  })

  test('exit 0 — n-gap-* взагалі не використовується', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'src'))
      await writeFile(join(dir, 'src/Row.vue'), '<template><div class="row q-gutter-md" /></template>\n', 'utf8')
      const result = await run(dir)
      expect(result.violations).toEqual([])
    })
  })

  test('exit 1 — n-gap-lg використано, але не визначено', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'src'))
      await writeFile(join(dir, 'src/Row.vue'), '<template><div class="row n-gap-lg" /></template>\n', 'utf8')
      await writeFile(join(dir, 'src/app.scss'), '.n-gap-sm {\n  gap: 8px;\n}\n', 'utf8')
      const result = await run(dir)
      expect(result.violations.length).toBeGreaterThan(0)
      expect(result.violations[0].reason).toBe('missing-gap-style')
      expect(result.violations[0].message).toContain('n-gap-lg')
    })
  })
})

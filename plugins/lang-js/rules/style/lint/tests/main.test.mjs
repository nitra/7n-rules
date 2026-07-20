/**
 * Тести detector-а `style/lint` (main.mjs). `resolveCmd` мокається на `null` для
 * PATH-незалежного негативного сценарію — у дев-оточенні цього монорепо
 * `stylelint` реально стоїть у корені (@nitra/stylelint-config), тож PATH-резолв
 * знаходить його навіть у tmp-каталозі; без підміни тест не ізольований від хоста.
 */
import { describe, expect, test, vi } from 'vitest'

import { withTmpDir } from '@7n/rules/scripts/utils/test-helpers.mjs'

vi.mock('@7n/rules/scripts/utils/resolve-cmd.mjs', () => ({ resolveCmd: () => null }))

const { filterStyleFiles, lint, resolveStylelint } = await import('../main.mjs')

describe('filterStyleFiles', () => {
  test('лишає лише css/scss/vue', () => {
    expect(filterStyleFiles(['a.css', 'b.scss', 'c.vue', 'd.js', 'e.ts'])).toEqual(['a.css', 'b.scss', 'c.vue'])
  })
})

describe('resolveStylelint', () => {
  test('без node_modules/.bin/stylelint і поза PATH → null', async () => {
    await withTmpDir(dir => {
      expect(resolveStylelint(dir)).toBeNull()
      return Promise.resolve()
    })
  })
})

describe('lint — stylelint недоступний', () => {
  test('дає warn-diagnostic, не мовчазний skip і не violation (регресія: тихий no-op для незалежних консюмерів)', async () => {
    await withTmpDir(async dir => {
      const result = await lint({ cwd: dir, files: ['a.css'] })
      expect(result.violations).toEqual([])
      expect(result.diagnostics).toHaveLength(1)
      expect(result.diagnostics[0].level).toBe('warn')
      expect(result.diagnostics[0].message).toContain('stylelint')
      expect(result.diagnostics[0].message).toContain('не резолвиться')
    })
  })
})

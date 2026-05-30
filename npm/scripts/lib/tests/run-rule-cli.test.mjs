/**
 * Тести runRuleCli: "не enabled" і "enabled, порожній rule dir → exit 0".
 *
 * `runRuleCli` викликає `readNCursorConfigLite()` без аргументів (process.cwd()),
 * тому мокаємо модуль через `vi.mock` — хукується до імпорту.
 */
import { describe, expect, test, vi } from 'vitest'
import { join } from 'node:path'

import { runRuleCli } from '../run-rule-cli.mjs'
import { readNCursorConfigLite } from '../read-n-cursor-config-lite.mjs'
import { ensureDir, withTmpDir } from '../../utils/test-helpers.mjs'

vi.mock('../read-n-cursor-config-lite.mjs', async importOriginal => {
  const original = await importOriginal()
  return { ...original, readNCursorConfigLite: vi.fn(original.readNCursorConfigLite) }
})

describe('runRuleCli', () => {
  test('правило не enabled (exists:true, rules без testrule) → exit 0 + "Пропущено"', async () => {
    vi.mocked(readNCursorConfigLite).mockResolvedValueOnce({ exists: true, rules: ['other'], disableRules: [] })

    const logs = []
    vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')))
    try {
      const code = await runRuleCli('/fake/rules/testrule')
      expect(code).toBe(0)
      expect(logs.some(l => l.includes('Пропущено'))).toBe(true)
    } finally {
      vi.restoreAllMocks()
    }
  })

  test('правило enabled (exists:false → open by default), порожній ruleDir → exit 0 + "Результат"', async () => {
    vi.mocked(readNCursorConfigLite).mockResolvedValueOnce({ exists: false, rules: [], disableRules: [] })

    await withTmpDir(async dir => {
      const logs = []
      vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')))
      vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        const code = await runRuleCli(dir)
        expect(code).toBe(0)
        expect(logs.some(l => l.includes('Результат'))).toBe(true)
      } finally {
        vi.restoreAllMocks()
      }
    })
  })

  test('правило enabled, js-concern повертає 1 → exit 1', async () => {
    vi.mocked(readNCursorConfigLite).mockResolvedValueOnce({ exists: false, rules: [], disableRules: [] })

    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'js'))
      const { writeFile } = await import('node:fs/promises')
      await writeFile(join(dir, 'js', 'fail.mjs'), `export async function check() { return 1 }\n`, 'utf8')

      vi.spyOn(console, 'log').mockImplementation(() => {})
      vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        const code = await runRuleCli(dir)
        expect(code).toBe(1)
      } finally {
        vi.restoreAllMocks()
      }
    })
  })
})

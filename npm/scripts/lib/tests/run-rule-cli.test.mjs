/**
 * Тести runRuleCli після видалення per-rule whitelist-гейту.
 *
 * `runRuleCli` більше НЕ читає `.n-cursor.json` — гейтинг активних правил живе виключно
 * у `resolveCheckRuleIds` (selection). Прямий `bun rules/<id>/check.mjs` виконується
 * беззастережно (свідомий debug/override-запуск). Тут перевіряємо: запуск незалежний
 * від конфіга, exit-код віддзеркалює результат concern'ів.
 */
import { describe, expect, test, vi } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { runRuleCli } from '../run-rule-cli.mjs'
import { withTmpDir, writeJson } from '../../utils/test-helpers.mjs'

describe('runRuleCli', () => {
  test('запускається беззастережно (без whitelist-гейту), порожній ruleDir → exit 0 + "Результат"', async () => {
    await withTmpDir(async dir => {
      const logs = []
      vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')))
      vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        const code = await runRuleCli(dir)
        expect(code).toBe(0)
        expect(logs.some(l => l.includes('перевірка правила'))).toBe(true)
        expect(logs.some(l => l.includes('Результат'))).toBe(true)
        expect(logs.some(l => l.includes('Пропущено'))).toBe(false)
      } finally {
        vi.restoreAllMocks()
      }
    })
  })

  test('check concern повертає 1 → exit 1', async () => {
    await withTmpDir(async dir => {
      const concernDir = join(dir, 'fail')
      await mkdir(concernDir, { recursive: true })
      await writeJson(join(concernDir, 'concern.json'), {
        $schema: 'https://unpkg.com/@nitra/cursor/schemas/concern.json',
        check: true
      })
      await writeFile(join(concernDir, 'main.mjs'), 'export async function main() { return 1 }\n', 'utf8')

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

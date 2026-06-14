/**
 * Тести runRuleCli після видалення per-rule whitelist-гейту.
 *
 * `runRuleCli` більше НЕ читає `.n-cursor.json` — гейтинг активних правил живе виключно
 * у `resolveCheckRuleIds` (selection). Прямий `bun rules/<id>/fix.mjs` виконується
 * беззастережно (свідомий debug/override-запуск). Тут перевіряємо: запуск незалежний
 * від конфіга, exit-код віддзеркалює результат concern'ів.
 */
import { describe, expect, test, vi } from 'vitest'
import { join } from 'node:path'

import { runRuleCli } from '../run-rule-cli.mjs'
import { ensureDir, withTmpDir } from '../../utils/test-helpers.mjs'

describe('runRuleCli', () => {
  test('запускається беззастережно (без whitelist-гейту), порожній ruleDir → exit 0 + "Результат"', async () => {
    await withTmpDir(async dir => {
      const logs = []
      vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')))
      vi.spyOn(console, 'error').mockImplementation(() => {
        /* noop: придушуємо вивід помилок у тесті */
      })
      try {
        const code = await runRuleCli(dir)
        expect(code).toBe(0)
        expect(logs.some(l => l.includes('перевірка правила'))).toBe(true)
        expect(logs.some(l => l.includes('Результат'))).toBe(true)
        // Гейту немає — "Пропущено" не друкується ніколи.
        expect(logs.some(l => l.includes('Пропущено'))).toBe(false)
      } finally {
        vi.restoreAllMocks()
      }
    })
  })

  test('js-concern повертає 1 → exit 1', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'js'))
      const { writeFile } = await import('node:fs/promises')
      await writeFile(join(dir, 'js', 'fail.mjs'), `export async function check() { return 1 }\n`, 'utf8')

      vi.spyOn(console, 'log').mockImplementation(() => {
        /* noop: придушуємо вивід у тесті */
      })
      vi.spyOn(console, 'error').mockImplementation(() => {
        /* noop: придушуємо вивід помилок у тесті */
      })
      try {
        const code = await runRuleCli(dir)
        expect(code).toBe(1)
      } finally {
        vi.restoreAllMocks()
      }
    })
  })
})

/**
 * Парність native-fix `text/oxfmt` (T3, `crates/rules-core/src/concerns/fix.rs::text_oxfmt_fix`)
 * через ПРОДАКШН-шлях: `loadT0Patterns` → `getNativeFixKeys()`
 * (`listNativeFixes()`) → синтетичний `nativeFixPattern` →
 * `runNativeConcernFix` (napi). Не пряме звернення до Rust-функції (§2.47
 * — прямий виклик уже раз приховав реальний баг мосту).
 *
 * Старий `fix-oxfmt.mjs` (JS T0) лишається на диску — з `text/oxfmt` тепер у
 * `NATIVE_FIXES`, `loadT0Patterns` повертає РІВНО синтетичний native-fix
 * pattern і більше НІКОЛИ не імпортує `fix-oxfmt.mjs` (доккомент
 * `loadT0Patterns`, `run-fix.mjs`) — характеризаційне покриття
 * `oxfmt.test.mjs` (пряме тестування `fix-oxfmt.mjs`) лишається зеленим, але
 * тестує тепер уже мертвий для реального прогону код; цей файл — тест
 * ЖИВОГО шляху.
 *
 * oxfmt стабільно доступний у PATH (homebrew/node_modules) — інтеграційний прогін,
 * той самий мотив, що `oxfmt.test.mjs`.
 */
import { describe, expect, test, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadT0Patterns } from '../../../../scripts/lib/lint-surface/run-fix.mjs'
import { withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'

const CONCERN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const ruleId = 'text'
const concernId = 'oxfmt'
const patternsFor = dir => loadT0Patterns(CONCERN_DIR, concernId, ruleId, dir)

describe('native-fix text/oxfmt (продакшн-шлях loadT0Patterns)', () => {
  test('loadT0Patterns повертає синтетичний native-fix pattern, не fix-oxfmt.mjs', async () => {
    await withTmpDir(async dir => {
      const patterns = await patternsFor(dir)
      expect(patterns).toHaveLength(1)
      expect(patterns[0].id).toBe(`native-fix:${ruleId}/${concernId}`)
    })
  })

  test('apply: oxfmt --write форматує файл, touchedFiles містить абсолютний шлях', async () => {
    await withTmpDir(async dir => {
      const target = join(dir, 'bad.mjs')
      const source = 'export  const   x=1\nexport const y= 2\n'
      await import('node:fs/promises').then(fs => fs.writeFile(target, source, 'utf8'))

      const violations = [
        {
          reason: 'oxfmt-unformatted',
          message: 'bad.mjs: не відформатовано',
          file: 'bad.mjs',
          data: { kind: 'oxfmt-unformatted' }
        }
      ]
      const [pattern] = await patternsFor(dir)
      expect(pattern.test(violations)).toBe(true)

      const res = await pattern.apply(violations, { cwd: dir, ruleId, concernId, recordWrite: vi.fn() })
      expect(res.touchedFiles).toEqual([target])

      // Точний семіколон-стиль залежить від того, чи oxfmt знаходить якийсь
      // `.oxfmtrc.json` вгору від tmpdir (немає репо-конфігу в ізольованому
      // temp-дереві тесту) — не фіксуємо його тут, лише сам факт
      // реформатування: зайві пробіли навколо `=` прибрані, вміст змінився.
      const rewritten = readFileSync(target, 'utf8')
      expect(rewritten).not.toBe(source)
      expect(rewritten).not.toMatch(/ {2,}/)
      expect(rewritten).toMatch(/^export const x = 1;?\nexport const y = 2;?\n$/)
    })
  })

  test('test: false без oxfmt-unformatted violations — concern іде в ladder, не T0', async () => {
    await withTmpDir(async dir => {
      const [pattern] = await patternsFor(dir)
      expect(pattern.test([{ reason: 'other', message: 'm', file: 'a.mjs' }])).toBe(false)
      expect(pattern.test([])).toBe(false)
    })
  })

  test('apply: ідемпотентність — другий прогін на щойно відформатованому файлі дає 0 touchedFiles', async () => {
    await withTmpDir(async dir => {
      const target = join(dir, 'idempotent.mjs')
      await import('node:fs/promises').then(fs =>
        fs.writeFile(target, 'export  const   x=1\n', 'utf8')
      )

      const mkViolations = () => [
        {
          reason: 'oxfmt-unformatted',
          message: 'm',
          file: 'idempotent.mjs',
          data: { kind: 'oxfmt-unformatted' }
        }
      ]
      const [pattern] = await patternsFor(dir)
      const first = await pattern.apply(mkViolations(), { cwd: dir, ruleId, concernId, recordWrite: vi.fn() })
      expect(first.touchedFiles).toEqual([target])

      // НОВИЙ масив violations (не той самий об'єкт, що вище) — інакше
      // `computeNativeFixPlan` (`run-fix.mjs`) переюзав би кешований план за
      // identity й не спитав би native-бік про фактичний стан диска ще раз.
      // Вміст уже канонічний після першого прогону — другий `oxfmt --write`
      // не повинен нічого змінити, тож before === after і план порожній.
      const second = await pattern.apply(mkViolations(), { cwd: dir, ruleId, concernId, recordWrite: vi.fn() })
      expect(second.touchedFiles).toEqual([])
      expect(existsSync(target)).toBe(true)
    })
  })
})

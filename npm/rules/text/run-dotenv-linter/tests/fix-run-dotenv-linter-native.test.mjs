/**
 * Парність native-fix `text/run-dotenv-linter` (§2.82,
 * `crates/rules-core/src/concerns/fix.rs::text_run_dotenv_linter_fix`) через
 * ПРОДАКШН-шлях: `loadT0Patterns` → `getNativeFixKeys()` (`listNativeFixes()`)
 * → синтетичний `nativeFixPattern` → `runNativeConcernFix` (napi). Не пряме
 * звернення до Rust-функції (§2.47 — прямий виклик уже раз приховав реальний
 * баг мосту).
 *
 * JS-канон `fix-run-dotenv-linter.mjs` ЗНЯТО (§2.89) разом зі своїм
 * характеризаційним тестом (єдиний кейс — «реагує лише на reason
 * dotenv-linter» — покритий native-тестом
 * `dotenv_fix_without_matching_violation_is_empty_plan`, `fix.rs`). Native —
 * єдина реалізація фіксу; табличний гейт складу резолву —
 * `npm/scripts/lib/lint-surface/tests/native-fix-single-source.test.mjs`.
 *
 * # Зовнішній тул — гучний skip, не тиха зелень
 *
 * `dotenv-linter` не гарантований на машині розробника. Тести, що реально
 * його спавнять, скіпаються ЯВНО (`test.skipIf` + причина в назві suite),
 * а не роблять вигляд, що все гаразд. Канальні тести (реєстр, `test()`)
 * тула не потребують і біжать завжди.
 */
import { describe, expect, test, vi } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadT0Patterns } from '../../../../scripts/lib/lint-surface/run-fix.mjs'
import { resolveCmd } from '../../../../scripts/utils/resolve-cmd.mjs'
import { withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'

const CONCERN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const ruleId = 'text'
const concernId = 'run-dotenv-linter'
const patternsFor = dir => loadT0Patterns(CONCERN_DIR, concernId, ruleId, dir)

const HAS_TOOL = resolveCmd('dotenv-linter') !== null
const ctxFor = dir => ({ cwd: dir, ruleId, concernId, recordWrite: vi.fn() })
const dotenvViolations = () => [
  { reason: 'dotenv-linter', message: 'dotenv-linter знайшов порушення у .env* (text.mdc)' }
]

describe('native-fix text/run-dotenv-linter (продакшн-шлях loadT0Patterns)', () => {
  test('loadT0Patterns повертає синтетичний native-fix pattern, не fix-run-dotenv-linter.mjs', async () => {
    await withTmpDir(async dir => {
      const patterns = await patternsFor(dir)
      expect(patterns).toHaveLength(1)
      expect(patterns[0].id).toBe(`native-fix:${ruleId}/${concernId}`)
    })
  })

  test('test: чуже порушення й порожній список — false (concern іде в ladder)', async () => {
    await withTmpDir(async dir => {
      const [pattern] = await patternsFor(dir)
      expect(pattern.test([{ reason: 'v8r', message: 'm' }])).toBe(false)
      expect(pattern.test([])).toBe(false)
    })
  })

  test.skipIf(!HAS_TOOL)(
    'test: true лише коли native-план непорожній (є що фіксити) [потребує dotenv-linter у PATH]',
    async () => {
      await withTmpDir(async dir => {
        writeFileSync(join(dir, '.env'), 'b=2\nA=1\n', 'utf8')
        const [pattern] = await patternsFor(dir)
        expect(pattern.test(dotenvViolations())).toBe(true)
      })
    }
  )

  test.skipIf(!HAS_TOOL)(
    'apply: dotenv-linter fix впорядковує .env, touchedFiles — абсолютний шлях [потребує dotenv-linter у PATH]',
    async () => {
      await withTmpDir(async dir => {
        const target = join(dir, '.env')
        writeFileSync(target, 'b=2\nA=1\n', 'utf8')

        const [pattern] = await patternsFor(dir)
        const res = await pattern.apply(dotenvViolations(), ctxFor(dir))
        expect(res.touchedFiles).toEqual([target])

        // Точний набір правок залежить від версії тула; фіксуємо лише те, що
        // канонічно для dotenv-linter завжди: ключ у нижньому регістрі
        // піднято до UPPER_CASE.
        expect(readFileSync(target, 'utf8')).toContain('B=2')
      })
    }
  )

  test.skipIf(!HAS_TOOL)(
    'apply: ідемпотентність — другий прогін на впорядкованому .env нічого не чіпає [потребує dotenv-linter у PATH]',
    async () => {
      await withTmpDir(async dir => {
        writeFileSync(join(dir, '.env'), 'b=2\n', 'utf8')
        const [pattern] = await patternsFor(dir)
        const first = await pattern.apply(dotenvViolations(), ctxFor(dir))
        expect(first.touchedFiles).toHaveLength(1)

        // НОВИЙ масив violations — інакше `computeNativeFixPlan` переюзав би
        // кешований план за identity й не спитав би native-бік про диск.
        const second = await pattern.apply(dotenvViolations(), ctxFor(dir))
        expect(second.touchedFiles).toEqual([])
      })
    }
  )

  test.skipIf(!HAS_TOOL)(
    'apply: дерево без .env* — порожній план, не помилка [потребує dotenv-linter у PATH]',
    async () => {
      await withTmpDir(async dir => {
        const [pattern] = await patternsFor(dir)
        const res = await pattern.apply(dotenvViolations(), ctxFor(dir))
        expect(res.touchedFiles).toEqual([])
      })
    }
  )
})

/**
 * Парність native-fix `text/run-shellcheck` (§2.82,
 * `crates/rules-core/src/concerns/fix.rs::text_run_shellcheck_fix`) через
 * ПРОДАКШН-шлях: `loadT0Patterns` → `getNativeFixKeys()` (`listNativeFixes()`)
 * → синтетичний `nativeFixPattern` → `runNativeConcernFix` (napi). Не пряме
 * звернення до Rust-функції (§2.47).
 *
 * `fix-run-shellcheck.mjs` (JS T0) лишається на диску — політика «спершу
 * парність», — але з ключем у `NATIVE_FIXES` `loadT0Patterns` більше НІКОЛИ
 * його не імпортує.
 *
 * # Зовнішні тули — гучний skip, не тиха зелень
 *
 * Потрібні `shellcheck` І `patch`. Тести, що їх реально спавнять,
 * скіпаються ЯВНО (причина — у назві), а не роблять вигляд, що все гаразд.
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
const concernId = 'run-shellcheck'
const patternsFor = dir => loadT0Patterns(CONCERN_DIR, concernId, ruleId, dir)

const HAS_TOOLS = resolveCmd('shellcheck') !== null && resolveCmd('patch') !== null
const ctxFor = dir => ({ cwd: dir, ruleId, concernId, recordWrite: vi.fn() })
const shellcheckViolations = () => [
  { reason: 'shellcheck', message: 'shellcheck знайшов порушення у *.sh (text.mdc)' }
]

/**
 * Скрипт із зауваженням, яке shellcheck УМІЄ авто-виправити (SC2006,
 * backticks → `$(...)`) — не всяке зауваження автофіксабельне: типовий
 * `echo $foo` shellcheck узагалі не позначає, а `ls | grep` дає
 * `none were auto-fixable`, тобто порожній diff і порожній план.
 */
const FIXABLE = '#!/bin/sh\nd=`pwd`\necho "$d"\n'

describe('native-fix text/run-shellcheck (продакшн-шлях loadT0Patterns)', () => {
  test('loadT0Patterns повертає синтетичний native-fix pattern, не fix-run-shellcheck.mjs', async () => {
    await withTmpDir(async dir => {
      const patterns = await patternsFor(dir)
      expect(patterns).toHaveLength(1)
      expect(patterns[0].id).toBe(`native-fix:${ruleId}/${concernId}`)
    })
  })

  test('test: чуже порушення й порожній список — false (concern іде в ladder)', async () => {
    await withTmpDir(async dir => {
      const [pattern] = await patternsFor(dir)
      expect(pattern.test([{ reason: 'dotenv-linter', message: 'm' }])).toBe(false)
      expect(pattern.test([])).toBe(false)
    })
  })

  test.skipIf(!HAS_TOOLS)(
    'test: true лише коли native-план непорожній (є що фіксити) [потребує shellcheck і patch]',
    async () => {
      await withTmpDir(async dir => {
        writeFileSync(join(dir, 'x.sh'), FIXABLE, 'utf8')
        const [pattern] = await patternsFor(dir)
        expect(pattern.test(shellcheckViolations())).toBe(true)
      })
    }
  )

  test.skipIf(!HAS_TOOLS)(
    'apply: цикл diff+patch міняє backticks на $(), touchedFiles — абсолютний шлях [потребує shellcheck і patch]',
    async () => {
      await withTmpDir(async dir => {
        const target = join(dir, 'x.sh')
        writeFileSync(target, FIXABLE, 'utf8')

        const [pattern] = await patternsFor(dir)
        const res = await pattern.apply(shellcheckViolations(), ctxFor(dir))
        expect(res.touchedFiles).toEqual([target])
        expect(readFileSync(target, 'utf8')).toContain('d=$(pwd)')
      })
    }
  )

  test.skipIf(!HAS_TOOLS)(
    'apply: ідемпотентність — другий прогін на вже полагодженому скрипті дає 0 touchedFiles [потребує shellcheck і patch]',
    async () => {
      await withTmpDir(async dir => {
        writeFileSync(join(dir, 'x.sh'), FIXABLE, 'utf8')
        const [pattern] = await patternsFor(dir)
        const first = await pattern.apply(shellcheckViolations(), ctxFor(dir))
        expect(first.touchedFiles).toHaveLength(1)

        // НОВИЙ масив violations — інакше спрацював би identity-кеш плану.
        const second = await pattern.apply(shellcheckViolations(), ctxFor(dir))
        expect(second.touchedFiles).toEqual([])
      })
    }
  )

  test.skipIf(!HAS_TOOLS)(
    'apply: дерево без *.sh — порожній план, не помилка [потребує shellcheck і patch]',
    async () => {
      await withTmpDir(async dir => {
        const [pattern] = await patternsFor(dir)
        const res = await pattern.apply(shellcheckViolations(), ctxFor(dir))
        expect(res.touchedFiles).toEqual([])
      })
    }
  )
})

/**
 * Парність native-fix `changelog/consistency` (T4,
 * `crates/rules-core/src/concerns/fix.rs::changelog_consistency_fix`) через
 * ПРОДАКШН-шлях: `loadT0Patterns` → `getNativeFixKeys()` (`listNativeFixes()`)
 * → синтетичний `nativeFixPattern` → `runNativeConcernFix` (napi). Не пряме
 * звернення до Rust-функції (§2.47 — прямий виклик уже раз приховав
 * реальний баг мосту).
 *
 * JS-канон `fix-consistency.mjs` ЗНЯТО (§2.89): native — єдина реалізація
 * фіксу цього концерну, fallback-у більше немає. `loadT0Patterns` повертає
 * РІВНО синтетичний native-fix pattern; порожній резолв означав би, що
 * `--fix` мовчки перестав фіксити концерн (табличний гейт —
 * `npm/scripts/lib/lint-surface/tests/native-fix-single-source.test.mjs`).
 */
import { describe, expect, test, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadT0Patterns } from '../../../../scripts/lib/lint-surface/run-fix.mjs'
import { withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'

const CONCERN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const ruleId = 'changelog'
const concernId = 'consistency'
const patternsFor = dir => loadT0Patterns(CONCERN_DIR, concernId, ruleId, dir)

/** Порушення у точній формі `missing_change_file_message`. */
const missing = label => ({
  reason: 'changelog-consistency',
  message: `${label}: є релевантні зміни, але немає change-файлу (version у package.json не чіпай вручну).`,
  severity: 'error'
})

/** Репо з одним комітом і відомим subject-ом. */
function initRepo(dir, subject) {
  const git = args => execFileSync('git', args, { cwd: dir, stdio: 'pipe' })
  git(['init', '-q'])
  git(['config', 'user.email', 't@example.com'])
  git(['config', 'user.name', 't'])
  writeFileSync(join(dir, 'README.md'), 'x\n')
  git(['add', '.'])
  git(['commit', '-qm', subject])
}

describe('native-fix changelog/consistency (продакшн-шлях loadT0Patterns)', () => {
  test('loadT0Patterns повертає синтетичний native-fix pattern, не fix-consistency.mjs', async () => {
    await withTmpDir(async dir => {
      const patterns = await patternsFor(dir)
      expect(patterns).toHaveLength(1)
      expect(patterns[0].id).toBe(`native-fix:${ruleId}/${concernId}`)
    })
  })

  test('apply: створює change-файл із subject-ом останнього коміту', async () => {
    await withTmpDir(async dir => {
      initRepo(dir, 'feat: щось корисне')
      const violations = [missing('<root>')]
      const [pattern] = await patternsFor(dir)
      expect(pattern.test(violations)).toBe(true)

      const recordWrite = vi.fn()
      const res = await pattern.apply(violations, { cwd: dir, ruleId, concernId, recordWrite })
      expect(res.touchedFiles).toHaveLength(1)
      expect(recordWrite).toHaveBeenCalledWith(res.touchedFiles[0])
      expect(res.touchedFiles[0]).toMatch(/\.changes\/\d{6}-\d{4}(-\d+)?\.md$/u)
      expect(readFileSync(res.touchedFiles[0], 'utf8')).toBe(
        '---\nbump: patch\nsection: Changed\n---\nfeat: щось корисне\n'
      )
    })
  })

  test('порушення без маркера — план порожній, test() false', async () => {
    await withTmpDir(async dir => {
      const [pattern] = await patternsFor(dir)
      expect(pattern.test([{ reason: 'changelog-consistency', message: 'app: version розійшлась' }])).toBe(false)
    })
  })
})

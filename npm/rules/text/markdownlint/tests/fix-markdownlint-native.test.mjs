/**
 * Парність native-fix `text/markdownlint` (T3,
 * `crates/rules-core/src/concerns/fix.rs::text_markdownlint_fix`) через
 * ПРОДАКШН-шлях: `loadT0Patterns` → `getNativeFixKeys()` (`listNativeFixes()`)
 * → синтетичний `nativeFixPattern` → `runNativeConcernFix` (napi). Не пряме
 * звернення до Rust-функції (§2.47).
 *
 * Старий `fix-markdownlint.mjs` лишається на диску (характеризаційне
 * покриття `fix-markdownlint.test.mjs` лишається зеленим), але з
 * `text/markdownlint` у `NATIVE_FIXES` `loadT0Patterns` більше НІКОЛИ його
 * не імпортує (доккомент `loadT0Patterns`, `run-fix.mjs`) — цей файл тестує
 * ЖИВИЙ шлях.
 *
 * `markdownlint-cli2` резолвиться через `npx` з локального `node_modules/.bin`
 * репо — доступний без мережі (той самий пакет, що `text/markdownlint`
 * детектор уже спавнить, доккомент `text_markdownlint.rs`).
 */
import { describe, expect, test, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

import { loadT0Patterns } from '../../../../scripts/lib/lint-surface/run-fix.mjs'
import { withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'

const CONCERN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const ruleId = 'text'
const concernId = 'markdownlint'
const patternsFor = dir => loadT0Patterns(CONCERN_DIR, concernId, ruleId, dir)

/**
 * Ініціалізує мінімальний git-репо в `dir` і трекає `rel` — fix-фіксер
 * native-порту читає track-довані `*.md`/`*.mdc` через `git ls-files`
 * (той самий контракт, що видалений `listMarkdownFiles` у JS-каноні).
 * @param {string} dir корінь tmp-репо
 * @param {string} rel відносний шлях файла, який слід трекнути
 */
function initGitAndTrack(dir, rel) {
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['add', rel], { cwd: dir })
}

describe('native-fix text/markdownlint (продакшн-шлях loadT0Patterns)', () => {
  test('loadT0Patterns повертає синтетичний native-fix pattern, не fix-markdownlint.mjs', async () => {
    await withTmpDir(async dir => {
      const patterns = await patternsFor(dir)
      expect(patterns).toHaveLength(1)
      expect(patterns[0].id).toBe(`native-fix:${ruleId}/${concernId}`)
    })
  })

  test('apply: markdownlint-cli2 --fix переписує track-дований .md, touchedFiles — абсолютний шлях', async () => {
    await withTmpDir(async dir => {
      const target = join(dir, 'bad.md')
      const source = '# Title\nSome  text with trailing spaces   \n'
      await writeFile(target, source, 'utf8')
      initGitAndTrack(dir, 'bad.md')

      const violations = [{ reason: 'markdownlint', message: 'markdownlint знайшов порушення' }]
      const [pattern] = await patternsFor(dir)
      expect(pattern.test(violations)).toBe(true)

      const res = await pattern.apply(violations, { cwd: dir, ruleId, concernId, recordWrite: vi.fn() })
      expect(res.touchedFiles).toEqual([target])

      const rewritten = readFileSync(target, 'utf8')
      expect(rewritten).not.toBe(source)
      expect(rewritten).not.toContain('trailing spaces   \n')
    })
  })

  test('test: false без reason markdownlint — concern іде в ladder, не T0', async () => {
    await withTmpDir(async dir => {
      const [pattern] = await patternsFor(dir)
      expect(pattern.test([{ reason: 'shellcheck', message: 'm' }])).toBe(false)
      expect(pattern.test([])).toBe(false)
    })
  })

  test('apply: 0 touchedFiles, якщо репо не має track-дованих *.md/*.mdc', async () => {
    await withTmpDir(async dir => {
      execFileSync('git', ['init', '-q'], { cwd: dir })
      const violations = [{ reason: 'markdownlint', message: 'm' }]
      const [pattern] = await patternsFor(dir)
      const res = await pattern.apply(violations, { cwd: dir, ruleId, concernId, recordWrite: vi.fn() })
      expect(res.touchedFiles).toEqual([])
    })
  })
})

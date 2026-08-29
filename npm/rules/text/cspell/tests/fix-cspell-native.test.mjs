/**
 * Тести native-фіксу `text/cspell` (§2.79,
 * `crates/rules-core/src/concerns/fix_cspell_config.rs`).
 *
 * ПРОДАКШН-шлях: `loadT0Patterns` → `getNativeFixKeys()` (`listNativeFixes()`)
 * → синтетичний `nativeFixPattern` → napi, не пряме звернення до Rust-функції
 * (§2.47). Перевіряється проводка й головна гарантія концерну — merge, а не
 * перезапис: локальні `words`/`ignorePaths` мають пережити фікс (інцидент,
 * заради якого `fix-cspell.mjs` і писався).
 */
import { expect, test, vi } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadT0Patterns } from '../../../../scripts/lib/lint-surface/run-fix.mjs'
import { withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'

const CONCERN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const ruleId = 'text'
const concernId = 'cspell'
const TARGET = '.cspell.json'

/** @returns {object[]} Новий масив на кожен виклик — план кешується у WeakMap за identity. */
const violations = () => [{ ruleId, concernId, reason: 'policy-file-missing', message: 'm', file: TARGET }]
const patternsFor = dir => loadT0Patterns(CONCERN_DIR, concernId, ruleId, dir)
const read = dir => JSON.parse(readFileSync(join(dir, TARGET), 'utf8'))
const apply = (pattern, dir) => pattern.apply(violations(), { cwd: dir, ruleId, concernId, recordWrite: vi.fn() })

test('loadT0Patterns повертає синтетичний native-fix pattern, не fix-cspell.mjs', async () => {
  await withTmpDir(async dir => {
    const patterns = await patternsFor(dir)
    expect(patterns).toHaveLength(1)
    expect(patterns[0].id).toBe(`native-fix:${ruleId}/${concernId}`)
  })
})

test('файлу немає → створюється з канону template + language', async () => {
  await withTmpDir(async dir => {
    const [pattern] = await patternsFor(dir)
    expect(pattern.test(violations())).toBe(true)
    const res = await apply(pattern, dir)
    expect(res.touchedFiles).toEqual([join(dir, TARGET)])
    const cfg = read(dir)
    expect(cfg.version).toBe('0.2')
    expect(cfg.language).toBe('en,uk')
    expect(cfg.import).toEqual(['@nitra/cspell-dict'])
    expect(cfg.ignorePaths).toContain('**/node_modules/**')
  })
})

test('merge, а не перезапис: локальні words та ignorePaths виживають', async () => {
  await withTmpDir(async dir => {
    writeFileSync(
      join(dir, TARGET),
      JSON.stringify({ words: ['nitra'], ignorePaths: ['target/**'], language: 'uk' }),
      'utf8'
    )
    const [pattern] = await patternsFor(dir)
    await apply(pattern, dir)
    const cfg = read(dir)
    expect(cfg.words).toEqual(['nitra'])
    expect(cfg.ignorePaths[0]).toBe('target/**')
    expect(cfg.ignorePaths).toContain('**/.git/**')
    expect(cfg.language).toBe('uk')
    expect(cfg.version).toBe('0.2')
  })
})

test('канонічний вміст → idempotent (порожній план)', async () => {
  await withTmpDir(async dir => {
    const [first] = await patternsFor(dir)
    await apply(first, dir)
    const [pattern] = await patternsFor(dir)
    expect(pattern.test(violations())).toBe(false)
  })
})

test('JSONC-вхід більше не мовчазний no-op (дефект канону полагоджено)', async () => {
  await withTmpDir(async dir => {
    writeFileSync(join(dir, TARGET), '{\n  // локальний словник\n  "words": ["nitra"]\n}\n', 'utf8')
    const [pattern] = await patternsFor(dir)
    await apply(pattern, dir)
    const cfg = read(dir)
    expect(cfg.words).toEqual(['nitra'])
    expect(cfg.version).toBe('0.2')
  })
})

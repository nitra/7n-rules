/**
 * Тести native-фіксу `worktree/vscode_settings` (§2.74, родина
 * `createTemplateFixPattern` — `crates/rules-core/src/concerns/fix_template_merge.rs`).
 *
 * Парність доводиться через ПРОДАКШН-шлях: `loadT0Patterns` →
 * `getNativeFixKeys()` (`listNativeFixes()`) → синтетичний `nativeFixPattern`
 * → `runNativeConcernFix` (napi), не прямим зверненням до Rust-функції (§2.47).
 *
 * Цей файл — «репрезентативний» для всієї пʼятірки конфігів: рушій один
 * (`template_merge_fix`), тож ТУТ покриті всі три свідомі відхилення від
 * JS-канону (доккомент `fix_template_merge.rs`), а тести сусідніх чотирьох
 * концернів перевіряють лише власну проводку (target/snippet).
 *
 * JS-канон `fix-vscode_settings.mjs` лишається на диску (політика «спершу
 * парність») разом зі своїм тестом `fix-vscode_settings.test.mjs`, але з
 * ключем у `NATIVE_FIXES` `loadT0Patterns` більше НІКОЛИ його не імпортує.
 */
import { expect, test, vi } from 'vitest'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadT0Patterns } from '../../../../scripts/lib/lint-surface/run-fix.mjs'
import { withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'

const CONCERN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const ruleId = 'worktree'
const concernId = 'vscode_settings'
const TARGET = '.vscode/settings.json'
const SNIPPET = readFileSync(join(CONCERN_DIR, 'template', 'settings.json.snippet.json'), 'utf8')

/**
 * НОВИЙ масив на кожен виклик — `computeNativeFixPlan` кешує план у
 * `WeakMap` під identity масиву violations (щоб `test()` і `apply()` одного
 * проходу не робили другий napi-hop). Спільна константа на всі тести дала б
 * той самий кешований план для різних фікстур.
 * @returns {object[]} Один violation про цільовий файл.
 */
const violations = () => [{ ruleId, concernId, reason: 'policy-template-mismatch', message: 'm', file: TARGET }]
const patternsFor = dir => loadT0Patterns(CONCERN_DIR, concernId, ruleId, dir)
const seed = (dir, text) => {
  mkdirSync(join(dir, '.vscode'), { recursive: true })
  writeFileSync(join(dir, TARGET), text, 'utf8')
}
const read = dir => readFileSync(join(dir, TARGET), 'utf8')
const apply = (pattern, dir) => pattern.apply(violations(), { cwd: dir, ruleId, concernId, recordWrite: vi.fn() })

test('loadT0Patterns повертає синтетичний native-fix pattern, не fix-vscode_settings.mjs', async () => {
  await withTmpDir(async dir => {
    const patterns = await patternsFor(dir)
    expect(patterns).toHaveLength(1)
    expect(patterns[0].id).toBe(`native-fix:${ruleId}/${concernId}`)
  })
})

test('файлу немає → snippet копіюється байт-у-байт', async () => {
  await withTmpDir(async dir => {
    const [pattern] = await patternsFor(dir)
    expect(pattern.test(violations())).toBe(true)
    const res = await apply(pattern, dir)
    expect(res.touchedFiles).toEqual([join(dir, TARGET)])
    expect(read(dir)).toBe(SNIPPET)
  })
})

test('канонічний вміст → idempotent (порожній план, concern іде в ladder)', async () => {
  await withTmpDir(async dir => {
    seed(dir, SNIPPET)
    const [pattern] = await patternsFor(dir)
    expect(pattern.test(violations())).toBe(false)
    expect((await apply(pattern, dir)).touchedFiles).toHaveLength(0)
  })
})

test('локальні ключі виживають при домерджуванні', async () => {
  await withTmpDir(async dir => {
    seed(dir, '{\n  "editor.tabSize": 2\n}\n')
    const [pattern] = await patternsFor(dir)
    await apply(pattern, dir)
    const written = JSON.parse(read(dir))
    expect(written['editor.tabSize']).toBe(2)
    expect(written['search.exclude']['**/.worktrees/**']).toBe(true)
    expect(written['files.exclude']['**/.worktrees/**']).toBe(true)
  })
})

test('violation про чужий файл → патерн незастосовний', async () => {
  await withTmpDir(async dir => {
    const [pattern] = await patternsFor(dir)
    expect(pattern.test([{ ruleId, concernId, reason: 'r', message: 'm', file: 'інше.json' }])).toBe(false)
    expect(pattern.test([])).toBe(false)
  })
})

// ── Три свідомі відхилення від JS-канону (доккомент fix_template_merge.rs) ──

test('ВІДХИЛЕННЯ 1: JSONC-вхід мерджиться, коментарі виживають (канон тихо не фіксив)', async () => {
  await withTmpDir(async dir => {
    seed(dir, '{\n  // локальний коментар користувача\n  "editor.tabSize": 2,\n}\n')
    const [pattern] = await patternsFor(dir)
    expect(pattern.test(violations())).toBe(true)
    expect((await apply(pattern, dir)).touchedFiles).toHaveLength(1)
    const text = read(dir)
    expect(text).toContain('// локальний коментар користувача')
    expect(text).toContain('search.exclude')
  })
})

test('ВІДХИЛЕННЯ 2: не-обʼєктний корінь не знищується (канон тихо затирав)', async () => {
  await withTmpDir(async dir => {
    seed(dir, '[1, 2, 3]\n')
    const [pattern] = await patternsFor(dir)
    expect(pattern.test(violations())).toBe(false)
    expect(read(dir)).toBe('[1, 2, 3]\n')
  })
})

test('побитий синтаксис → файл не чіпається (той самий контракт, що канон)', async () => {
  await withTmpDir(async dir => {
    seed(dir, '{ не json')
    const [pattern] = await patternsFor(dir)
    expect(pattern.test(violations())).toBe(false)
    expect(read(dir)).toBe('{ не json')
  })
})

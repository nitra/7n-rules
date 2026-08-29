/**
 * Тести native-фіксу `worktree/zed_settings` (§2.74, родина
 * `createTemplateFixPattern` — `crates/rules-core/src/concerns/fix_template_merge.rs`).
 *
 * Проводка одного з пʼяти конфігів ОДНОГО рушія: перевіряється, що
 * `loadT0Patterns` віддає синтетичний native-патерн замість `fix-zed_settings.mjs`,
 * і що патерн резолвить ВЛАСНИЙ target/snippet цього концерну. Поведінка
 * самого рушія (idempotent, JSONC-вхід, не-обʼєктний корінь, побитий
 * синтаксис) покрита один раз у
 * `npm/rules/worktree/vscode_settings/tests/fix-vscode_settings-native.test.mjs`
 * — дублювати її на кожен конфіг немає сенсу, це той самий Rust-код.
 *
 * Шлях — ПРОДАКШН (`loadT0Patterns` → `listNativeFixes()` →
 * `nativeFixPattern` → napi), не пряме звернення до Rust-функції (§2.47).
 */
import { expect, test, vi } from 'vitest'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadT0Patterns } from '../../../../scripts/lib/lint-surface/run-fix.mjs'
import { withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'

const CONCERN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const ruleId = 'worktree'
const concernId = 'zed_settings'
const TARGET = '.zed/settings.json'
const SNIPPET = readFileSync(join(CONCERN_DIR, 'template', 'settings.json.snippet.json'), 'utf8')

/**
 * НОВИЙ масив на кожен виклик — `computeNativeFixPlan` кешує план у `WeakMap`
 * під identity масиву violations, тож спільна константа дала б різним
 * фікстурам той самий кешований план.
 * @returns {object[]} Один violation про цільовий файл.
 */
const violations = () => [{ ruleId, concernId, reason: 'policy-template-mismatch', message: 'm', file: TARGET }]
const patternsFor = dir => loadT0Patterns(CONCERN_DIR, concernId, ruleId, dir)
const read = dir => readFileSync(join(dir, TARGET), 'utf8')
const apply = (pattern, dir) => pattern.apply(violations(), { cwd: dir, ruleId, concernId, recordWrite: vi.fn() })

test('loadT0Patterns повертає синтетичний native-fix pattern, не fix-zed_settings.mjs', async () => {
  await withTmpDir(async dir => {
    const patterns = await patternsFor(dir)
    expect(patterns).toHaveLength(1)
    expect(patterns[0].id).toBe(`native-fix:${ruleId}/${concernId}`)
  })
})

test('файлу немає → власний snippet концерну копіюється байт-у-байт', async () => {
  await withTmpDir(async dir => {
    const [pattern] = await patternsFor(dir)
    expect(pattern.test(violations())).toBe(true)
    const res = await apply(pattern, dir)
    expect(res.touchedFiles).toEqual([join(dir, TARGET)])
    expect(read(dir)).toBe(SNIPPET)
  })
})

test('канонічний вміст → idempotent (порожній план)', async () => {
  await withTmpDir(async dir => {
    mkdirSync(dirname(join(dir, TARGET)), { recursive: true })
    writeFileSync(join(dir, TARGET), SNIPPET, 'utf8')
    const [pattern] = await patternsFor(dir)
    expect(pattern.test(violations())).toBe(false)
  })
})

test('домерджування у наявний конфіг: канон додано, локальне збережено', async () => {
  await withTmpDir(async dir => {
    mkdirSync(dirname(join(dir, TARGET)), { recursive: true })
    writeFileSync(join(dir, TARGET), '{\n  "file_scan_exclusions": ["**/.git", "**/custom"]\n}\n', 'utf8')
    const [pattern] = await patternsFor(dir)
    expect((await apply(pattern, dir)).touchedFiles).toHaveLength(1)
    const written = JSON.parse(read(dir))
    expect(written.file_scan_exclusions).toEqual(expect.arrayContaining(['**/.claude/worktrees', '**/custom']))
    expect(written.file_scan_exclusions.filter(x => x === '**/.git').length).toBe(1)
  })
})

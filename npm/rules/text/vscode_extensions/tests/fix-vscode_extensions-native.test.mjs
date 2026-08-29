/**
 * Парність native-fix родини `vscode_extensions` (T5, §2.75 —
 * `crates/rules-core/src/concerns/fix_vscode_extensions.rs`) через
 * ПРОДАКШН-шлях: `loadT0Patterns` → `getNativeFixKeys()` (`listNativeFixes()`)
 * → синтетичний `nativeFixPattern` → `runNativeConcernFix` (napi). Не пряме
 * звернення до Rust-функції (§2.47 — прямий виклик уже раз приховав реальний
 * баг мосту).
 *
 * `fix-vscode_extensions.mjs` (одно рядковий реекспорт спільного рушія
 * `npm/scripts/lib/fix/vscode-ext-add.mjs`) лишається на диску — політика
 * «спершу парність», — але з `text/vscode_extensions` у `NATIVE_FIXES`
 * `loadT0Patterns` повертає РІВНО синтетичний native-fix pattern і більше
 * ніколи його не імпортує; цей файл тестує ЖИВИЙ шлях.
 *
 * `text` — представник трьох концернів родини, що МАЛИ канонічний снапшот
 * (`doc-files`, `rego`, `text`); представник двох, що його не мали
 * (`graphql`, `tauri` — вічний no-op канону), тестується окремо в
 * `npm/rules/graphql/vscode_extensions/tests/`.
 */
import { describe, expect, test, vi } from 'vitest'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadT0Patterns } from '../../../../scripts/lib/lint-surface/run-fix.mjs'
import { withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'

const CONCERN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const ruleId = 'text'
const concernId = 'vscode_extensions'
const TARGET = '.vscode/extensions.json'
const CANONICAL = ['DavidAnson.vscode-markdownlint', 'oxc.oxc-vscode', 'timonwong.shellcheck']

const patternsFor = dir => loadT0Patterns(CONCERN_DIR, concernId, ruleId, dir)

/** Порушення у точній формі, яку дає policy-адаптер для rego-deny. */
const deny = ext => ({
  reason: 'policy-deny',
  message: `${TARGET}: recommendations має містити "${ext}" (text.mdc)`,
  file: TARGET,
  severity: 'error'
})

/** Записує ціль (з батьківською текою) і повертає її абсолютний шлях. */
function writeTarget(dir, content) {
  mkdirSync(join(dir, '.vscode'), { recursive: true })
  writeFileSync(join(dir, TARGET), content, 'utf8')
  return join(dir, TARGET)
}

const recsOf = abs => JSON.parse(readFileSync(abs, 'utf8')).recommendations

describe('native-fix text/vscode_extensions (продакшн-шлях loadT0Patterns)', () => {
  test('loadT0Patterns повертає синтетичний native-fix pattern, не fix-vscode_extensions.mjs', async () => {
    await withTmpDir(async dir => {
      const patterns = await patternsFor(dir)
      expect(patterns).toHaveLength(1)
      expect(patterns[0].id).toBe(`native-fix:${ruleId}/${concernId}`)
    })
  })

  test('apply: файлу немає — створює його з канонічними рекомендаціями', async () => {
    await withTmpDir(async dir => {
      const violations = [deny(CANONICAL[0])]
      const [pattern] = await patternsFor(dir)
      expect(pattern.test(violations)).toBe(true)

      const recordWrite = vi.fn()
      const res = await pattern.apply(violations, { cwd: dir, ruleId, concernId, recordWrite })
      expect(res.touchedFiles).toEqual([join(dir, TARGET)])
      expect(recordWrite).toHaveBeenCalledWith(res.touchedFiles[0])
      expect(recsOf(res.touchedFiles[0])).toEqual(CANONICAL)
      // Той самий формат, що `JSON.stringify(parsed, null, 2) + '\n'` канону.
      expect(readFileSync(res.touchedFiles[0], 'utf8').endsWith('\n')).toBe(true)
    })
  })

  test('apply: наявний файл — union, локальні ключі й порядок збережені', async () => {
    await withTmpDir(async dir => {
      const abs = writeTarget(
        dir,
        JSON.stringify({ unwantedRecommendations: ['foo.bar'], recommendations: ['local.ext'] })
      )
      const violations = [deny(CANONICAL[0])]
      const [pattern] = await patternsFor(dir)
      await pattern.apply(violations, { cwd: dir, ruleId, concernId })
      expect(recsOf(abs)).toEqual(['local.ext', ...CANONICAL])
      expect(JSON.parse(readFileSync(abs, 'utf8')).unwantedRecommendations).toEqual(['foo.bar'])
    })
  })

  test('вже канонічний файл — test() false (порожній план, повторний прогін нічого не пише)', async () => {
    await withTmpDir(async dir => {
      writeTarget(dir, JSON.stringify({ recommendations: CANONICAL }))
      const [pattern] = await patternsFor(dir)
      expect(pattern.test([deny(CANONICAL[0])])).toBe(false)
    })
  })

  test('порушення чужого концерну — test() false', async () => {
    await withTmpDir(async dir => {
      const [pattern] = await patternsFor(dir)
      expect(pattern.test([{ reason: 'policy-deny', message: 'зовсім інша політика' }])).toBe(false)
    })
  })

  /**
   * Дефект канону №1 (доккомент `fix_vscode_extensions.rs`): `//`-коментар у
   * `.vscode/extensions.json` — легальний JSONC, який VS Code читає, а
   * `JSON.parse` канону кидав → мовчазний no-op. Native читає JSONC: локальні
   * дані виживають, канон домержено. Форматування (сам коментар) при цьому
   * чесно втрачається — рушій завжди регенерує вивід.
   */
  test('JSONC-вхід із коментарем: канон домержено без втрати даних', async () => {
    await withTmpDir(async dir => {
      const abs = writeTarget(
        dir,
        '{\n  // локальний коментар\n  "recommendations": ["local.ext"]\n}\n'
      )
      const violations = [deny(CANONICAL[0])]
      const [pattern] = await patternsFor(dir)
      expect(pattern.test(violations)).toBe(true)
      await pattern.apply(violations, { cwd: dir, ruleId, concernId })
      expect(recsOf(abs)).toEqual(['local.ext', ...CANONICAL])
    })
  })

  test('справді побитий вміст — план порожній, файл не чіпаємо', async () => {
    await withTmpDir(async dir => {
      const abs = writeTarget(dir, '{ not valid json')
      const [pattern] = await patternsFor(dir)
      expect(pattern.test([deny(CANONICAL[0])])).toBe(false)
      expect(readFileSync(abs, 'utf8')).toBe('{ not valid json')
    })
  })
})

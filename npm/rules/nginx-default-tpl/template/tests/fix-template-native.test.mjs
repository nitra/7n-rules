/**
 * Тести T0-фіксу `nginx-default-tpl/template` (T3, структурний клас,
 * `crates/rules-core/src/concerns/fix.rs::nginx_default_tpl_template_fix`).
 *
 * `fix-template.mjs` НЕ мав власного тестового файла до цієї хвилі —
 * обов'язковий крок «характеризаційний гейт перед портом» тут ЗБІГАЄТЬСЯ з
 * порт-тестом: немає окремого JS-канон-тесту, який мав би лишитись зеленим,
 * тож цей файл одразу і фіксує поведінку, і доводить парність через
 * ПРОДАКШН-шлях: `loadT0Patterns` → `getNativeFixKeys()` (`listNativeFixes()`)
 * → синтетичний `nativeFixPattern` → `runNativeConcernFix` (napi), не пряме
 * звернення до Rust-функції (§2.47).
 *
 * JS-канон `fix-template.mjs` ЗНЯТО (§2.89): native — єдина реалізація фіксу,
 * fallback-у більше немає (табличний гейт складу резолву —
 * `npm/scripts/lib/lint-surface/tests/native-fix-single-source.test.mjs`).
 */
import { describe, expect, test, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadT0Patterns } from '../../../../scripts/lib/lint-surface/run-fix.mjs'
import { withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'

const CONCERN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const ruleId = 'nginx-default-tpl'
const concernId = 'template'
const patternsFor = dir => loadT0Patterns(CONCERN_DIR, concernId, ruleId, dir)

describe('native-fix nginx-default-tpl/template (продакшн-шлях loadT0Patterns)', () => {
  test('loadT0Patterns повертає синтетичний native-fix pattern, не fix-template.mjs', async () => {
    await withTmpDir(async dir => {
      const patterns = await patternsFor(dir)
      expect(patterns).toHaveLength(1)
      expect(patterns[0].id).toBe(`native-fix:${ruleId}/${concernId}`)
    })
  })

  test('apply: default.tpl.conf без сусіда → перейменування на default.conf.template', async () => {
    await withTmpDir(async dir => {
      const webDir = join(dir, 'web')
      await mkdir(webDir, { recursive: true })
      const oldPath = join(webDir, 'default.tpl.conf')
      await writeFile(oldPath, 'server_tokens off;\n', 'utf8')

      const violations = [
        {
          reason: 'default-tpl-conf-legacy-name',
          message: 'web/default.tpl.conf: застарілий файл',
          file: 'web/default.tpl.conf',
          data: { kind: 'default-tpl-conf-legacy-name' }
        }
      ]
      const [pattern] = await patternsFor(dir)
      expect(pattern.test(violations)).toBe(true)

      const res = await pattern.apply(violations, { cwd: dir, ruleId, concernId, recordWrite: vi.fn() })
      const newPath = join(webDir, 'default.conf.template')
      expect(res.touchedFiles.sort()).toEqual([newPath, oldPath].sort())
      expect(existsSync(oldPath)).toBe(false)
      expect(readFileSync(newPath, 'utf8')).toBe('server_tokens off;\n')
    })
  })

  test('apply: default.tpl.conf з наявним default.conf.template → перезапис і видалення старого', async () => {
    await withTmpDir(async dir => {
      const oldPath = join(dir, 'default.tpl.conf')
      const newPath = join(dir, 'default.conf.template')
      await writeFile(oldPath, 'NEW CONTENT\n', 'utf8')
      await writeFile(newPath, 'OLD\n', 'utf8')

      const violations = [
        {
          reason: 'default-tpl-conf-legacy-name',
          message: 'default.tpl.conf: застарілий файл',
          file: 'default.tpl.conf',
          data: { kind: 'default-tpl-conf-legacy-name' }
        }
      ]
      const [pattern] = await patternsFor(dir)
      const res = await pattern.apply(violations, { cwd: dir, ruleId, concernId, recordWrite: vi.fn() })
      expect(res.touchedFiles.sort()).toEqual([newPath, oldPath].sort())
      expect(existsSync(oldPath)).toBe(false)
      expect(readFileSync(newPath, 'utf8')).toBe('NEW CONTENT\n')
    })
  })

  test('apply: error_log off; → error_log /dev/null crit; у default.conf.template', async () => {
    await withTmpDir(async dir => {
      const target = join(dir, 'default.conf.template')
      await writeFile(target, 'server {\n  error_log off;\n}\n', 'utf8')

      const violations = [
        {
          reason: 'error-log-off-directive',
          message: 'default.conf.template: невалідна директива',
          file: 'default.conf.template',
          data: { kind: 'error-log-off-directive' }
        }
      ]
      const [pattern] = await patternsFor(dir)
      expect(pattern.test(violations)).toBe(true)

      const res = await pattern.apply(violations, { cwd: dir, ruleId, concernId, recordWrite: vi.fn() })
      expect(res.touchedFiles).toEqual([target])
      expect(readFileSync(target, 'utf8')).toBe('server {\n  error_log /dev/null crit;\n}\n')
    })
  })

  test('test: false без відповідних violations — concern іде в ladder, не T0', async () => {
    await withTmpDir(async dir => {
      const [pattern] = await patternsFor(dir)
      expect(pattern.test([{ reason: 'other', message: 'm' }])).toBe(false)
      expect(pattern.test([])).toBe(false)
    })
  })
})

/**
 * Тести правила doc-files.mdc (concern marksman_config): детектор відсутнього `.marksman.toml`
 * і T0-патерн копіювання canonical baseline.
 *
 * Детектор — через `runConcernDetector` (dispatch-рівень), не пряма функція: JS
 * `main.mjs` видалений (F2 фази 5 батчу 2), concern тепер живе лише в
 * `crates/rules-core/src/concerns/marksman_config.rs` і виконується через
 * native-гілку `runConcernDetector`. T0-фіксер (`fix-marksman_config.mjs`)
 * лишається JS (копіювання canonical baseline поза native-поверхнею) і
 * тестується напряму, як і раніше.
 */
import { describe, expect, test } from 'vitest'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { runConcernDetector } from '../../../../scripts/lib/lint-surface/detect.mjs'
import { patterns } from '../fix-marksman_config.mjs'
import { withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'

/** Абсолютний шлях теки концерну (тека з `concern.json`, без main.mjs — native-порт). */
const CONCERN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const CONCERN = { dir: CONCERN_DIR }

// Короткий формат ruleId/concernId — узгоджений з `NATIVE_CONCERNS` (`doc-files/marksman_config`).
const ruleId = 'doc-files'
const concernId = 'marksman_config'
const lint = ctx => runConcernDetector(CONCERN, ctx)

const CORE_SECTION_RE = /^\[core\]/m
const COMPLETION_SECTION_RE = /^\[completion\]/m
const CODE_ACTION_SECTION_RE = /^\[code_action\]/m
const BROKEN_INSTALL_RE = /інсталяція @7n\/rules пошкоджена/

describe('lint doc-files.marksman_config', () => {
  test('violation коли .marksman.toml відсутній', async () => {
    await withTmpDir(async dir => {
      const { violations } = await lint({ cwd: dir, ruleId, concernId, files: undefined })
      expect(violations).toHaveLength(1)
      expect(violations[0].data?.kind).toBe('marksman-config-missing')
    })
  })

  test('чисто коли .marksman.toml існує', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, '.marksman.toml'), '# custom\n')
      const { violations } = await lint({ cwd: dir, ruleId, concernId, files: undefined })
      expect(violations).toHaveLength(0)
    })
  })
})

describe('T0 fix doc-files.marksman_config', () => {
  const pattern = patterns.find(p => p.id === 'doc-files-marksman-config-missing')

  test('pattern існує', () => {
    expect(pattern).toBeDefined()
  })

  test('копіює baseline і повертає touchedFiles', async () => {
    await withTmpDir(async dir => {
      const violations = [{ reason: 'marksman-config-missing', message: '', data: { kind: 'marksman-config-missing' } }]
      const ctx = { cwd: dir, ruleId, concernId }
      const result = await pattern.apply(violations, ctx)
      const target = join(dir, '.marksman.toml')
      expect(existsSync(target)).toBe(true)
      expect(result.touchedFiles).toHaveLength(1)
      expect(result.touchedFiles[0]).toBe(target)
      const content = await readFile(target, 'utf8')
      expect(content).toMatch(CORE_SECTION_RE)
      expect(content).toMatch(COMPLETION_SECTION_RE)
      expect(content).toMatch(CODE_ACTION_SECTION_RE)
    })
  })

  test('після T0 lint повертає 0 violations', async () => {
    await withTmpDir(async dir => {
      const violations = [{ reason: 'marksman-config-missing', message: '', data: { kind: 'marksman-config-missing' } }]
      await pattern.apply(violations, { cwd: dir, ruleId, concernId })
      const { violations: after } = await lint({ cwd: dir, ruleId, concernId, files: undefined })
      expect(after).toHaveLength(0)
    })
  })

  test('idempotency: існуючий файл не перетирається', async () => {
    await withTmpDir(async dir => {
      const target = join(dir, '.marksman.toml')
      const customContent = '# user-customized\n[core]\nmarkdown.glfm = false\n'
      await writeFile(target, customContent)
      // lint має бути чистим — файл вже існує
      const { violations } = await lint({ cwd: dir, ruleId, concernId, files: undefined })
      expect(violations).toHaveLength(0)
      // вміст не змінився
      expect(await readFile(target, 'utf8')).toBe(customContent)
    })
  })
})

describe('JS vs native: install-sanity baseline-check не портований (F2 фази 5 батчу 2)', () => {
  // Стара JS-версія `main.mjs` (до видалення) мала гілку ДО перевірки target:
  // якщо `MARKSMAN_BASELINE_PATH` (canonical baseline, що постачається разом
  // із пакетом `@7n/rules`) відсутній на диску — детектор одразу видавав
  // окреме дружнє порушення `canonical baseline не знайдено (...) — перевстанови
  // @7n/rules` і завершувався, НЕ доходячи до перевірки `.marksman.toml` у cwd.
  // Native-порт (`crates/rules-core/src/concerns/marksman_config.rs`) цю гілку
  // свідомо не портує — задокументовано в doc-комент модуля: це install-sanity-check
  // package-layout-у npm-пакета (властивість того, ДЕ й ЯК встановлений
  // `@7n/rules`), не властивість `cwd`-репозиторію, який лінтиться. Native-бінар
  // компілюється й публікується окремо і не знає, де на диску лежить `npm/rules/`
  // consumer-репо, тож відтворити цю перевірку на native-стороні неможливо.
  //
  // Розбіжність виявляється лише в рідкісному сценарії зламаної інсталяції пакета
  // (`data/marksman_config/marksman.baseline.toml` відсутній — напр. пошкоджений
  // `npm publish`/`files` whitelist чи вручну обрізаний `node_modules`), не в
  // звичайному lint-прогоні по чистому cwd. Успадкований guard тепер живе на
  // JS-боці T0-фіксу (`fix-marksman_config.mjs`): саме там відомий шлях baseline
  // всередині пакета, і саме там ENOENT перетворюється на дружнє повідомлення
  // «перевстанови пакет» (тест нижче).
  test('T0 apply() дає дружнє повідомлення про зламану інсталяцію, коли canonical baseline відсутній', async () => {
    const baselinePath = join(CONCERN_DIR, 'data', 'marksman_config', 'marksman.baseline.toml')
    const backupPath = `${baselinePath}.test-backup`
    await rename(baselinePath, backupPath)
    try {
      await withTmpDir(async dir => {
        const pattern = patterns.find(p => p.id === 'doc-files-marksman-config-missing')
        const violations = [
          { reason: 'marksman-config-missing', message: '', data: { kind: 'marksman-config-missing' } }
        ]
        await expect(pattern.apply(violations, { cwd: dir, ruleId, concernId })).rejects.toThrow(BROKEN_INSTALL_RE)
      })
    } finally {
      // Відновлюємо canonical baseline незалежно від результату тесту.
      await rename(backupPath, baselinePath)
    }
  })
})

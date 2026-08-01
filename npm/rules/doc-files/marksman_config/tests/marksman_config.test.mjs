/**
 * Тести правила doc-files.mdc (concern marksman_config): детектор відсутнього `.marksman.toml`
 * і T0-фікс копіювання canonical baseline.
 *
 * Детектор — через `runConcernDetector` (dispatch-рівень), не пряма функція: JS
 * `main.mjs` видалений (F2 фази 5 батчу 2), concern тепер живе лише в
 * `crates/rules-core/src/concerns/marksman_config.rs` і виконується через
 * native-гілку `runConcernDetector`.
 *
 * T0-фікс (T1 зрізу 4 фази 7): `fix-marksman_config.mjs` теж видалений — логіка
 * копіювання baseline тепер у `crates/rules-core/src/concerns/fix.rs`
 * (`run_concern_fix`), а JS-бік отримує синтетичний T0Pattern через
 * `loadT0Patterns` (`run-fix.mjs`, реєстр `NATIVE_FIXES`). Тести нижче
 * дзеркалять старі кейси через ЦЮ обгортку, не пряму функцію concern-а.
 */
import { describe, expect, test } from 'vitest'
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { runConcernDetector } from '../../../../scripts/lib/lint-surface/detect.mjs'
import { loadT0Patterns } from '../../../../scripts/lib/lint-surface/run-fix.mjs'
import { createSnapshot } from '../../../../scripts/lib/lint-surface/snapshot.mjs'
import { withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'

/** Абсолютний шлях теки концерну (тека з `concern.json`, без main.mjs/fix-*.mjs — native-порт). */
const CONCERN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const CONCERN = { dir: CONCERN_DIR }

// Короткий формат ruleId/concernId — узгоджений з `NATIVE_CONCERNS`/`NATIVE_FIXES` (`doc-files/marksman_config`).
const ruleId = 'doc-files'
const concernId = 'marksman_config'
const NATIVE_FIX_KEY = `${ruleId}/${concernId}`
const lint = ctx => runConcernDetector(CONCERN, ctx)
/** Резолвить синтетичний T0Pattern для `dir` (той самий, що бере реальний fix-pipeline). */
const patternsFor = dir => loadT0Patterns(CONCERN_DIR, concernId, ruleId, dir)

const CORE_SECTION_RE = /^\[core\]/m
const COMPLETION_SECTION_RE = /^\[completion\]/m
const CODE_ACTION_SECTION_RE = /^\[code_action\]/m
const MISSING_VIOLATION = [
  { reason: 'marksman-config-missing', message: '', data: { kind: 'marksman-config-missing' } }
]

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

describe('T0 fix doc-files.marksman_config (native-fix обгортка)', () => {
  test('loadT0Patterns повертає синтетичний native-fix pattern', async () => {
    await withTmpDir(async dir => {
      const patterns = await patternsFor(dir)
      expect(patterns).toHaveLength(1)
      expect(patterns[0].id).toBe(`native-fix:${NATIVE_FIX_KEY}`)
    })
  })

  test('test(): true за наявності marksman-config-missing, false інакше', async () => {
    await withTmpDir(async dir => {
      const [pattern] = await patternsFor(dir)
      expect(pattern.test(MISSING_VIOLATION)).toBe(true)
      expect(pattern.test([])).toBe(false)
      expect(pattern.test([{ reason: 'other', message: 'm' }])).toBe(false)
    })
  })

  test('копіює baseline і повертає touchedFiles (абсолютний шлях)', async () => {
    await withTmpDir(async dir => {
      const [pattern] = await patternsFor(dir)
      const ctx = { cwd: dir, ruleId, concernId, recordWrite: () => {} }
      const result = await pattern.apply(MISSING_VIOLATION, ctx)
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
      const [pattern] = await patternsFor(dir)
      await pattern.apply(MISSING_VIOLATION, { cwd: dir, ruleId, concernId, recordWrite: () => {} })
      const { violations: after } = await lint({ cwd: dir, ruleId, concernId, files: undefined })
      expect(after).toHaveLength(0)
    })
  })

  test('idempotency: існуючий файл не перетирається (detect уже чистий, apply не викликається)', async () => {
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

  test('rollback-контракт: ctx.recordWrite викликається ДО запису — знята pre-image дає коректний rollback', async () => {
    await withTmpDir(async dir => {
      const target = join(dir, '.marksman.toml')
      const snapshot = createSnapshot()
      const [pattern] = await patternsFor(dir)

      let existedAtRecordWriteTime = null
      const ctx = {
        cwd: dir,
        ruleId,
        concernId,
        recordWrite: absPath => {
          // Перевіряємо ПОРЯДОК: у момент виклику recordWrite файл ще НЕ
          // записаний — інакше знята pre-image була б уже НОВИМ вмістом,
          // і rollback не зміг би повернути стан «файл відсутній».
          existedAtRecordWriteTime = existsSync(absPath)
          snapshot.record(absPath)
        }
      }
      expect(existsSync(target)).toBe(false)
      await pattern.apply(MISSING_VIOLATION, ctx)
      expect(existedAtRecordWriteTime).toBe(false)
      expect(existsSync(target)).toBe(true)

      snapshot.rollback()
      // Pre-image була «відсутній» → rollback видаляє щойно створений файл.
      expect(existsSync(target)).toBe(false)
    })
  })
})

describe('зміна семантики: install-guard недосяжний у native-фіксі (T1 зрізу 4 фази 7)', () => {
  // Стара JS-версія `fix-marksman_config.mjs` (до видалення) перевіряла
  // `existsSync(MARKSMAN_BASELINE_PATH)` ПЕРЕД копіюванням і кидала дружню
  // помилку «інсталяція @7n/rules пошкоджена, перевстанови пакет», якщо
  // canonical baseline був відсутній на диску (пошкоджений npm-пакет: обрізаний
  // `files`-whitelist чи вручну зіпсований `node_modules`).
  //
  // Native-фікс (`crates/rules-core/src/concerns/fix.rs::marksman_config_fix`)
  // вбудовує baseline у бінарник через `include_str!` НА ЕТАПІ КОМПІЛЯЦІЇ —
  // сам файл стає частиною cdylib/бінаря, а не окремим on-disk-артефактом,
  // який можна «загубити» під час встановлення npm-пакета. Клас помилки
  // «baseline відсутній на диску» структурно неможливий для native-шляху:
  // якщо аддон завантажився (пройшла звірка `contractVersion`), baseline
  // ГАРАНТОВАНО є. Install-guard і його повідомлення «перевстанови пакет»
  // НЕ портуються — немає стану, який вони мали б ловити. Це свідома зміна
  // поведінки зламаної інсталяції (доккомент модуля `fix.rs`, секція «Зміна
  // семантики»), не забутий кейс: цей тест документує нову поведінку замість
  // старого `rejects.toThrow(BROKEN_INSTALL_RE)`.
  test('apply() успішно копіює baseline незалежно від стану npm-пакета на диску (baseline вшитий у native)', async () => {
    await withTmpDir(async dir => {
      const [pattern] = await patternsFor(dir)
      // На відміну від старої JS-версії, тут НЕМА диску-артефакту, який можна
      // видалити, щоб відтворити «зламану інсталяцію» — baseline вшитий у
      // скомпільований native-аддон. Просто перевіряємо: apply() не кидає.
      await expect(
        pattern.apply(MISSING_VIOLATION, { cwd: dir, ruleId, concernId, recordWrite: () => {} })
      ).resolves.toMatchObject({ touchedFiles: [join(dir, '.marksman.toml')] })
    })
  })
})

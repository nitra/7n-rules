/**
 * Тести concern-а `tauri/gitignore_target` (tauri.mdc):
 *   - без жодного `src-tauri/Cargo.toml` правило не активується;
 *   - Tauri-воркспейс + відсутній запис у `.gitignore` → violation missing-gitignore-target-entries;
 *   - точний канонічний запис присутній → чисто;
 *   - typo-подібний запис (`owner/target/` замість `owner/src-tauri/target/`) не закриває violation
 *     (не false negative на реальному інциденті);
 *   - монорепо з кількома `src-tauri/` і лише частиною записів у `.gitignore` → у missing лише відсутні;
 *   - `.gitignore` відсутній повністю → violation з повним переліком;
 *   - очікуваний запис обчислюється від фактичного Cargo workspace root крейту (product-root і
 *     repo-root ancestor workspace-кейси), а не завжди від фіксованого суфікса `src-tauri/target/`;
 *   - substring у `.gitignore` не рахується присутністю (лише точний рядок);
 *   - T0-фікс вставляє новий блок, ідемпотентно;
 *   - T0-фікс дописує запис у вже наявну секцію поруч з іншими entries, зберігаючи оточення.
 *
 * Детектор — через `runConcernDetector` (dispatch-рівень), не пряма функція: JS
 * `main.mjs` видалений (G2 фази 5 батчу 3, TOML-кластер), concern тепер живе
 * лише в `crates/rules-core/src/concerns/tauri_gitignore_target.rs` і
 * виконується через native-гілку `runConcernDetector`. Пряме юніт-тестування
 * колишніх pure-функцій `expectedTargetEntry`/`findMissingEntries` (вони більше
 * не експортуються з JS) замінене на детектор-рівневі сценарії з тими самими
 * fixture-ами — еквівалентне покриття лишається і в native-юніт-тестах самого
 * порту (`tauri_gitignore_target.rs`, той самий модуль).
 *
 * T0-фікс (T2 зрізу 5 фази 7): JS `fix-gitignore_target.mjs` теж видалений —
 * splice-логіка `insertMissingTargetEntries` тепер у
 * `crates/rules-core/src/concerns/fix.rs` (`run_concern_fix`), а JS-бік
 * отримує синтетичний T0Pattern через `loadT0Patterns` (`run-fix.mjs`, реєстр
 * `NATIVE_FIXES`). Тести нижче дзеркалять старі кейси через ЦЮ обгортку;
 * pure-функція splice-а покрита в native-юніт-тестах (`fix.rs`).
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, test, vi } from 'vitest'

import { runConcernDetector } from '../../../../scripts/lib/lint-surface/detect.mjs'
import { loadT0Patterns } from '../../../../scripts/lib/lint-surface/run-fix.mjs'
import { createSnapshot } from '../../../../scripts/lib/lint-surface/snapshot.mjs'

/** Заголовок-коментар секції Tauri build-артефактів (дубль константи native-фіксу `fix.rs`). */
const GITIGNORE_TARGET_HEADER = '# Tauri — Rust build artifacts (tauri.mdc)'

/** Стабільний reason: у корінному `.gitignore` бракує ignore-запису(ів) для `src-tauri/target/`. */
const MISSING_GITIGNORE_TARGET_ENTRIES = 'missing-gitignore-target-entries'

/** Абсолютний шлях теки концерну (тека з `concern.json`, без main.mjs — native-порт). */
const CONCERN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const CONCERN = { dir: CONCERN_DIR }

/**
 * @param {import('../../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінт-прогону
 * @returns {Promise<import('../../../../scripts/lib/lint-surface/types.mjs').LintResult>} результат детектора
 */
const lint = ctx => runConcernDetector(CONCERN, ctx)

/** @returns {string} абсолютний шлях тимчасового кореня монорепо */
function makeRoot() {
  return mkdtempSync(join(tmpdir(), 'tauri-gitignore-target-'))
}

/**
 * Створює `<root>/package.json` з workspaces (монорепо-маркер для `getMonorepoPackageRootDirs`).
 * @param {string} root корінь монорепо
 * @param {string[]} workspaces glob-патерни workspaces
 */
function makeMonorepoRoot(root, workspaces) {
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'root', workspaces }))
}

/**
 * Створює один workspace-пакет з `src-tauri/Cargo.toml` маркером.
 * @param {string} root корінь монорепо
 * @param {string} ws відносний шлях workspace-пакета (наприклад `'owner'`)
 */
function makeSrcTauriWorkspace(root, ws) {
  mkdirSync(join(root, ws, 'src-tauri'), { recursive: true })
  writeFileSync(join(root, ws, 'src-tauri', 'Cargo.toml'), '[package]\nname="t"\n')
  writeFileSync(join(root, ws, 'package.json'), JSON.stringify({ name: ws }))
}

/**
 * Пише `<root>/.gitignore`.
 * @param {string} root корінь монорепо
 * @param {string} content вміст
 */
function writeGitignore(root, content) {
  writeFileSync(join(root, '.gitignore'), content)
}

/**
 * Читає `<root>/.gitignore`.
 * @param {string} root корінь монорепо
 * @returns {string} вміст файла
 */
function readGitignore(root) {
  return readFileSync(join(root, '.gitignore'), 'utf8')
}

/**
 * Резолвить синтетичний native T0Pattern для `dir` (той самий, що бере реальний fix-pipeline).
 * @param {string} dir корінь тимчасового монорепо
 * @returns {Promise<import('../../../../scripts/lib/lint-surface/types.mjs').T0Pattern[]>} T0-патерни concern-а
 */
const patternsFor = dir => loadT0Patterns(CONCERN_DIR, 'gitignore_target', 'tauri', dir)

/**
 * Прогоняє T0-патерни над violations (як central fix-pipeline).
 * @param {import('../../../../scripts/lib/lint-surface/types.mjs').LintViolation[]} violations порушення
 * @param {string} dir корінь тимчасового монорепо
 * @returns {Promise<void>}
 */
async function applyT0(violations, dir) {
  const ctx = { cwd: dir, ruleId: 'tauri', concernId: 'gitignore_target', recordWrite: vi.fn() }
  for (const p of await patternsFor(dir)) {
    if (p.test(violations)) await p.apply(violations, ctx)
  }
}

describe('tauri/gitignore_target detector', () => {
  test('без жодного src-tauri/Cargo.toml правило не активується', async () => {
    const root = makeRoot()
    try {
      writeGitignore(root, 'node_modules/\n')
      const { violations } = await lint({ cwd: root, ruleId: 'tauri', concernId: 'gitignore_target' })
      expect(violations).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('Tauri-воркспейс без запису в .gitignore → missing-gitignore-target-entries', async () => {
    const root = makeRoot()
    try {
      makeMonorepoRoot(root, ['owner'])
      makeSrcTauriWorkspace(root, 'owner')
      writeGitignore(root, 'node_modules/\n')
      const { violations } = await lint({ cwd: root, ruleId: 'tauri', concernId: 'gitignore_target' })
      const v = violations.find(x => x.reason === MISSING_GITIGNORE_TARGET_ENTRIES)
      expect(v?.data?.missing).toEqual(['owner/src-tauri/target/'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('точний канонічний запис присутній → чисто', async () => {
    const root = makeRoot()
    try {
      makeMonorepoRoot(root, ['owner'])
      makeSrcTauriWorkspace(root, 'owner')
      writeGitignore(root, 'node_modules/\n\n# Tauri — Rust build artifacts (tauri.mdc)\nowner/src-tauri/target/\n')
      const { violations } = await lint({ cwd: root, ruleId: 'tauri', concernId: 'gitignore_target' })
      expect(violations).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('typo-подібний запис owner/target/ не закриває violation (кейс nitra/task)', async () => {
    const root = makeRoot()
    try {
      makeMonorepoRoot(root, ['owner'])
      makeSrcTauriWorkspace(root, 'owner')
      writeGitignore(root, 'node_modules/\nowner/target/\n')
      const { violations } = await lint({ cwd: root, ruleId: 'tauri', concernId: 'gitignore_target' })
      const v = violations.find(x => x.reason === MISSING_GITIGNORE_TARGET_ENTRIES)
      expect(v?.data?.missing).toEqual(['owner/src-tauri/target/'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('монорепо з кількома src-tauri/, лише частина записів присутня → missing містить лише відсутні', async () => {
    const root = makeRoot()
    try {
      makeMonorepoRoot(root, ['owner', 'app'])
      makeSrcTauriWorkspace(root, 'owner')
      makeSrcTauriWorkspace(root, 'app')
      writeGitignore(root, 'node_modules/\napp/src-tauri/target/\n')
      const { violations } = await lint({ cwd: root, ruleId: 'tauri', concernId: 'gitignore_target' })
      const v = violations.find(x => x.reason === MISSING_GITIGNORE_TARGET_ENTRIES)
      expect(v?.data?.missing).toEqual(['owner/src-tauri/target/'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('.gitignore відсутній повністю → violation з повним переліком', async () => {
    const root = makeRoot()
    try {
      makeMonorepoRoot(root, ['owner'])
      makeSrcTauriWorkspace(root, 'owner')
      const { violations } = await lint({ cwd: root, ruleId: 'tauri', concernId: 'gitignore_target' })
      const v = violations.find(x => x.reason === MISSING_GITIGNORE_TARGET_ENTRIES)
      expect(v?.data?.missing).toEqual(['owner/src-tauri/target/'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('expectedTargetEntry: фактичний Cargo workspace root крейту (через lint dispatch)', () => {
  // «standalone: src-tauri сам собі workspace root → src-tauri/target/» —
  // той самий fixture, що й «Tauri-воркспейс без запису в .gitignore» вище
  // (без ancestor-Cargo.toml src-tauri сам собі workspace root), окремого
  // detector-рівневого дубля не додаємо; pure-функція `expectedTargetEntry`
  // покрита напряму в native-юніт-тестах (`tauri_gitignore_target.rs`,
  // `standalone_src_tauri_is_own_workspace_root`).

  test('product-root: owner/Cargo.toml — workspace root для owner/src-tauri → owner/target/ (без .gitignore)', async () => {
    const root = makeRoot()
    try {
      const ownerDir = join(root, 'owner')
      const srcTauriDir = join(ownerDir, 'src-tauri')
      mkdirSync(srcTauriDir, { recursive: true })
      writeFileSync(join(ownerDir, 'Cargo.toml'), '[workspace]\nmembers = ["src-tauri"]\n')
      writeFileSync(join(srcTauriDir, 'Cargo.toml'), '[package]\nname="t"\n')
      // Мертвий/сторонній `owner/src-tauri/target/` на диску не має задовольняти перевірку —
      // очікуваний запис і так рахується від workspace root (`owner/`), а не від диска.
      mkdirSync(join(srcTauriDir, 'target'), { recursive: true })
      writeFileSync(join(ownerDir, 'package.json'), JSON.stringify({ name: 'owner' }))
      writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'root', workspaces: ['owner'] }))
      const { violations } = await lint({ cwd: root, ruleId: 'tauri', concernId: 'gitignore_target' })
      const v = violations.find(x => x.reason === MISSING_GITIGNORE_TARGET_ENTRIES)
      expect(v?.data?.missing).toEqual(['owner/target/'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('product-root: .gitignore з owner/src-tauri/target/ все одно violation missing owner/target/', async () => {
    const root = makeRoot()
    try {
      const ownerDir = join(root, 'owner')
      const srcTauriDir = join(ownerDir, 'src-tauri')
      mkdirSync(srcTauriDir, { recursive: true })
      writeFileSync(join(ownerDir, 'Cargo.toml'), '[workspace]\nmembers = ["src-tauri"]\n')
      writeFileSync(join(srcTauriDir, 'Cargo.toml'), '[package]\nname="t"\n')
      mkdirSync(join(srcTauriDir, 'target'), { recursive: true })
      writeFileSync(join(ownerDir, 'package.json'), JSON.stringify({ name: 'owner' }))
      writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'root', workspaces: ['owner'] }))
      writeGitignore(root, 'node_modules/\nowner/src-tauri/target/\n')
      const { violations } = await lint({ cwd: root, ruleId: 'tauri', concernId: 'gitignore_target' })
      const v = violations.find(x => x.reason === MISSING_GITIGNORE_TARGET_ENTRIES)
      expect(v?.data?.missing).toEqual(['owner/target/'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('repo-root: кореневий Cargo.toml — workspace root для owner/src-tauri → голий target/', async () => {
    const root = makeRoot()
    try {
      const srcTauriDir = join(root, 'owner', 'src-tauri')
      mkdirSync(srcTauriDir, { recursive: true })
      writeFileSync(join(root, 'Cargo.toml'), '[workspace]\nmembers = ["owner/src-tauri"]\n')
      writeFileSync(join(srcTauriDir, 'Cargo.toml'), '[package]\nname="t"\n')
      writeFileSync(join(root, 'owner', 'package.json'), JSON.stringify({ name: 'owner' }))
      writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'root', workspaces: ['owner'] }))
      const { violations } = await lint({ cwd: root, ruleId: 'tauri', concernId: 'gitignore_target' })
      const v = violations.find(x => x.reason === MISSING_GITIGNORE_TARGET_ENTRIES)
      expect(v?.data?.missing).toEqual(['target/'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('findMissingEntries: substring-match не рахується присутністю (через lint dispatch)', () => {
  test('лише точний рядок закриває violation, substring — ні', async () => {
    const root = makeRoot()
    try {
      makeMonorepoRoot(root, ['owner'])
      makeSrcTauriWorkspace(root, 'owner')
      writeGitignore(root, 'owner/src-tauri/target/extra\n')
      const { violations } = await lint({ cwd: root, ruleId: 'tauri', concernId: 'gitignore_target' })
      const v = violations.find(x => x.reason === MISSING_GITIGNORE_TARGET_ENTRIES)
      expect(v?.data?.missing).toEqual(['owner/src-tauri/target/'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('tauri/gitignore_target fix (native-fix обгортка)', () => {
  test('loadT0Patterns повертає синтетичний native-fix pattern', async () => {
    const root = makeRoot()
    try {
      const patterns = await patternsFor(root)
      expect(patterns).toHaveLength(1)
      expect(patterns[0].id).toBe('native-fix:tauri/gitignore_target')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('вставляє новий блок у кінець файла, коли секції ще немає', async () => {
    const root = makeRoot()
    try {
      makeMonorepoRoot(root, ['owner'])
      makeSrcTauriWorkspace(root, 'owner')
      writeGitignore(root, 'node_modules/\ndist/\n')
      const { violations } = await lint({ cwd: root, ruleId: 'tauri', concernId: 'gitignore_target' })
      await applyT0(violations, root)
      expect(readGitignore(root)).toBe(`node_modules/\ndist/\n\n${GITIGNORE_TARGET_HEADER}\nowner/src-tauri/target/\n`)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('дописує запис у вже наявну секцію поруч з іншими entries, зберігаючи оточення', async () => {
    const root = makeRoot()
    try {
      makeMonorepoRoot(root, ['owner', 'app'])
      makeSrcTauriWorkspace(root, 'owner')
      makeSrcTauriWorkspace(root, 'app')
      writeGitignore(root, `node_modules/\n\n${GITIGNORE_TARGET_HEADER}\napp/src-tauri/target/\n\ndist/\n`)
      const { violations } = await lint({ cwd: root, ruleId: 'tauri', concernId: 'gitignore_target' })
      await applyT0(violations, root)
      expect(readGitignore(root)).toBe(
        `node_modules/\n\n${GITIGNORE_TARGET_HEADER}\napp/src-tauri/target/\nowner/src-tauri/target/\n\ndist/\n`
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('без mismatch-violations план порожній — test() = false', async () => {
    const root = makeRoot()
    try {
      writeGitignore(root, 'node_modules/\n')
      const [pattern] = await patternsFor(root)
      expect(pattern.test([])).toBe(false)
      expect(pattern.test([{ reason: 'other', message: 'm' }])).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('ідемпотентно: T0-фікс закриває violation, повторний прогін не змінює файл', async () => {
    const root = makeRoot()
    try {
      makeMonorepoRoot(root, ['owner'])
      makeSrcTauriWorkspace(root, 'owner')
      writeGitignore(root, 'node_modules/\n')
      const first = await lint({ cwd: root, ruleId: 'tauri', concernId: 'gitignore_target' })
      await applyT0(first.violations, root)
      const second = await lint({ cwd: root, ruleId: 'tauri', concernId: 'gitignore_target' })
      expect(second.violations).toEqual([])

      const contentAfterFirstFix = readGitignore(root)
      await applyT0(second.violations, root)
      expect(readGitignore(root)).toBe(contentAfterFirstFix)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('T0-фікс на монорепо з кількома src-tauri/ дописує лише відсутні записи', async () => {
    const root = makeRoot()
    try {
      makeMonorepoRoot(root, ['owner', 'app'])
      makeSrcTauriWorkspace(root, 'owner')
      makeSrcTauriWorkspace(root, 'app')
      writeGitignore(root, 'node_modules/\napp/src-tauri/target/\n')
      const first = await lint({ cwd: root, ruleId: 'tauri', concernId: 'gitignore_target' })
      await applyT0(first.violations, root)
      const content = readGitignore(root)
      expect(content).toContain('owner/src-tauri/target/')
      expect(content).toContain('app/src-tauri/target/')

      const second = await lint({ cwd: root, ruleId: 'tauri', concernId: 'gitignore_target' })
      expect(second.violations).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('JS-паритет: .gitignore відсутній повністю — T0 не створює файл з нуля (план порожній)', async () => {
    // Старий `applyToFiles` скіпав нечитабельний файл (`try/catch continue`) —
    // native-порт зберігає цю поведінку 1:1 (доккомент `tauri_gitignore_target_fix`).
    const root = makeRoot()
    try {
      makeMonorepoRoot(root, ['owner'])
      makeSrcTauriWorkspace(root, 'owner')
      const { violations } = await lint({ cwd: root, ruleId: 'tauri', concernId: 'gitignore_target' })
      expect(violations).toHaveLength(1)
      const [pattern] = await patternsFor(root)
      expect(pattern.test(violations)).toBe(false)
      expect(existsSync(join(root, '.gitignore'))).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('rollback-контракт: ctx.recordWrite викликається ДО запису — rollback відновлює старий вміст', async () => {
    const root = makeRoot()
    try {
      makeMonorepoRoot(root, ['owner'])
      makeSrcTauriWorkspace(root, 'owner')
      const original = 'node_modules/\n'
      writeGitignore(root, original)
      const { violations } = await lint({ cwd: root, ruleId: 'tauri', concernId: 'gitignore_target' })

      const snapshot = createSnapshot()
      let contentAtRecordWriteTime = null
      const ctx = {
        cwd: root,
        ruleId: 'tauri',
        concernId: 'gitignore_target',
        recordWrite: absPath => {
          // recordWrite ДО write: pre-image ще ОРИГІНАЛЬНА — інакше rollback
          // відновлював би вже новий вміст.
          contentAtRecordWriteTime = readFileSync(absPath, 'utf8')
          snapshot.record(absPath)
        }
      }
      const [pattern] = await patternsFor(root)
      await pattern.apply(violations, ctx)
      expect(contentAtRecordWriteTime).toBe(original)
      expect(readGitignore(root)).toContain('owner/src-tauri/target/')

      snapshot.rollback()
      expect(readGitignore(root)).toBe(original)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

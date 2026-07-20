/**
 * Тести concern-а `tauri/gitignore_target` (tauri.mdc):
 *   - без жодного `src-tauri/Cargo.toml` правило не активується;
 *   - Tauri-воркспейс + відсутній запис у `.gitignore` → violation missing-gitignore-target-entries;
 *   - точний канонічний запис присутній → чисто;
 *   - typo-подібний запис (`owner/target/` замість `owner/src-tauri/target/`) не закриває violation
 *     (не false negative на реальному інциденті);
 *   - монорепо з кількома `src-tauri/` і лише частиною записів у `.gitignore` → у missing лише відсутні;
 *   - `.gitignore` відсутній повністю → violation з повним переліком;
 *   - T0-фікс вставляє новий блок, ідемпотентно;
 *   - T0-фікс дописує запис у вже наявну секцію поруч з іншими entries, зберігаючи оточення.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, test, vi } from 'vitest'

import { MISSING_GITIGNORE_TARGET_ENTRIES, findMissingEntries, lint } from '../main.mjs'
import { GITIGNORE_TARGET_HEADER, insertMissingTargetEntries, patterns } from '../fix-gitignore_target.mjs'

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
 * Прогоняє T0-патерни над violations (як central fix-pipeline).
 * @param {import('../../../../scripts/lib/lint-surface/types.mjs').LintViolation[]} violations порушення
 * @param {string} dir корінь тимчасового монорепо
 * @returns {Promise<void>}
 */
async function applyT0(violations, dir) {
  const ctx = { cwd: dir, ruleId: 'tauri', concernId: 'gitignore_target', recordWrite: vi.fn() }
  for (const p of patterns) {
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

describe('findMissingEntries', () => {
  test('substring-match не рахується присутністю (лише точний рядок)', () => {
    const missing = findMissingEntries('owner/src-tauri/target/extra\n', ['owner/src-tauri/target/'])
    expect(missing).toEqual(['owner/src-tauri/target/'])
  })
})

describe('tauri/gitignore_target fix', () => {
  test('вставляє новий блок у кінець файла, коли секції ще немає', () => {
    const next = insertMissingTargetEntries('node_modules/\ndist/\n', ['owner/src-tauri/target/'])
    expect(next).toBe(`node_modules/\ndist/\n\n${GITIGNORE_TARGET_HEADER}\nowner/src-tauri/target/\n`)
  })

  test('дописує запис у вже наявну секцію поруч з іншими entries, зберігаючи оточення', () => {
    const content = `node_modules/\n\n${GITIGNORE_TARGET_HEADER}\napp/src-tauri/target/\n\ndist/\n`
    const next = insertMissingTargetEntries(content, ['owner/src-tauri/target/'])
    expect(next).toBe(
      `node_modules/\n\n${GITIGNORE_TARGET_HEADER}\napp/src-tauri/target/\nowner/src-tauri/target/\n\ndist/\n`
    )
  })

  test('без відсутніх entries нічого не змінює', () => {
    expect(insertMissingTargetEntries('node_modules/\n', [])).toBeNull()
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
})

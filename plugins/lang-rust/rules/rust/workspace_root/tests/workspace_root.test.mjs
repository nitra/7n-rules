/**
 * Тести концерну `rust/workspace_root` (workspace_root.mdc): один кореневий Cargo
 * workspace на репозиторій — дзеркало JS-канону root package.json + workspaces.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import {
  MISSING_ROOT_WORKSPACE,
  NESTED_PROFILE,
  NESTED_WORKSPACE,
  PACKAGE_NOT_WORKSPACE_MEMBER,
  lint
} from '../main.mjs'

/** @returns {string} абсолютний шлях тимчасового кореня */
function makeRoot() {
  return mkdtempSync(join(tmpdir(), 'rust-workspace-root-'))
}

/**
 * Пише Cargo.toml у `root/relDir` (порожній `relDir` — кореневий файл).
 * @param {string} root корінь тимчасового репозиторію
 * @param {string} relDir відносний каталог (`''` — корінь)
 * @param {string} content вміст Cargo.toml
 */
function writeManifest(root, relDir, content) {
  const dir = relDir ? join(root, relDir) : root
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'Cargo.toml'), content)
}

/**
 * @param {string} dir корінь репозиторію
 * @returns {Promise<import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintViolation[]>} violations
 */
async function run(dir) {
  const { violations } = await lint({ cwd: dir, ruleId: 'rust', concernId: 'workspace_root', files: undefined })
  return violations
}

describe('rust/workspace_root', () => {
  test('a) кореневий [workspace] покриває всіх members — чисто', async () => {
    const root = makeRoot()
    try {
      writeManifest(root, '', '[workspace]\nresolver = "2"\nmembers = ["crates/a", "crates/b"]\n')
      writeManifest(root, 'crates/a', '[package]\nname = "a"\nversion = "0.1.0"\n')
      writeManifest(root, 'crates/b', '[package]\nname = "b"\nversion = "0.1.0"\n')
      const violations = await run(root)
      expect(violations).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('a2) glob members (crates/*) покриває всіх — чисто', async () => {
    const root = makeRoot()
    try {
      writeManifest(root, '', '[workspace]\nresolver = "2"\nmembers = ["crates/*"]\n')
      writeManifest(root, 'crates/a', '[package]\nname = "a"\nversion = "0.1.0"\n')
      writeManifest(root, 'crates/b', '[package]\nname = "b"\nversion = "0.1.0"\n')
      const violations = await run(root)
      expect(violations).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('b) вкладений [workspace] глибше кореня → nested-workspace violation', async () => {
    const root = makeRoot()
    try {
      writeManifest(root, '', '[workspace]\nresolver = "2"\nmembers = ["crates/a"]\n')
      writeManifest(root, 'crates/a', '[package]\nname = "a"\nversion = "0.1.0"\n')
      writeManifest(root, 'nested', '[workspace]\nmembers = ["sub"]\n')
      writeManifest(root, 'nested/sub', '[package]\nname = "sub"\nversion = "0.1.0"\n')
      const violations = await run(root)
      expect(violations.some(v => v.reason === NESTED_WORKSPACE && v.file === 'nested/Cargo.toml')).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('c) єдиний кореневий [package] без нащадків — чисто (неявний workspace root)', async () => {
    const root = makeRoot()
    try {
      writeManifest(root, '', '[package]\nname = "solo"\nversion = "0.1.0"\n')
      const violations = await run(root)
      expect(violations).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('d) [profile.*] у не-кореневому маніфесті → nested-profile violation', async () => {
    const root = makeRoot()
    try {
      writeManifest(root, '', '[workspace]\nresolver = "2"\nmembers = ["crates/a"]\n')
      writeManifest(root, 'crates/a', '[package]\nname = "a"\nversion = "0.1.0"\n\n[profile.release]\nopt-level = 3\n')
      const violations = await run(root)
      expect(violations.some(v => v.reason === NESTED_PROFILE && v.file === 'crates/a/Cargo.toml')).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('e) package не покритий members кореня → package-not-workspace-member violation', async () => {
    const root = makeRoot()
    try {
      writeManifest(root, '', '[workspace]\nresolver = "2"\nmembers = ["crates/a"]\n')
      writeManifest(root, 'crates/a', '[package]\nname = "a"\nversion = "0.1.0"\n')
      writeManifest(root, 'crates/orphan', '[package]\nname = "orphan"\nversion = "0.1.0"\n')
      const violations = await run(root)
      expect(
        violations.some(v => v.reason === PACKAGE_NOT_WORKSPACE_MEMBER && v.file === 'crates/orphan/Cargo.toml')
      ).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('workspace.exclude виключає package з вимоги members — чисто', async () => {
    const root = makeRoot()
    try {
      writeManifest(
        root,
        '',
        '[workspace]\nresolver = "2"\nmembers = ["crates/*"]\nexclude = ["crates/experimental"]\n'
      )
      writeManifest(root, 'crates/a', '[package]\nname = "a"\nversion = "0.1.0"\n')
      writeManifest(root, 'crates/experimental', '[package]\nname = "experimental"\nversion = "0.1.0"\n')
      const violations = await run(root)
      expect(violations).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('немає жодного Cargo.toml з [package] — концерн не застосовний', async () => {
    const root = makeRoot()
    try {
      writeFileSync(join(root, 'package.json'), '{}')
      const violations = await run(root)
      expect(violations).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('кореневий Cargo.toml відсутній, але є package-и → missing-root-workspace', async () => {
    const root = makeRoot()
    try {
      writeManifest(root, 'crates/a', '[package]\nname = "a"\nversion = "0.1.0"\n')
      const violations = await run(root)
      expect(violations.some(v => v.reason === MISSING_ROOT_WORKSPACE)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('кореневий [package] без [workspace] + є інший package → missing-root-workspace', async () => {
    const root = makeRoot()
    try {
      writeManifest(root, '', '[package]\nname = "root"\nversion = "0.1.0"\n')
      writeManifest(root, 'crates/a', '[package]\nname = "a"\nversion = "0.1.0"\n')
      const violations = await run(root)
      expect(violations.some(v => v.reason === MISSING_ROOT_WORKSPACE)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('target/ і node_modules/ пропускаються обходом', async () => {
    const root = makeRoot()
    try {
      writeManifest(root, '', '[workspace]\nresolver = "2"\nmembers = ["crates/a"]\n')
      writeManifest(root, 'crates/a', '[package]\nname = "a"\nversion = "0.1.0"\n')
      writeManifest(root, 'target/debug/build/whatever', '[package]\nname = "ignored"\nversion = "0.1.0"\n')
      writeManifest(root, 'node_modules/pkg', '[package]\nname = "ignored2"\nversion = "0.1.0"\n')
      const violations = await run(root)
      expect(violations).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('.worktrees/ (auto-created сесійний checkout) пропускається обходом — нуль хибних violations', async () => {
    const root = makeRoot()
    try {
      writeManifest(root, '', '[workspace]\nresolver = "2"\nmembers = ["crates/a"]\n')
      writeManifest(root, 'crates/a', '[package]\nname = "a"\nversion = "0.1.0"\n')
      // Копія всього дерева (кореневий + вкладений workspace) під .worktrees/ —
      // без ігнору walker знайшов би тут дублі й видав NESTED_WORKSPACE.
      writeManifest(root, '.worktrees/main-lint', '[workspace]\nresolver = "2"\nmembers = ["crates/a"]\n')
      writeManifest(root, '.worktrees/main-lint/crates/a', '[package]\nname = "a"\nversion = "0.1.0"\n')
      const violations = await run(root)
      expect(violations).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

/**
 * Тести `cargo-workspace.mjs`: резолв `[workspace].members`-glob-патернів у каталоги
 * й пошук найближчого предка-workspace root для крейту (спільна утиліта
 * `rust/workspace_root` і `tauri/gitignore_target`).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import { findAncestorWorkspaceRoot, isWorkspaceMemberDir, resolveWorkspaceMemberDirs } from '../cargo-workspace.mjs'

/**
 * Пише Cargo.toml у `root/relDir`.
 * @param {string} root корінь тимчасового репозиторію
 * @param {string} relDir відносний каталог
 * @param {string} content вміст Cargo.toml
 */
function writeManifest(root, relDir, content) {
  const dir = join(root, relDir)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'Cargo.toml'), content)
}

describe('resolveWorkspaceMemberDirs', () => {
  test('літеральні шляхи резолвляться в абсолютні каталоги з Cargo.toml', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cargo-ws-literal-'))
    try {
      writeManifest(root, 'a', '[package]\nname="a"\n')
      writeManifest(root, 'b', '[package]\nname="b"\n')
      const dirs = await resolveWorkspaceMemberDirs(root, ['a', 'b'])
      expect(new Set(dirs)).toEqual(new Set([join(root, 'a'), join(root, 'b')]))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('glob `crates/*` резолвиться в усі підкаталоги з Cargo.toml', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cargo-ws-glob-'))
    try {
      writeManifest(root, 'crates/a', '[package]\nname="a"\n')
      writeManifest(root, 'crates/b', '[package]\nname="b"\n')
      mkdirSync(join(root, 'crates', 'no-manifest'), { recursive: true })
      const dirs = await resolveWorkspaceMemberDirs(root, ['crates/*'])
      expect(new Set(dirs)).toEqual(new Set([join(root, 'crates', 'a'), join(root, 'crates', 'b')]))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('патерн без відповідного Cargo.toml — не потрапляє в результат', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cargo-ws-missing-'))
    try {
      mkdirSync(join(root, 'ghost'), { recursive: true })
      const dirs = await resolveWorkspaceMemberDirs(root, ['ghost'])
      expect(dirs).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('isWorkspaceMemberDir', () => {
  test('exclude виключає каталог, що інакше покритий members', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cargo-ws-exclude-'))
    try {
      writeManifest(root, 'crates/a', '[package]\nname="a"\n')
      writeManifest(root, 'crates/experimental', '[package]\nname="exp"\n')
      const covered = await isWorkspaceMemberDir(root, join(root, 'crates', 'a'), ['crates/*'], ['crates/experimental'])
      const excluded = await isWorkspaceMemberDir(
        root,
        join(root, 'crates', 'experimental'),
        ['crates/*'],
        ['crates/experimental']
      )
      expect(covered).toBe(true)
      expect(excluded).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('findAncestorWorkspaceRoot', () => {
  test('найближчий предок з [workspace], чиї members покривають крейт', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cargo-ws-ancestor-'))
    try {
      const crateDir = join(root, 'owner', 'src-tauri')
      mkdirSync(crateDir, { recursive: true })
      writeFileSync(join(crateDir, 'Cargo.toml'), '[package]\nname="t"\n')
      writeManifest(root, 'owner', '[workspace]\nmembers = ["src-tauri"]\n')
      const found = await findAncestorWorkspaceRoot(crateDir, root)
      expect(found?.rootDir).toBe(join(root, 'owner'))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('шукає далі вгору до repoRoot, коли найближчий предок не покриває крейт', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cargo-ws-ancestor-skip-'))
    try {
      const crateDir = join(root, 'owner', 'src-tauri')
      mkdirSync(crateDir, { recursive: true })
      writeFileSync(join(crateDir, 'Cargo.toml'), '[package]\nname="t"\n')
      // owner/Cargo.toml існує, але БЕЗ [workspace] — не рахується
      writeManifest(root, 'owner', '[package]\nname="owner-unrelated"\n')
      writeManifest(root, '', '[workspace]\nmembers = ["owner/src-tauri"]\n')
      const found = await findAncestorWorkspaceRoot(crateDir, root)
      expect(found?.rootDir).toBe(root)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('немає жодного відповідного предка — null', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cargo-ws-ancestor-none-'))
    try {
      const crateDir = join(root, 'owner', 'src-tauri')
      mkdirSync(crateDir, { recursive: true })
      writeFileSync(join(crateDir, 'Cargo.toml'), '[package]\nname="t"\n')
      const found = await findAncestorWorkspaceRoot(crateDir, root)
      expect(found).toBe(null)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

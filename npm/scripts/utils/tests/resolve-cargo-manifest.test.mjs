/**
 * Тести `resolveCargoManifest`: знаходить Cargo.toml у cwd, у workspace-flat
 * або у Tauri-патерні (`<workspace>/src-tauri/`). Повертає null без manifest.
 */
import { describe, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { resolveAllCargoManifests, resolveCargoManifest } from '../resolve-cargo-manifest.mjs'

/**
 * Створює тимчасовий проєкт з опційними Cargo.toml та workspace-layout-ами.
 * @param {object} root0 параметри
 * @param {boolean} [root0.rootCargo] чи створити Cargo.toml у корені
 * @param {boolean} [root0.workspaceFlat] чи створити flat workspace app/Cargo.toml
 * @param {boolean} [root0.workspaceTauri] чи створити Tauri workspace app/src-tauri/Cargo.toml
 * @param {{workspaces?: string[]}} [root0.rootPkg] вміст root package.json
 * @returns {string} шлях до тимчасового каталогу
 */
function makeProj({ rootCargo, workspaceFlat, workspaceTauri, rootPkg }) {
  const dir = mkdtempSync(join(tmpdir(), 'resolve-cargo-'))
  if (rootCargo) writeFileSync(join(dir, 'Cargo.toml'), '[package]\nname="foo"\nversion="0.1.0"\n')
  if (rootPkg) writeFileSync(join(dir, 'package.json'), JSON.stringify(rootPkg))
  if (workspaceFlat) {
    mkdirSync(join(dir, 'app'), { recursive: true })
    writeFileSync(join(dir, 'app', 'Cargo.toml'), '[package]\nname="app"\nversion="0.1.0"\n')
  }
  if (workspaceTauri) {
    mkdirSync(join(dir, 'app', 'src-tauri'), { recursive: true })
    writeFileSync(join(dir, 'app', 'src-tauri', 'Cargo.toml'), '[package]\nname="tauri"\nversion="0.1.0"\n')
  }
  return dir
}

describe('resolveCargoManifest', () => {
  test('cwd/Cargo.toml існує — повертає його', async () => {
    const dir = makeProj({ rootCargo: true })
    expect(await resolveCargoManifest(dir)).toBe(join(dir, 'Cargo.toml'))
    rmSync(dir, { recursive: true, force: true })
  })

  test('Tauri-патерн — повертає <workspace>/src-tauri/Cargo.toml', async () => {
    const dir = makeProj({ rootPkg: { workspaces: ['app'] }, workspaceTauri: true })
    expect(await resolveCargoManifest(dir)).toBe(join(dir, 'app', 'src-tauri', 'Cargo.toml'))
    rmSync(dir, { recursive: true, force: true })
  })

  test('flat workspace — повертає <workspace>/Cargo.toml', async () => {
    const dir = makeProj({ rootPkg: { workspaces: ['app'] }, workspaceFlat: true })
    expect(await resolveCargoManifest(dir)).toBe(join(dir, 'app', 'Cargo.toml'))
    rmSync(dir, { recursive: true, force: true })
  })

  test('Tauri має пріоритет над flat у тому ж workspace', async () => {
    const dir = makeProj({ rootPkg: { workspaces: ['app'] }, workspaceFlat: true, workspaceTauri: true })
    expect(await resolveCargoManifest(dir)).toBe(join(dir, 'app', 'src-tauri', 'Cargo.toml'))
    rmSync(dir, { recursive: true, force: true })
  })

  test('ні root, ні workspaces без Cargo.toml — null', async () => {
    const dir = makeProj({ rootPkg: { workspaces: ['app'] } })
    expect(await resolveCargoManifest(dir)).toBe(null)
    rmSync(dir, { recursive: true, force: true })
  })

  test('кореневий package.json відсутній і Cargo.toml відсутній — null', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'resolve-cargo-empty-'))
    expect(await resolveCargoManifest(dir)).toBe(null)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('resolveAllCargoManifests', () => {
  test('cwd/Cargo.toml + workspace Tauri — повертає обидва', async () => {
    const dir = makeProj({ rootCargo: true, rootPkg: { workspaces: ['app'] }, workspaceTauri: true })
    expect(await resolveAllCargoManifests(dir)).toEqual([
      join(dir, 'Cargo.toml'),
      join(dir, 'app', 'src-tauri', 'Cargo.toml')
    ])
    rmSync(dir, { recursive: true, force: true })
  })

  test('кілька workspaces з різними layout-ами — повертає всі', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'resolve-cargo-multi-'))
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ workspaces: ['tauri-app', 'cli-tool'] }))
    mkdirSync(join(dir, 'tauri-app', 'src-tauri'), { recursive: true })
    writeFileSync(join(dir, 'tauri-app', 'src-tauri', 'Cargo.toml'), '[package]\nname="t"\nversion="0.1.0"\n')
    mkdirSync(join(dir, 'cli-tool'), { recursive: true })
    writeFileSync(join(dir, 'cli-tool', 'Cargo.toml'), '[package]\nname="c"\nversion="0.1.0"\n')
    expect(await resolveAllCargoManifests(dir)).toEqual([
      join(dir, 'tauri-app', 'src-tauri', 'Cargo.toml'),
      join(dir, 'cli-tool', 'Cargo.toml')
    ])
    rmSync(dir, { recursive: true, force: true })
  })

  test('workspace із обома Tauri і flat — Tauri пріоритетніше, flat не додається', async () => {
    const dir = makeProj({ rootPkg: { workspaces: ['app'] }, workspaceFlat: true, workspaceTauri: true })
    expect(await resolveAllCargoManifests(dir)).toEqual([join(dir, 'app', 'src-tauri', 'Cargo.toml')])
    rmSync(dir, { recursive: true, force: true })
  })

  test('тільки cwd/Cargo.toml — повертає [одне]', async () => {
    const dir = makeProj({ rootCargo: true })
    expect(await resolveAllCargoManifests(dir)).toEqual([join(dir, 'Cargo.toml')])
    rmSync(dir, { recursive: true, force: true })
  })

  test('ні root, ні workspaces без Cargo.toml — []', async () => {
    const dir = makeProj({ rootPkg: { workspaces: ['app'] } })
    expect(await resolveAllCargoManifests(dir)).toEqual([])
    rmSync(dir, { recursive: true, force: true })
  })
})

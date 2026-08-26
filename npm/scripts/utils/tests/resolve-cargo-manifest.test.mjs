/**
 * Тести `resolveCargoManifest`/`resolveAllCargoManifests`: знаходять
 * Cargo.toml у cwd, у workspace-flat або у Tauri-патерні
 * (`<workspace>/src-tauri/`). Повертають null/[] без manifest.
 *
 * Glob-кейси (`describe` нижче) дзеркалять Rust-тести
 * `resolve_all_cargo_manifests_expands_glob_workspaces_entry` /
 * `..._glob_entry_applies_tauri_preference_per_dir` /
 * `..._glob_entry_with_no_matching_dirs_is_empty_contribution`
 * (`crates/plugin-lang-rust/src/lib.rs`) — §2.28 реєстру відкладених питань:
 * `workspaces`-записи з `*`/`**` тепер розгортаються тут ТАК САМО, як у
 * Rust-гості, інакше детектор (гість) і фіксер (ця утиліта) розійшлися б у
 * тому, які маніфести існують.
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

  test('workspaces glob-патерн (packages/*) розкривається — знаходить перший за відсортованим порядком', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'resolve-cargo-glob-'))
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ workspaces: ['packages/*'] }))
    mkdirSync(join(dir, 'packages', 'b'), { recursive: true })
    writeFileSync(join(dir, 'packages', 'b', 'Cargo.toml'), '[package]\nname="b"\nversion="0.1.0"\n')
    mkdirSync(join(dir, 'packages', 'a'), { recursive: true })
    writeFileSync(join(dir, 'packages', 'a', 'Cargo.toml'), '[package]\nname="a"\nversion="0.1.0"\n')
    expect(await resolveCargoManifest(dir)).toBe(join(dir, 'packages', 'a', 'Cargo.toml'))
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

  // --- glob-розкриття `workspaces` (§2.28) — дзеркало Rust-тестів
  // `resolve_all_cargo_manifests_*` (`crates/plugin-lang-rust/src/lib.rs`) ---

  test('workspaces glob-патерн (packages/*) розкривається — обидва пакети знайдені, відсортовано', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'resolve-cargo-glob-'))
    writeFileSync(join(dir, 'Cargo.toml'), '[workspace]\n')
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ workspaces: ['packages/*'] }))
    mkdirSync(join(dir, 'packages', 'b'), { recursive: true })
    writeFileSync(join(dir, 'packages', 'b', 'Cargo.toml'), '[package]\nname="b"\nversion="0.1.0"\n')
    mkdirSync(join(dir, 'packages', 'a'), { recursive: true })
    writeFileSync(join(dir, 'packages', 'a', 'Cargo.toml'), '[package]\nname="a"\nversion="0.1.0"\n')
    expect(await resolveAllCargoManifests(dir)).toEqual([
      join(dir, 'Cargo.toml'),
      join(dir, 'packages', 'a', 'Cargo.toml'),
      join(dir, 'packages', 'b', 'Cargo.toml')
    ])
    rmSync(dir, { recursive: true, force: true })
  })

  test('glob-запис — Tauri-перевага застосовується до КОЖНОГО розкритого каталогу окремо', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'resolve-cargo-glob-tauri-'))
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ workspaces: ['packages/*'] }))
    mkdirSync(join(dir, 'packages', 'a', 'src-tauri'), { recursive: true })
    writeFileSync(join(dir, 'packages', 'a', 'src-tauri', 'Cargo.toml'), '[package]\nname="a-tauri"\nversion="0.1.0"\n')
    writeFileSync(join(dir, 'packages', 'a', 'Cargo.toml'), '[package]\nname="a-flat"\nversion="0.1.0"\n')
    mkdirSync(join(dir, 'packages', 'b'), { recursive: true })
    writeFileSync(join(dir, 'packages', 'b', 'Cargo.toml'), '[package]\nname="b-flat"\nversion="0.1.0"\n')
    expect(await resolveAllCargoManifests(dir)).toEqual([
      join(dir, 'packages', 'a', 'src-tauri', 'Cargo.toml'),
      join(dir, 'packages', 'b', 'Cargo.toml')
    ])
    rmSync(dir, { recursive: true, force: true })
  })

  test('glob-запис без жодного збігу — коректний порожній внесок (не помилка)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'resolve-cargo-glob-empty-'))
    writeFileSync(join(dir, 'Cargo.toml'), '[workspace]\n')
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ workspaces: ['packages/*'] }))
    mkdirSync(join(dir, 'apps', 'a'), { recursive: true })
    writeFileSync(join(dir, 'apps', 'a', 'Cargo.toml'), '[package]\nname="a"\nversion="0.1.0"\n')
    expect(await resolveAllCargoManifests(dir)).toEqual([join(dir, 'Cargo.toml')])
    rmSync(dir, { recursive: true, force: true })
  })

  test('РЕГРЕСІЯ: літеральний (без *) workspaces-запис поводиться так само, як до фіксу', async () => {
    // Той самий фікстур-шейп, що вже покритий `workspace із обома Tauri і
    // flat` вище — тут лише явний якір, що коротка (літеральна) гілка
    // `expandWorkspaceEntryDirs` повертає `[ws]` без жодного `scanGlob`,
    // тобто НЕ зачіпає найпоширеніший (поіменований) workspace-кейс.
    const dir = makeProj({ rootPkg: { workspaces: ['app'] }, workspaceFlat: true })
    expect(await resolveAllCargoManifests(dir)).toEqual([join(dir, 'app', 'Cargo.toml')])
    rmSync(dir, { recursive: true, force: true })
  })
})

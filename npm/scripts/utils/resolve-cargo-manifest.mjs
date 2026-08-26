/**
 * Резолвить шлях до Cargo.toml у проєкті: cwd/Cargo.toml або в одному з
 * workspace-підкаталогів (з підтримкою Tauri-патерну `<workspace>/src-tauri/`).
 * Спільна утиліта для coverage-провайдера rust і test-концерну cargo_mutants_config.
 * Повертає null (а не throw) щоб callsite-и могли gracefully skip-пропустити.
 *
 * `workspaces`-записи МОЖУТЬ бути glob-патернами (`packages/*`, `**`) — до
 * §2.28 реєстру відкладених питань (`docs/plans/2026-08-05-open-questions-register.md`)
 * тут (і в Rust-порту `rust/cargo_mutants_config`, `crates/plugin-lang-rust`)
 * жив ЛАТЕНТНИЙ баг: запис трактувався як ЛІТЕРАЛЬНИЙ сегмент шляху, тож
 * типовий `"workspaces": ["packages/*"]` шукав каталог, буквально названий
 * `*`, і нічого не знаходив. §2.28 виправив Rust-гостя; цей фікс — та сама
 * поведінка тут, СИМЕТРИЧНО: гість і фіксер мають бачити ОДНАКОВИЙ набір
 * маніфестів, інакше детектор бачить порушення, які фіксер не може
 * закрити. [`expandWorkspaceEntryDirs`] — та сама розгортка `*`/`**`, що
 * `expandWorkspacePattern` (`resolve-js-root.mjs`, для `package.json`) і
 * `resolveWorkspaceMemberDirs` (`cargo-workspace.mjs`, для Cargo
 * `[workspace].members`/`.exclude`) — спільний `scanGlob`-примітив
 * (`glob-compat.mjs`), той самий build-block, різні споживачі.
 *
 * Середовища принципово РІЗНІ: Rust-гість матчить проти вже наданого
 * host-батчу (`**\/Cargo.toml`, зібраного один раз на прогін), тут —
 * реальний диск через `scanGlob` (кожен виклик — окремий FS-обхід).
 * Результат МАЄ збігатися для того самого дерева файлів; названо явно, де
 * могло б розійтися: `scanGlob` без застосованого `.gitignore`/`.n-rules.json`
 * ignore (на відміну від host-батчу, що його вже поважає) — тому тут, як і в
 * `resolve-js-root.mjs`, glob-гілка сама відфільтровує `node_modules`/`.git`
 * (`WORKSPACE_IGNORED_DIRS`), щоб не розбухати збігами з невідповідних
 * піддерев, яких host-батч гостя просто ніколи не показав би.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { hasIgnoredPathSegment, scanGlob } from './glob-compat.mjs'

const WORKSPACE_IGNORED_DIRS = Object.freeze(['node_modules', '.git'])

/**
 * Розгортає ОДИН `workspaces`-запис (літерал чи `*`/`**`-glob) у
 * відсортований (без дублікатів) список каталогів-кандидатів, ВІДНОСНИХ до
 * `cwd` — дзеркало [`expand_workspace_entry_dirs`]
 * (`crates/plugin-lang-rust/src/lib.rs`, §2.28), інше джерело кандидатів
 * (диск, не host-батч). Літеральний (без `*`) запис — короткий шлях: сам
 * `ws`, БЕЗ будь-якого FS-обходу (`scanGlob`), той самий код-шлях, що ДО
 * фіксу — регресія неможлива. Glob-гілка скановує ОБИДВА варіанти
 * (`<pattern>/Cargo.toml` і `<pattern>/src-tauri/Cargo.toml`) — той самий
 * мотив, що `resolveWorkspaceMemberDirs`: деякі раннери (Bun.Glob) за
 * замовчуванням матчать лише файли, тож патерн на голий каталог давав би 0
 * збігів.
 * @param {string} cwd корінь проєкту
 * @param {string} ws один workspaces-запис (літерал чи glob)
 * @returns {Promise<string[]>} відносні (до `cwd`) шляхи каталогів-кандидатів, відсортовані
 */
async function expandWorkspaceEntryDirs(cwd, ws) {
  if (!ws.includes('*')) return [ws]
  const dirs = new Set()
  for await (const rel of scanGlob(`${ws}/Cargo.toml`, cwd)) {
    if (hasIgnoredPathSegment(rel, WORKSPACE_IGNORED_DIRS)) continue
    const dir = dirname(rel)
    if (dir !== '.') dirs.add(dir)
  }
  for await (const rel of scanGlob(`${ws}/src-tauri/Cargo.toml`, cwd)) {
    if (hasIgnoredPathSegment(rel, WORKSPACE_IGNORED_DIRS)) continue
    const dir = dirname(dirname(rel))
    if (dir !== '.') dirs.add(dir)
  }
  return [...dirs].toSorted()
}

/**
 * @param {string} cwd корінь проєкту
 * @returns {Promise<string|null>} абсолютний шлях до Cargo.toml або null
 */
export async function resolveCargoManifest(cwd) {
  const rootManifest = join(cwd, 'Cargo.toml')
  if (existsSync(rootManifest)) return rootManifest

  const rootPkgPath = join(cwd, 'package.json')
  if (existsSync(rootPkgPath)) {
    const rootPkg = JSON.parse(await readFile(rootPkgPath, 'utf8'))
    const workspaces = Array.isArray(rootPkg.workspaces) ? rootPkg.workspaces : []
    for (const ws of workspaces) {
      for (const dir of await expandWorkspaceEntryDirs(cwd, ws)) {
        const tauri = join(cwd, dir, 'src-tauri', 'Cargo.toml')
        if (existsSync(tauri)) return tauri
        const flat = join(cwd, dir, 'Cargo.toml')
        if (existsSync(flat)) return flat
      }
    }
  }
  return null
}

/**
 * Plural-варіант: повертає всі Cargo.toml-маніфести в проєкті — корінь
 * (`cwd/Cargo.toml`) і у workspace-підкаталогах, розгорнутих із можливих
 * glob-записів `workspaces` (`<dir>/src-tauri/Cargo.toml` пріоритетніше за
 * `<dir>/Cargo.toml`, ДЛЯ КОЖНОГО розгорнутого каталогу окремо, не для
 * патерна). Порожній масив якщо нічого не знайдено. Використовується
 * test-концерном `cargo_mutants_config` (T0-фіксер
 * `fix-cargo_mutants_config.mjs`) для per-manifest baseline-копіювання.
 * @param {string} cwd корінь проєкту
 * @returns {Promise<string[]>} абсолютні шляхи до знайдених Cargo.toml
 */
export async function resolveAllCargoManifests(cwd) {
  const manifests = []
  const rootManifest = join(cwd, 'Cargo.toml')
  if (existsSync(rootManifest)) manifests.push(rootManifest)

  const rootPkgPath = join(cwd, 'package.json')
  if (existsSync(rootPkgPath)) {
    const rootPkg = JSON.parse(await readFile(rootPkgPath, 'utf8'))
    const workspaces = Array.isArray(rootPkg.workspaces) ? rootPkg.workspaces : []
    for (const ws of workspaces) {
      for (const dir of await expandWorkspaceEntryDirs(cwd, ws)) {
        const tauri = join(cwd, dir, 'src-tauri', 'Cargo.toml')
        if (existsSync(tauri)) {
          manifests.push(tauri)
          continue
        }
        const flat = join(cwd, dir, 'Cargo.toml')
        if (existsSync(flat)) manifests.push(flat)
      }
    }
  }
  return manifests
}

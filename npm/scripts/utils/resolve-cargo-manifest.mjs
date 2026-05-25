/**
 * Резолвить шлях до Cargo.toml у проєкті: cwd/Cargo.toml або в одному з
 * workspace-підкаталогів (з підтримкою Tauri-патерну `<workspace>/src-tauri/`).
 * Спільна утиліта для coverage-провайдера rust і test-концерну cargo_mutants_config.
 * Повертає null (а не throw) щоб callsite-и могли gracefully skip-нути.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

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
      const tauri = join(cwd, ws, 'src-tauri', 'Cargo.toml')
      if (existsSync(tauri)) return tauri
      const flat = join(cwd, ws, 'Cargo.toml')
      if (existsSync(flat)) return flat
    }
  }
  return null
}

/**
 * Plural-варіант: повертає всі Cargo.toml-маніфести в проєкті — корінь
 * (`cwd/Cargo.toml`) і у workspace-підкаталогах (`<ws>/src-tauri/Cargo.toml`
 * пріоритетніше за `<ws>/Cargo.toml`). Порожній масив якщо нічого не знайдено.
 * Використовується test-концерном `cargo_mutants_config` для per-manifest
 * baseline-копіювання.
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
      const tauri = join(cwd, ws, 'src-tauri', 'Cargo.toml')
      if (existsSync(tauri)) {
        manifests.push(tauri)
        continue
      }
      const flat = join(cwd, ws, 'Cargo.toml')
      if (existsSync(flat)) manifests.push(flat)
    }
  }
  return manifests
}

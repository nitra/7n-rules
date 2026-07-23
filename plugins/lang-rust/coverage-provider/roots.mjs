/**
 * Пошук Rust-коренів проєкту для coverage-виміру: каталоги з `Cargo.toml`
 * у корені репо та на першому рівні вкладеності (типові розкладки: крейт у
 * корені, `src-tauri/` десктоп-застосунку, side-крейт у монорепо). Вкладені
 * члени workspace окремо не повертаються — `cargo llvm-cov`/`cargo mutants`
 * із кореня workspace покривають усіх членів самі.
 */
import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

/** Службові теки, де Cargo.toml першого рівня не шукається. */
const IGNORE_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'target',
  'coverage',
  'docs',
  '.git',
  '.claude',
  '.worktrees',
  '.cursor',
  '.github'
])

/**
 * Rust-корені під `cwd`: сам корінь (якщо має Cargo.toml) + перший рівень тек.
 * @param {string} cwd корінь проєкту
 * @returns {Promise<string[]>} абсолютні шляхи каталогів із Cargo.toml
 */
export async function findRustRoots(cwd) {
  const roots = []
  if (existsSync(join(cwd, 'Cargo.toml'))) roots.push(cwd)
  let entries
  try {
    entries = await readdir(cwd, { withFileTypes: true })
  } catch {
    return roots
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || IGNORE_DIRS.has(entry.name)) continue
    const dir = join(cwd, entry.name)
    if (existsSync(join(dir, 'Cargo.toml'))) roots.push(dir)
  }
  return roots
}

/**
 * Мовно-агностичний пошук коренів екосистеми за маніфестом (спільна lib
 * концерну coverage): каталоги з одним із маніфест-файлів у корені проєкту та
 * на першому рівні вкладеності (типові розкладки: крейт/пакет у корені,
 * `src-tauri/`, side-пакет у монорепо). Глибші члени workspace не повертаються
 * — тулзи (`cargo llvm-cov`, `pytest`) покривають їх із кореня самі.
 */
import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

/** Службові теки, де маніфести першого рівня не шукаються. */
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
 * Корені під `cwd`, що мають хоча б один із `manifestNames`.
 * @param {string} cwd корінь проєкту
 * @param {string[]} manifestNames імена маніфестів (напр. `['Cargo.toml']`, `['pyproject.toml', 'setup.py']`)
 * @returns {Promise<string[]>} абсолютні шляхи каталогів-коренів
 */
export async function findManifestRoots(cwd, manifestNames) {
  const hasManifest = dir => manifestNames.some(name => existsSync(join(dir, name)))
  const roots = []
  if (hasManifest(cwd)) roots.push(cwd)
  let entries
  try {
    entries = await readdir(cwd, { withFileTypes: true })
  } catch {
    return roots
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || IGNORE_DIRS.has(entry.name)) continue
    const dir = join(cwd, entry.name)
    if (hasManifest(dir)) roots.push(dir)
  }
  return roots
}

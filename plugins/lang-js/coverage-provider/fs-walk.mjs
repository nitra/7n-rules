/**
 * Спільний рекурсивний обхід workspace-дерева для root-детекторів (`bun-native.mjs`,
 * `storybook.mjs`): dot-теки і службові директорії (build/vcs-артефакти) відсіюються,
 * решта файлів іде у колбек.
 */
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

/** Службові директорії, які не скануємо (build-артефакти, VCS, звіти). */
const IGNORE_DIRS = new Set(['node_modules', 'dist', 'build', 'out', '.git', 'coverage', 'reports', 'docs', 'types'])

/**
 * Рекурсивний обхід каталогу з відсіюванням службових директорій (dot-теки, IGNORE_DIRS).
 * @param {string} dir абсолютний шлях
 * @param {(absPath: string) => void} onFile колбек для кожного файлу
 * @returns {Promise<void>}
 */
export async function walk(dir, onFile) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!IGNORE_DIRS.has(entry.name)) await walk(abs, onFile)
    } else if (entry.isFile()) {
      onFile(abs)
    }
  }
}

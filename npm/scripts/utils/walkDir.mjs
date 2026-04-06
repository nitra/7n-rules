/**
 * Рекурсивний обхід каталогів для скриптів перевірки (Dockerfile, k8s YAML тощо).
 *
 * Обходить дерево від заданого кореня; для кожного звичайного файлу викликає переданий callback.
 * Каталоги node_modules, .git, dist, coverage, .turbo, .next не заходяться. Якщо readdir для
 * каталогу не вдається — тихо виходить без throw.
 */
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Рекурсивно обходить каталог, пропускає типові артефакти збірки та залежностей.
 * @param {string} dir абсолютний шлях
 * @param {(filePath: string) => void} onFile виклик для кожного файлу
 * @returns {Promise<void>}
 */
export async function walkDir(dir, onFile) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      const skipDir =
        e.name === 'node_modules' ||
        e.name === '.git' ||
        e.name === 'dist' ||
        e.name === 'coverage' ||
        e.name === '.turbo' ||
        e.name === '.next'
      if (!skipDir) {
        await walkDir(p, onFile)
      }
    } else if (e.isFile()) {
      onFile(p)
    }
  }
}

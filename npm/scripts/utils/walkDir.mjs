/**
 * Рекурсивний обхід каталогів для скриптів перевірки (Dockerfile, k8s YAML тощо).
 *
 * Обходить дерево від заданого кореня; для кожного звичайного файлу викликає переданий callback.
 * Каталоги node_modules, .git, dist, coverage, .turbo, .next не заходяться.
 * Додатково можна передати `ignorePaths` — повні шляхи каталогів (абсолютні posix), які слід
 * пропускати разом з усім вмістом (поле `ignore` у `.n-cursor.json`). Якщо readdir для каталогу
 * не вдається — тихо виходить без throw.
 */
import { readdir } from 'node:fs/promises'
import { isAbsolute, join, resolve, sep } from 'node:path'

/**
 * Перетворює довільний шлях у абсолютний posix-формат без trailing-slash.
 * @param {string} p шлях
 * @returns {string} абсолютний posix-шлях
 */
function toAbsPosix(p) {
  const abs = isAbsolute(p) ? p : resolve(p)
  return abs.split(sep).join('/').replace(/\/+$/, '')
}

/**
 * Чи каталог `dirAbsPosix` входить у список ignore (точний збіг або префікс з '/').
 * Часткові збіги басенейму не враховуються (postgres-master-test ≠ postgres-master).
 * @param {string} dirAbsPosix абсолютний posix-шлях каталогу
 * @param {string[]} ignorePosix вже нормалізовані ignore-шляхи
 * @returns {boolean}
 */
function isIgnoredDir(dirAbsPosix, ignorePosix) {
  for (const ig of ignorePosix) {
    if (dirAbsPosix === ig) return true
    if (dirAbsPosix.startsWith(`${ig}/`)) return true
  }
  return false
}

/**
 * Рекурсивно обходить каталог, пропускає типові артефакти збірки/залежностей та `ignorePaths`.
 * @param {string} dir абсолютний шлях
 * @param {(filePath: string) => void} onFile виклик для кожного файлу
 * @param {string[]} [ignorePaths=[]] шляхи каталогів (відносні від cwd або абсолютні), що повністю виключаються з обходу
 * @returns {Promise<void>}
 */
export async function walkDir(dir, onFile, ignorePaths = []) {
  const ignorePosix = ignorePaths.map(toAbsPosix)
  await walkDirInner(dir, onFile, ignorePosix)
}

/**
 * Внутрішній рекурсор. ignorePosix вже нормалізовано — не нормалізуємо повторно на кожному рівні.
 * @param {string} dir
 * @param {(filePath: string) => void} onFile
 * @param {string[]} ignorePosix
 * @returns {Promise<void>}
 */
async function walkDirInner(dir, onFile, ignorePosix) {
  if (ignorePosix.length > 0 && isIgnoredDir(toAbsPosix(dir), ignorePosix)) return
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
      if (skipDir) continue
      if (ignorePosix.length > 0 && isIgnoredDir(toAbsPosix(p), ignorePosix)) continue
      await walkDirInner(p, onFile, ignorePosix)
    } else if (e.isFile()) {
      onFile(p)
    }
  }
}

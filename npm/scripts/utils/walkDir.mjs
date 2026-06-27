/** @see ./docs/walkDir.md */
import { join, relative, resolve, sep } from 'node:path'
import { globby } from 'globby'

// .git ніколи не потрапляє в .gitignore — пропускаємо завжди.
// node_modules — safety net: проєкт може не мати .gitignore або запускатись поза git-репо.
export const ALWAYS_IGNORE = ['.git/**', 'node_modules/**']

/**
 * Рекурсивно обходить каталог, поважаючи .gitignore (включно з вкладеними).
 * @param {string} dir абсолютний або відносний шлях до кореня обходу
 * @param {(filePath: string) => void} onFile колбек для кожного файлу (абсолютний шлях)
 * @param {string[]} [ignorePaths] додаткові шляхи для пропуску (абсолютні або відносні від cwd)
 * @returns {Promise<void>}
 */
export async function walkDir(dir, onFile, ignorePaths = []) {
  const absDir = resolve(dir)

  const extraIgnore = ignorePaths
    .map(p => {
      const abs = resolve(p.replace(/\/+$/, ''))
      const rel = relative(absDir, abs).split(sep).join('/')
      if (rel.startsWith('..') || rel === '') return null
      return `${rel}/**`
    })
    .filter(Boolean)

  let files
  try {
    files = await globby('**/*', {
      cwd: absDir,
      gitignore: true,
      dot: true,
      onlyFiles: true,
      ignore: [...ALWAYS_IGNORE, ...extraIgnore]
    })
  } catch {
    return
  }

  for (const rel of files) {
    onFile(join(absDir, rel))
  }
}

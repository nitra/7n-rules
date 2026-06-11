/** @see ./docs/docgen-ignore.md */
import picomatch from 'picomatch'

/** Базовий список glob-ів для `docgen` ignore. */
export const DOCGEN_IGNORE_GLOBS = Object.freeze([
  '**/node_modules/**',
  '**/dist/**',
  '**/target/**',
  '.git/**',
  '**/__pycache__/**',
  '**/coverage/**',
  '.cursor/**',
  '.claude/**',
  '.pi/**',
  '.pi-template/**',
  '.worktrees/**',
  '**/benchmarks/**',
  '**/demo/**',
  '**/docs/**',
  'npm/reports/**',
  'npm/bin/**'
])

const IGNORE_MATCHERS = DOCGEN_IGNORE_GLOBS.map(glob => picomatch(glob, { dot: true }))

/**
 * Нормалізує відносний шлях до posix-формату для glob-matching.
 * @param {string} relPath відносний шлях із path.relative(...)
 * @returns {string} posix-вигляд шляху
 */
function toPosixRelPath(relPath) {
  return relPath.split('\\').join('/')
}

/**
 * Перевіряє, чи шлях має бути пропущений `docgen`.
 * Для `kind = 'dir'` це працює і на піддерево каталогу, тож glob на кшталт
 * `**\\/demo/**` спрацьовує на `demo/x` під час рекурсивного обходу.
 * @param {string} relPath відносний шлях від кореня проєкту
 * @param {'path'|'dir'} [kind] тип перевірки (за замовчуванням `'path'`)
 * @returns {boolean} `true`, якщо шлях ігнорується
 */
export function isDocgenIgnored(relPath, kind = 'path') {
  if (typeof relPath !== 'string' || relPath.length === 0) {
    return false
  }
  const posixRelPath = toPosixRelPath(relPath)
  if (kind === 'dir') {
    return IGNORE_MATCHERS.some(match => match(posixRelPath) || match(`${posixRelPath}/__docgen__`))
  }
  return IGNORE_MATCHERS.some(match => match(posixRelPath))
}

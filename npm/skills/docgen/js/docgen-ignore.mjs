/**
 * Глоби, які `docgen` завжди ігнорує.
 *
 * Це окремий snippet-модуль: список правиться тут, scanner лише читає його
 * через predicate. Патерни пишуться в posix-формі відносно кореня проєкту.
 */
import picomatch from 'picomatch'

/** Базовий список glob-ів для `docgen` ignore. */
export const DOCGEN_IGNORE_GLOBS = Object.freeze([
  '**/node_modules/**',
  '**/dist/**',
  '**/.git/**',
  '**/__pycache__/**',
  '**/coverage/**',
  '**/.cursor/**',
  '**/.claude/**',
  '.pi/**',
  '.pi-template/**',
  '.worktrees/**',
  '**/benchmarks/**',
  '**/demo/**',
  '**/docs/**'
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
 * Перевіряє, чи шлях (файл або каталог) має бути пропущений `docgen`.
 * Для каталогів це працює й на піддерева: glob на кшталт `**\\/demo/**`
 * спрацьовує на `demo/x` під час рекурсивного обходу.
 * @param {string} relPath відносний шлях від кореня проєкту
 * @returns {boolean} `true`, якщо шлях ігнорується
 */
export function isDocgenIgnoredPath(relPath) {
  if (typeof relPath !== 'string' || relPath.length === 0) {
    return false
  }
  const posixRelPath = toPosixRelPath(relPath)
  return IGNORE_MATCHERS.some(match => match(posixRelPath))
}

/**
 * Перевіряє, чи каталог ігнорується разом із усім піддеревом.
 * @param {string} relDir відносний шлях каталогу від кореня проєкту
 * @returns {boolean} `true`, якщо каталог не треба обходити
 */
export function isDocgenIgnoredDir(relDir) {
  if (typeof relDir !== 'string' || relDir.length === 0) {
    return false
  }
  const posixRelDir = toPosixRelPath(relDir)
  return IGNORE_MATCHERS.some(match => match(posixRelDir) || match(`${posixRelDir}/__docgen__`))
}

/** @see ./docs/walkDir.md */
import { join, relative, resolve, sep } from 'node:path'
import { globby } from 'globby'

/**
 * Сесійні git-worktree чекаути (Claude/агенти): повні копії репо, не робочий код.
 * Споживацькі репо часто не мають цих шляхів у .gitignore, тож без safety net
 * lint-обхід бачив би дубль усього дерева.
 */
export const WORKTREE_CHECKOUT_GLOBS = ['**/.worktrees/**', '**/.claude/worktrees/**']

/**
 * .git ніколи не потрапляє в .gitignore — пропускаємо завжди.
 * node_modules — safety net: проєкт може не мати .gitignore або запускатись поза git-репо.
 */
export const ALWAYS_IGNORE = ['.git/**', 'node_modules/**', ...WORKTREE_CHECKOUT_GLOBS]

const WORKTREE_CHECKOUT_RE = /(?:^|\/)(?:\.worktrees|\.claude\/worktrees)\//u

/**
 * Чи лежить відносний posix-шлях усередині worktree-чекаута (`.worktrees/` або
 * `.claude/worktrees/`). Для фільтрації git-списків, що не проходять через walkDir.
 * @param {string} relPath відносний posix-шлях від кореня репо.
 * @returns {boolean} true, якщо шлях у worktree-чекауті.
 */
export function isWorktreeCheckoutPath(relPath) {
  return WORKTREE_CHECKOUT_RE.test(relPath)
}

/**
 * Прибирає всі кінцеві `/` без regex-бектрекінгу.
 * @param {string} p вхідний шлях.
 * @returns {string} шлях без кінцевих слешів.
 */
function stripTrailingSlashes(p) {
  let end = p.length
  while (end > 0 && p[end - 1] === '/') end -= 1
  return p.slice(0, end)
}

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
      const abs = resolve(stripTrailingSlashes(p))
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

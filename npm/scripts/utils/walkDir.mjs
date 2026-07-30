/** @see ./docs/walkDir.md */
import { join, relative, resolve, sep } from 'node:path'

import { loadNative } from '@7n/rules/scripts/lib/native.mjs'

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
 * Двигун — native (`rules-core::scan::walk_dir` через `rules-napi`, D2 фази
 * 4а `docs/specs/2026-07-30-rules-v2-rust-core-migration.md`): `ignore`-крейт
 * замість `globby`, семантика звірена пункт за пунктом (doc-комент
 * `crates/rules-core/src/scan.rs`). Порядок обходу тепер детермінований
 * (байтово-лексикографічний, від native), а не залежний від внутрішнього
 * ходу `fast-glob`.
 * Сама функція синхронна (native-виклик синхронний, Р2 спеки), але лишається
 * без `async` навмисно (`require-await`): усі 46 call-site'ів роблять
 * `await walkDir(...)`, що коректно спрацьовує і на не-Promise значенні.
 * @param {string} dir абсолютний або відносний шлях до кореня обходу
 * @param {(filePath: string) => void} onFile колбек для кожного файлу (абсолютний шлях)
 * @param {string[]} [ignorePaths] додаткові шляхи для пропуску (абсолютні або відносні від cwd)
 * @returns {void}
 */
export function walkDir(dir, onFile, ignorePaths = []) {
  const absDir = resolve(dir)

  // Нормалізація ignorePaths лишається в JS — завʼязана на process.cwd(),
  // якого немає у rules-core (doc-комент crates/rules-core/src/scan.rs).
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
    files = loadNative().walkDir(absDir, extraIgnore)
  } catch {
    // fail-safe контракт: будь-яка помилка (не лише всередині native,
    // а й, наприклад, недоступний аддон) → мовчазний return, без onFile.
    return
  }

  for (const rel of files) {
    onFile(join(absDir, rel))
  }
}

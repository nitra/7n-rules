/**
 * Гарантує, що кореневий `.gitignore` проєкту ігнорує локальні git-worktree
 * (`.worktrees/`). Викликається з дефолтного sync (`npx \@nitra/cursor`) окремим
 * top-level кроком — поза `syncClaudeConfig`, бо `.worktrees/` — артефакт
 * завжди-активного flow/worktree-tooling, а не Claude/Cursor-конфігу.
 *
 * Один запис `.worktrees/` покриває каталог worktree та всі sibling-файли в ньому
 * (`<branch>.flow.json`, `.events.jsonl`, `<name>.md`, `.flow-lock-*`). Запис
 * безумовний (без гейта за `.n-cursor.json`-правилами): продюсер артефактів —
 * завжди-активний flow, тож гейт міг би розсинхронитися з ним.
 *
 * Делегує наявній idempotent+append-only утиліті `ensureGitignoreEntries` (header-
 * секція, не перезаписує/не видаляє наявні рядки; створює `.gitignore`, якщо нема).
 */
import { ensureGitignoreEntries } from '../utils/ensure-gitignore-entries.mjs'

/** Header-секція для керованого запису у `.gitignore`. */
const WORKTREE_SECTION_LABEL = '@nitra/cursor — локальні git-worktree, не коміти'

/**
 * Дописує `.worktrees/` у кореневий `.gitignore`, якщо рядка ще немає.
 * @param {string} projectRoot корінь проєкту-споживача (де `.gitignore`)
 * @returns {Promise<{ written: boolean }>} чи був дописаний рядок
 */
export async function syncGitignoreWorktree(projectRoot) {
  const { added } = await ensureGitignoreEntries(projectRoot, ['.worktrees/'], WORKTREE_SECTION_LABEL)
  return { written: added.length > 0 }
}

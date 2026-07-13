/**
 * Гарантує, що кореневий `.gitignore` проєкту ігнорує локальні git-worktree
 * (`.worktrees/`). Викликається з дефолтного sync (`npx \@7n/rules`) окремим
 * top-level кроком — поза `syncClaudeConfig`, бо `.worktrees/` — артефакт
 * завжди-активного worktree-tooling, а не Claude/Cursor-конфігу.
 *
 * Один запис `.worktrees/` покриває checkout-и та локальні описи worktree.
 * Запис безумовний (без гейта за `.n-rules.json`-правилами), щоб config не міг
 * розсинхронитися з реальною поведінкою worktree-команд.
 *
 * Делегує наявній idempotent+append-only утиліті `ensureGitignoreEntries` (header-
 * секція, не перезаписує/не видаляє наявні рядки; створює `.gitignore`, якщо нема).
 */
import { ensureGitignoreEntries } from '../utils/ensure-gitignore-entries.mjs'

/** Header-секція для керованого запису у `.gitignore`. */
const WORKTREE_SECTION_LABEL = '@7n/rules — локальні git-worktree, не коміти'

/**
 * Дописує `.worktrees/` у кореневий `.gitignore`, якщо рядка ще немає.
 * @param {string} projectRoot корінь проєкту-споживача (де `.gitignore`)
 * @returns {Promise<{ written: boolean }>} чи був дописаний рядок
 */
export async function syncGitignoreWorktree(projectRoot) {
  const { added } = await ensureGitignoreEntries(projectRoot, ['.worktrees/'], WORKTREE_SECTION_LABEL)
  return { written: added.length > 0 }
}

/**
 * Вшивання worktree-інструкції у синкнутий `SKILL.md` (рішення D2 зі spec).
 *
 * Коли `meta.json.worktree === true`, скіл має виконуватись в окремому git-worktree
 * і не паралелитись. Підказка адресована агенту, який читає `SKILL.md`, тож
 * вставляється в текст між стабільними маркерами — ре-синк ідемпотентний:
 * наявний блок замінюється, при `worktree:false` — видаляється.
 */

/** Маркер початку worktree-блоку (стабільний, не залежить від тексту всередині). */
export const WORKTREE_START = '<!-- n-cursor:worktree:start -->'
/** Маркер кінця worktree-блоку. */
export const WORKTREE_END = '<!-- n-cursor:worktree:end -->'

const NOTICE_BODY = `> [!IMPORTANT]
> **Worktree-only skill.** Виконується **виключно** в окремому git-worktree (\`.worktrees/<branch>/\`) і **не** паралелиться — один інстанс за раз.

**Крок 0 — preflight (обовʼязковий, перед будь-якими іншими діями).** Якщо перевірка падає — **STOP**: створи worktree і лише тоді продовжуй. Не виконуй **жоден** наступний крок скіла, поки preflight не завершився успіхом.

\`\`\`bash
git rev-parse --show-toplevel | grep -q '/\\.worktrees/' \\
  || { echo "ABORT: не у worktree. Спершу: npx @nitra/cursor worktree add <branch> \\"<навіщо>\\" && cd .worktrees/<branch>"; exit 1; }
\`\`\``

/** Наявний блок разом із сусідніми порожніми рядками (для чистого видалення). */
const BLOCK_RE = /\n*<!-- n-cursor:worktree:start -->[\s\S]*?<!-- n-cursor:worktree:end -->\n*/u

/** Закриття YAML-frontmatter на початку файла. */
const FRONTMATTER_RE = /^(---\n[\s\S]*?\n---\n)/u

/**
 * Канонічний блок worktree-інструкції.
 * @returns {string} текст блоку від START до END
 */
function buildBlock() {
  return `${WORKTREE_START}\n${NOTICE_BODY}\n${WORKTREE_END}`
}

/**
 * Вставляє / оновлює / видаляє worktree-блок у вмісті `SKILL.md`.
 * @param {string} content вміст `SKILL.md`
 * @param {boolean} enabled чи має бути блок (значення `meta.json.worktree`)
 * @returns {string} оновлений вміст (ідемпотентно)
 */
export function injectWorktreeNotice(content, enabled) {
  const hadBlock = content.includes(WORKTREE_START)
  const withoutBlock = content.replace(BLOCK_RE, '\n\n')

  if (!enabled) {
    return hadBlock ? withoutBlock : content
  }

  const block = buildBlock()
  const fm = withoutBlock.match(FRONTMATTER_RE)
  if (fm) {
    const head = fm[1]
    const rest = withoutBlock.slice(head.length).replace(/^\n+/u, '')
    return `${head}\n${block}\n\n${rest}`
  }
  return `${block}\n\n${withoutBlock.replace(/^\n+/u, '')}`
}

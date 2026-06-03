/**
 * Вшивання root-guard preflight у синкнутий `SKILL.md` для скілів, що **мутують
 * проєкт у поточному каталозі**, але виконуються **in-place** (без worktree-
 * ізоляції) — `meta.json` → `requireRoot: true` і `worktree: false`.
 *
 * Worktree-скіли (`worktree: true`) свій root-assert уже мають у worktree-блоці
 * (`worktree-notice.mjs`): корінь worktree = його toplevel. Цей модуль — для
 * не-worktree-кейсу (напр. `n-start-check`, що прогоняє `start` усіх воркспейсів
 * у місці й має стартувати з кореня монорепо).
 *
 * Блок — інструкція агенту, що читає `SKILL.md`; вставляється між стабільними
 * маркерами, ре-синк ідемпотентний: наявний блок замінюється, при `false` —
 * видаляється. Програмний аналог для CLI-команд — `assertCwdIsProjectRoot`.
 */

/** Маркер початку root-блоку. */
export const ROOT_START = '<!-- n-cursor:root:start -->'
/** Маркер кінця root-блоку. */
export const ROOT_END = '<!-- n-cursor:root:end -->'

/** Наявний блок разом із сусідніми порожніми рядками (для чистого видалення). */
const BLOCK_RE = /\n*<!-- n-cursor:root:start -->[\s\S]*?<!-- n-cursor:root:end -->\n*/u

/** Закриття YAML-frontmatter на початку файла. */
const FRONTMATTER_RE = /^(---\n[\s\S]*?\n---\n)/u

/** Тіло root-guard інструкції. */
const NOTICE_BODY = `> [!IMPORTANT]
> **Root-only skill.** Скіл мутує проєкт у поточному каталозі й має запускатися **з кореня репозиторію**.

**Крок 0 — preflight (обовʼязковий, перед будь-якими іншими діями).**

\`\`\`bash
pwd
git rev-parse --show-toplevel
\`\`\`

Якщо \`pwd\` **не** збігається з виводом \`git rev-parse --show-toplevel\` — ти в **піддиректорії**. **STOP**: перейди в корінь (\`cd <toplevel>\`, literal-шлях із виводу) і лише тоді виконуй наступні кроки скіла. Поза git-репо (команда без виводу) — продовжуй (корінь визначити неможливо).`

/** Канонічний блок root-інструкції (з маркерами). */
const BLOCK = `${ROOT_START}\n${NOTICE_BODY}\n${ROOT_END}`

/**
 * Вставляє / оновлює / видаляє root-guard блок у вмісті `SKILL.md`.
 * @param {string} content вміст `SKILL.md`
 * @param {boolean} enabled чи має бути блок (`requireRoot && !worktree`)
 * @returns {string} оновлений вміст (ідемпотентно)
 */
export function injectRootNotice(content, enabled) {
  const hadBlock = content.includes(ROOT_START)
  const withoutBlock = content.replace(BLOCK_RE, '\n\n')

  if (!enabled) {
    return hadBlock ? withoutBlock : content
  }

  const fm = withoutBlock.match(FRONTMATTER_RE)
  if (fm) {
    const head = fm[1]
    const rest = withoutBlock.slice(head.length).replace(/^\n+/u, '')
    return `${head}\n${BLOCK}\n\n${rest}`
  }
  return `${BLOCK}\n\n${withoutBlock.replace(/^\n+/u, '')}`
}

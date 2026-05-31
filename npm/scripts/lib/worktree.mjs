/**
 * Чиста логіка worktree-tool `n-cursor worktree` (без git/fs side-effects).
 *
 * Тут — детерміновані, тестовані без git функції:
 *  - `sanitizeBranch` — імʼя гілки → безпечне імʼя каталогу/файла (слеш та інші
 *    небезпечні для шляху символи → дефіс), щоб структура `.worktrees/` лишалась пласкою;
 *  - `worktreePaths` — шляхи checkout і файла-опису поруч;
 *  - `buildDescription` — текст інвентарного `.worktrees/<name>.md` за конвенцією worktree.mdc;
 *  - `findOrphanDescFiles` — `.md`-описи без зареєстрованого worktree (для `prune`).
 *
 * Оркестрація (виклики git, запис файлів, argv) — у `npm/scripts/worktree-cli.mjs`.
 */
import { basename, join } from 'node:path'

/** Символи, безпечні для імені каталогу/файла; решта → дефіс. */
const UNSAFE_PATH_CHARS_RE = /[^a-zA-Z0-9._-]+/gu

/**
 * Перетворює імʼя git-гілки на безпечне імʼя каталогу/файла для `.worktrees/`.
 * @param {string} branch імʼя git-гілки (наприклад `feat/skill-meta`)
 * @returns {string} пласке імʼя (наприклад `feat-skill-meta`)
 */
export function sanitizeBranch(branch) {
  if (typeof branch !== 'string' || branch.trim() === '') {
    throw new Error('worktree: імʼя гілки обовʼязкове')
  }
  const sanitized = branch.trim().replace(UNSAFE_PATH_CHARS_RE, '-').replace(/^-+|-+$/gu, '')
  if (sanitized === '') {
    throw new Error(`worktree: імʼя гілки "${branch}" не містить допустимих символів`)
  }
  return sanitized
}

/**
 * Детерміновані шляхи checkout і файла-опису для гілки.
 * @param {string} repoRoot абсолютний корінь репозиторію
 * @param {string} branch імʼя git-гілки
 * @returns {{ checkout: string, descFile: string }} абсолютні шляхи
 */
export function worktreePaths(repoRoot, branch) {
  const name = sanitizeBranch(branch)
  const dir = join(repoRoot, '.worktrees')
  return { checkout: join(dir, name), descFile: join(dir, `${name}.md`) }
}

/**
 * Текст інвентарного файла-опису worktree.
 * @param {{ branch: string, task: string, baseCommit: string, date: string }} params поля опису
 * @returns {string} markdown-вміст `.worktrees/<name>.md`
 */
export function buildDescription({ branch, task, baseCommit, date }) {
  return [
    `# ${branch}`,
    '',
    `**Задача:** ${task}`,
    `**Дата:** ${date}`,
    `**База (коміт):** ${baseCommit}`,
    '',
    'Прибрати: ' + '`' + `npx @nitra/cursor worktree remove ${branch}` + '`',
    ''
  ].join('\n')
}

/**
 * `.md`-описи без відповідного зареєстрованого worktree-checkout.
 * @param {string[]} descFiles абсолютні шляхи `.worktrees/*.md`
 * @param {string[]} registeredCheckouts абсолютні шляхи зареєстрованих worktree-checkout
 * @returns {string[]} осиротілі `.md` (підмножина `descFiles`)
 */
export function findOrphanDescFiles(descFiles, registeredCheckouts) {
  const checkoutBasenames = new Set(registeredCheckouts.map(c => basename(c)))
  return descFiles.filter(md => !checkoutBasenames.has(basename(md).replace(/\.md$/u, '')))
}

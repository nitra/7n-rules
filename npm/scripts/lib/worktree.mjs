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
  const sanitized = branch
    .trim()
    .replace(UNSAFE_PATH_CHARS_RE, '-')
    .replaceAll(/^-+|-+$/gu, '')
  if (sanitized === '') {
    throw new Error(`worktree: імʼя гілки "${branch}" не містить допустимих символів`)
  }
  return sanitized
}

/**
 * Перша вільна назва гілки за конвенцією `base`, `base2`, `base3`, … —
 * суфікс просто число без розділювача (як `main-fix` → `main-fix2`).
 * Дає змогу `worktree add` спершу перевірити зайнятість і обрати назву,
 * що спрацює, замість падіння на `fatal: a branch named '…' already exists`.
 * @param {string} branch бажане імʼя гілки
 * @param {(candidate: string) => boolean} isTaken чи зайнята назва (гілка/worktree вже існують)
 * @param {number} [limit] стеля кількості спроб (захист від нескінченного циклу)
 * @returns {string} перша вільна назва (= `branch`, якщо вона вільна)
 */
export function firstFreeBranch(branch, isTaken, limit = 1000) {
  if (typeof branch !== 'string' || branch.trim() === '') {
    throw new Error('worktree: імʼя гілки обовʼязкове')
  }
  const base = branch.trim()
  if (!isTaken(base)) return base
  for (let n = 2; n <= limit; n++) {
    const candidate = `${base}${n}`
    if (!isTaken(candidate)) return candidate
  }
  throw new Error(`worktree: не знайдено вільної назви для "${base}" за ${limit} спроб`)
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

/** Поріг переліку файлів у нагадуванні: понад нього показуємо лише кількість. */
const DIRTY_LIST_LIMIT = 10

/**
 * Нагадування про незакомічені зміни основного дерева, які **не** потрапляють
 * у новий worktree (він створюється від HEAD, без брудного стану). До
 * `limit` файлів — перелік шляхів; більше — лише підсумкова кількість, щоб не
 * залити екран. Призначене для виводу одразу після `worktree add`.
 * @param {string} porcelain вивід `git status --porcelain` основного дерева
 * @param {number} [limit] поріг переліку (понад нього — лише кількість)
 * @returns {string | null} текст нагадування або `null`, якщо дерево чисте
 */
export function buildDirtyNotice(porcelain, limit = DIRTY_LIST_LIMIT) {
  // Порядок: XY + пробіл (3 символи) + шлях; для перейменування — `orig -> dest`.
  const files = String(porcelain ?? '')
    .split('\n')
    .map(line => line.slice(3).trim())
    .filter(Boolean)
  if (files.length === 0) return null
  const head = `⚠️  Основне дерево має ${files.length} незакомічених змін — вони НЕ потрапили в цей worktree (створено від HEAD).`
  const tail = '   Закоміть потрібні файли, якщо worktree-скіл має їх бачити.'
  if (files.length > limit) return `${head}\n${tail}`
  const list = files.map(f => `   - ${f}`).join('\n')
  return `${head}\n${list}\n${tail}`
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

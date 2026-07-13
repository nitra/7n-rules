/**
 * Вшивання worktree-інструкції у синкнутий `SKILL.md` (рішення D2 зі spec).
 *
 * Коли `main.json.worktree === true`, скіл має виконуватись в окремому git-worktree
 * і не паралелитись. Підказка адресована агенту, який читає `SKILL.md`, тож
 * вставляється в текст між стабільними маркерами — ре-синк ідемпотентний:
 * наявний блок замінюється, при `worktree:false` — видаляється.
 *
 * Крок 0.1 блоку додає `bun install` у щойно створеному дереві (локальна копія
 * CLI усуває гонку з CDN) і shell-обгортку `n_rules_npx` навколо bootstrap-виклику
 * `npx`: на ETARGET/notarget та мережевих помилках npm падає ДО запуску бінарника,
 * тож retry мусить жити на рівні shell-інструкції, а не в JS-хендлерах CLI.
 * Обгортка ретраїть лише транзитні помилки реєстру/мережі (30с інтервал, дефолт
 * 5 хв, env `N_RULES_NPX_RETRY_MAX_MIN`, ceiling 10 хв) і віддає реальний nonzero
 * CLI одразу. Команди винесені окремим кроком ПІСЛЯ worktree-створення, бо
 * вимагають command substitution, заборонену у «без-expansion» preflight-снипеті
 * (узгоджено з worktree.mdc).
 */

/** Маркер початку worktree-блоку (стабільний, не залежить від тексту всередині). */
export const WORKTREE_START = '<!-- n-rules:worktree:start -->'
/** Маркер кінця worktree-блоку. */
export const WORKTREE_END = '<!-- n-rules:worktree:end -->'

const FALLBACK_SUFFIX = 'task'

/** Наявний блок разом із сусідніми порожніми рядками (для чистого видалення). */
// Матчить і legacy `n-rules:`-маркери, щоб ре-синк замінював блоки, згенеровані до перейменування пакету
const BLOCK_RE =
  /\n{0,8}<!-- n-(?:cursor|rules):worktree:start -->[\s\S]*?<!-- n-(?:cursor|rules):worktree:end -->\n{0,8}/u

/** Закриття YAML-frontmatter на початку файла. */
const FRONTMATTER_RE = /^(---\n[\s\S]*?\n---\n)/u

/** Значення `name` з YAML-frontmatter. */
const NAME_RE = /^name:[ \t]{0,8}["']?([^"'\n]+?)["']?[ \t]{0,8}$/mu

/** Перший H1 як fallback, якщо frontmatter не містить `name`. */
const H1_RE = /^#[ \t]{1,8}(.+)$/mu

const N_PREFIX_RE = /^n-/u
const COMBINING_DIACRITICS_RE = /[̀-ͯ]/gu
const NON_ALPHANUM_RE = /[^a-z0-9]+/gu
const TRAILING_DASHES_RE = /^-{1,80}|-{1,80}$/gu
const TRAILING_DASH_RE = /-{1,80}$/u
const LEADING_NEWLINES_RE = /^\n+/u

const CYRILLIC_TRANSLIT = new Map(
  Object.entries({
    а: 'a',
    б: 'b',
    в: 'v',
    г: 'h',
    ґ: 'g',
    д: 'd',
    е: 'e',
    є: 'ye',
    ж: 'zh',
    з: 'z',
    и: 'y',
    і: 'i',
    ї: 'yi',
    й: 'y',
    к: 'k',
    л: 'l',
    м: 'm',
    н: 'n',
    о: 'o',
    п: 'p',
    р: 'r',
    с: 's',
    т: 't',
    у: 'u',
    ф: 'f',
    х: 'kh',
    ц: 'ts',
    ч: 'ch',
    ш: 'sh',
    щ: 'shch',
    ь: '',
    ю: 'yu',
    я: 'ya',
    ы: 'y',
    э: 'e',
    ё: 'yo',
    ъ: ''
  })
)

/**
 * Транслітерує кирилицю в ASCII для короткого suffix.
 * @param {string} value вхідний текст
 * @returns {string} транслітерований текст
 */
function transliterate(value) {
  return Array.from(value.toLowerCase(), char => CYRILLIC_TRANSLIT.get(char) ?? char).join('')
}

/**
 * Робить короткий безпечний suffix для worktree-гілки з назви скіла.
 * @param {string} content вміст `SKILL.md`
 * @returns {string} suffix до 10 символів
 */
function deriveSuffix(content) {
  const raw = content.match(NAME_RE)?.[1] ?? content.match(H1_RE)?.[1] ?? FALLBACK_SUFFIX
  const slug = transliterate(raw)
    .trim()
    .replace(N_PREFIX_RE, '')
    .normalize('NFKD')
    .replaceAll(COMBINING_DIACRITICS_RE, '')
    .replaceAll(NON_ALPHANUM_RE, '-')
    .replaceAll(TRAILING_DASHES_RE, '')

  return (slug || FALLBACK_SUFFIX).slice(0, 10).replace(TRAILING_DASH_RE, '') || FALLBACK_SUFFIX
}

/**
 * Тіло worktree-інструкції з конкретним суфіксом, щоб агент не питав назву гілки.
 * @param {string} suffix короткий suffix задачі
 * @returns {string} markdown-блок без маркерів
 */
function buildNoticeBody(suffix) {
  return `> [!IMPORTANT]
> **Worktree-only skill.** Виконується **виключно** в окремому git-worktree (\`.worktrees/<current-branch>-${suffix}/\`) і **не** паралелиться — один інстанс за раз.

**Крок 0 — preflight (обовʼязковий, перед будь-якими іншими діями).** Якщо перевірка падає — **STOP**: не питай користувача про назву гілки, а сам створи worktree від поточної гілки за конвенцією \`<current-branch>-${suffix}\`. Суфікс \`${suffix}\` — коротка (до 10 символів) транслітерація задачі. Не виконуй **жоден** наступний крок скіла, поки preflight не завершився успіхом.

\`\`\`bash
pwd
git rev-parse --show-toplevel
git branch --show-current
\`\`\`

**Root-assert.** Якщо \`pwd\` **не** збігається з виводом \`git rev-parse --show-toplevel\` — ти в **піддиректорії** робочого дерева (worktree-шляхи нижче відносні до кореня репо). Спершу перейди в корінь: \`cd <toplevel>\` (literal-шлях із виводу), і лише тоді продовжуй preflight. Не створюй worktree з піддиректорії — \`cd .worktrees/<…>\` звідти впаде.

Якщо \`git rev-parse --show-toplevel\` показав, що ти **не** в \`.worktrees/\`, візьми вивід \`git branch --show-current\` як \`<current-branch>\` і виконай **literal-команди без shell expansion** (без command substitution, variable expansion чи backticks). Наприклад, якщо поточна гілка \`feature/x\`:

\`\`\`bash
npx @7n/mt worktree create "feature/x-${suffix}" "n-${suffix}: worktree-only skill"
cd ".worktrees/feature-x-${suffix}"
\`\`\`

Тобто branch-argument лишає slash як у git-гілці, а шлях для \`cd\` бере sanitized форму: slash → \`-\`.

**Крок 0.1 — bootstrap у новому дереві (після \`cd\`).** Дерево щойно створене й **без** \`node_modules\`. Постав залежності локально — тоді \`npx @7n/rules <cmd>\` бере локальну копію без походу в реєстр:

\`\`\`bash
bun install
\`\`\``
}

/**
 * Канонічний блок worktree-інструкції.
 * @param {string} content вміст `SKILL.md`
 * @returns {string} текст блоку від START до END
 */
function buildBlock(content) {
  return `${WORKTREE_START}\n${buildNoticeBody(deriveSuffix(content))}\n${WORKTREE_END}`
}

/**
 * Вставляє / оновлює / видаляє worktree-блок у вмісті `SKILL.md`.
 * @param {string} content вміст `SKILL.md`
 * @param {boolean} enabled чи має бути блок (значення `main.json.worktree`)
 * @returns {string} оновлений вміст (ідемпотентно)
 */
export function injectWorktreeNotice(content, enabled) {
  const hadBlock = content.includes(WORKTREE_START)
  const withoutBlock = content.replace(BLOCK_RE, '\n\n')

  if (!enabled) {
    return hadBlock ? withoutBlock : content
  }

  const block = buildBlock(withoutBlock)
  const fm = withoutBlock.match(FRONTMATTER_RE)
  if (fm) {
    const head = fm[1]
    const rest = withoutBlock.slice(head.length).replace(LEADING_NEWLINES_RE, '')
    return `${head}\n${block}\n\n${rest}`
  }
  return `${block}\n\n${withoutBlock.replace(LEADING_NEWLINES_RE, '')}`
}

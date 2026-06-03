/**
 * Вшивання worktree-інструкції у синкнутий `SKILL.md` (рішення D2 зі spec).
 *
 * Коли `meta.json.worktree === true`, скіл має виконуватись в окремому git-worktree
 * і не паралелитись. Підказка адресована агенту, який читає `SKILL.md`, тож
 * вставляється в текст між стабільними маркерами — ре-синк ідемпотентний:
 * наявний блок замінюється, при `worktree:false` — видаляється.
 *
 * Крок 0.1 блоку додає `bun install` у щойно створеному дереві (локальна копія
 * CLI усуває гонку з CDN) і shell-обгортку `n_cursor_npx` навколо bootstrap-виклику
 * `npx`: на ETARGET/notarget та мережевих помилках npm падає ДО запуску бінарника,
 * тож retry мусить жити на рівні shell-інструкції, а не в JS-хендлерах CLI.
 * Обгортка ретраїть лише транзитні помилки реєстру/мережі (30с інтервал, дефолт
 * 5 хв, env `N_CURSOR_NPX_RETRY_MAX_MIN`, ceiling 10 хв) і віддає реальний nonzero
 * CLI одразу. Команди винесені окремим кроком ПІСЛЯ worktree-створення, бо
 * вимагають command substitution, заборонену у «без-expansion» preflight-снипеті
 * (узгоджено з worktree.mdc).
 */

/** Маркер початку worktree-блоку (стабільний, не залежить від тексту всередині). */
export const WORKTREE_START = '<!-- n-cursor:worktree:start -->'
/** Маркер кінця worktree-блоку. */
export const WORKTREE_END = '<!-- n-cursor:worktree:end -->'

const FALLBACK_SUFFIX = 'task'

/** Наявний блок разом із сусідніми порожніми рядками (для чистого видалення). */
const BLOCK_RE = /\n*<!-- n-cursor:worktree:start -->[\s\S]*?<!-- n-cursor:worktree:end -->\n*/u

/** Закриття YAML-frontmatter на початку файла. */
const FRONTMATTER_RE = /^(---\n[\s\S]*?\n---\n)/u

/** Значення `name` з YAML-frontmatter. */
const NAME_RE = /^name:\s*["']?([^"'\n]+)["']?\s*$/mu

/** Перший H1 як fallback, якщо frontmatter не містить `name`. */
const H1_RE = /^#\s+(.+)$/mu

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
    .replace(/^n-/u, '')
    .normalize('NFKD')
    .replaceAll(/[\u0300-\u036F]/gu, '')
    .replaceAll(/[^a-z0-9]+/gu, '-')
    .replaceAll(/^-+|-+$/gu, '')

  return (slug || FALLBACK_SUFFIX).slice(0, 10).replace(/-+$/u, '') || FALLBACK_SUFFIX
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
npx @nitra/cursor worktree add "feature/x-${suffix}" "n-${suffix}: worktree-only skill"
cd ".worktrees/feature-x-${suffix}"
\`\`\`

Тобто branch-argument лишає slash як у git-гілці, а шлях для \`cd\` бере sanitized форму: slash → \`-\`.

**Крок 0.1 — bootstrap у новому дереві (після \`cd\`, окремий крок — поза «без-expansion» блоком вище).** Дерево щойно створене й **без** \`node_modules\`. Спершу постав залежності локально: тоді \`npx\` бере локальну копію \`@nitra/cursor\` і гонки з CDN немає взагалі. Retry-обгортка нижче — safety-net на випадок, коли версію щойно опубліковано, але edge-кеш CDN ще її не має: \`npm\` тоді падає з \`ETARGET\`/\`notarget\` **до** запуску бінарника (внутрішній JS-retry у \`n-cursor\` для цього кейсу марний — бінарник ще не стартував).

\`\`\`bash
# Локальна копія @nitra/cursor (девзалежність споживача) — npx бере її, без походу в реєстр.
bun install

# n_cursor_npx <args> — обгортка bootstrap-виклику "npx @nitra/cursor <args>".
# Ретраїмо ЛИШЕ транзитні помилки реєстру/мережі (CDN ще не пропагував щойно
# опубліковану версію). Реальний nonzero від CLI (fix повернув ❌, lint-помилка) —
# віддаємо одразу, без ретраю. Інтервал 30с; дефолт-ліміт 5 хв
# (env N_CURSOR_NPX_RETRY_MAX_MIN), hard-ceiling 10 хв.
# Чому 5 хв: CDN-пропагація npm зазвичай < 2 хв, 5 хв — запас; довше → ймовірно
# реальна проблема (невірна версія / аутейдж), краще віддати помилку, ніж висіти.
n_cursor_npx() {
  max_min="\${N_CURSOR_NPX_RETRY_MAX_MIN:-5}"
  case "$max_min" in '' | *[!0-9]*) max_min=5 ;; esac
  [ "$max_min" -gt 10 ] && max_min=10
  deadline=$(( $(date +%s) + max_min * 60 ))
  attempt=1
  transient='ETARGET|notarget|No matching version|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|ECONNRESET|50[0-9] |502 Bad Gateway|503 Service Unavailable|504 Gateway'
  while :; do
    err=$(mktemp)
    npx @nitra/cursor "$@" 2>"$err"
    code=$?
    cat "$err" >&2
    [ "$code" -eq 0 ] && { rm -f "$err"; return 0; }
    if grep -Eq "$transient" "$err" && [ "$(date +%s)" -lt "$deadline" ]; then
      rm -f "$err"
      echo "n-cursor: очікую пропагації версії по CDN… спроба $attempt, повтор через 30с" >&2
      attempt=$((attempt + 1))
      sleep 30
    else
      rm -f "$err"
      return "$code"
    fi
  done
}
\`\`\`

Усі подальші bootstrap-виклики \`npx @nitra/cursor <cmd>\` у цій сесії роби через \`n_cursor_npx <cmd>\`. Якщо опинився у свіжому shell без цієї функції — спершу повтори блок вище (\`bun install\` + визначення \`n_cursor_npx\`).`
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
 * @param {boolean} enabled чи має бути блок (значення `meta.json.worktree`)
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
    const rest = withoutBlock.slice(head.length).replace(/^\n+/u, '')
    return `${head}\n${block}\n\n${rest}`
  }
  return `${block}\n\n${withoutBlock.replace(/^\n+/u, '')}`
}

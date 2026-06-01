/**
 * Вшивання worktree-інструкції у синкнутий `SKILL.md` (рішення D2 зі spec).
 *
 * Коли `meta.json.worktree === true`, скіл має виконуватись в окремому git-worktree
 * і не паралелитись. Підказка адресована агенту, який читає `SKILL.md`, тож
 * вставляється в текст між стабільними маркерами — ре-синк ідемпотентний:
 * наявний блок замінюється, при `worktree:false` — видаляється.
 */

/** Маркер початку worktree-блоку (стабільний, не залежить від тексту всередині). */
export const WORKTREE_START = "<!-- n-cursor:worktree:start -->";
/** Маркер кінця worktree-блоку. */
export const WORKTREE_END = "<!-- n-cursor:worktree:end -->";

const FALLBACK_SUFFIX = "task";

/** Наявний блок разом із сусідніми порожніми рядками (для чистого видалення). */
const BLOCK_RE =
  /\n*<!-- n-cursor:worktree:start -->[\s\S]*?<!-- n-cursor:worktree:end -->\n*/u;

/** Закриття YAML-frontmatter на початку файла. */
const FRONTMATTER_RE = /^(---\n[\s\S]*?\n---\n)/u;

/** Значення `name` з YAML-frontmatter. */
const NAME_RE = /^name:\s*["']?([^"'\n]+)["']?\s*$/mu;

/** Перший H1 як fallback, якщо frontmatter не містить `name`. */
const H1_RE = /^#\s+(.+)$/mu;

const CYRILLIC_TRANSLIT = new Map(
  Object.entries({
    а: "a",
    б: "b",
    в: "v",
    г: "h",
    ґ: "g",
    д: "d",
    е: "e",
    є: "ye",
    ж: "zh",
    з: "z",
    и: "y",
    і: "i",
    ї: "yi",
    й: "y",
    к: "k",
    л: "l",
    м: "m",
    н: "n",
    о: "o",
    п: "p",
    р: "r",
    с: "s",
    т: "t",
    у: "u",
    ф: "f",
    х: "kh",
    ц: "ts",
    ч: "ch",
    ш: "sh",
    щ: "shch",
    ь: "",
    ю: "yu",
    я: "ya",
    ы: "y",
    э: "e",
    ё: "yo",
    ъ: "",
  }),
);

/**
 * Транслітерує кирилицю в ASCII для короткого suffix.
 * @param {string} value вхідний текст
 * @returns {string} транслітерований текст
 */
function transliterate(value) {
  return [...value.toLowerCase()]
    .map((char) => CYRILLIC_TRANSLIT.get(char) ?? char)
    .join("");
}

/**
 * Робить короткий безпечний suffix для worktree-гілки з назви скіла.
 * @param {string} content вміст `SKILL.md`
 * @returns {string} suffix до 10 символів
 */
function deriveSuffix(content) {
  const raw =
    content.match(NAME_RE)?.[1] ?? content.match(H1_RE)?.[1] ?? FALLBACK_SUFFIX;
  const slug = transliterate(raw)
    .trim()
    .replace(/^n-/u, "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");

  return (
    (slug || FALLBACK_SUFFIX).slice(0, 10).replace(/-+$/u, "") ||
    FALLBACK_SUFFIX
  );
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
if ! git rev-parse --show-toplevel | grep -q '/\\.worktrees/'; then
  B=$(git branch --show-current)
  W="\${B}-${suffix}"
  P="\${W//\\//-}"
  npx @nitra/cursor worktree add "$W" "n-${suffix}: worktree-only skill"
  cd ".worktrees/\${P}"
fi
\`\`\``;
}

/**
 * Канонічний блок worktree-інструкції.
 * @param {string} content вміст `SKILL.md`
 * @returns {string} текст блоку від START до END
 */
function buildBlock(content) {
  return `${WORKTREE_START}\n${buildNoticeBody(deriveSuffix(content))}\n${WORKTREE_END}`;
}

/**
 * Вставляє / оновлює / видаляє worktree-блок у вмісті `SKILL.md`.
 * @param {string} content вміст `SKILL.md`
 * @param {boolean} enabled чи має бути блок (значення `meta.json.worktree`)
 * @returns {string} оновлений вміст (ідемпотентно)
 */
export function injectWorktreeNotice(content, enabled) {
  const hadBlock = content.includes(WORKTREE_START);
  const withoutBlock = content.replace(BLOCK_RE, "\n\n");

  if (!enabled) {
    return hadBlock ? withoutBlock : content;
  }

  const block = buildBlock(withoutBlock);
  const fm = withoutBlock.match(FRONTMATTER_RE);
  if (fm) {
    const head = fm[1];
    const rest = withoutBlock.slice(head.length).replace(/^\n+/u, "");
    return `${head}\n${block}\n\n${rest}`;
  }
  return `${block}\n\n${withoutBlock.replace(/^\n+/u, "")}`;
}

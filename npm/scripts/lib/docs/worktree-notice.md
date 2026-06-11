---
docgen:
  source: npm/scripts/lib/worktree-notice.mjs
  crc: dc4fba22
---

# worktree-notice.mjs

## Огляд

Цей файл вбудовує інструкції щодо використання git-worktree, коли `meta.json.worktree` встановлено в `true`. Він забезпечує паралельне виконання скілу лише в окремому git-worktree, запобігаючи потенційним проблемам з паралелізмом. Цей механізм дозволяє уникнути гонки з CDN та забезпечує надійний запуск скілу з локальною копією CLI.

## Поведінка

WORKTREE_START: вставляє маркер початку worktree-блоку.
WORKTREE_END: вставляє маркер кінця worktree-блоку.
injectWorktreeNotice: вставляє або видаляє worktree-блок у `SKILL.md` на основі значення `meta.json.worktree`. Якщо `meta.json.worktree` `true`, вставляє блок; інакше видаляє. Якщо блок вже існує, замінює його; якщо ні — додає. Враховує наявність YAML-frontmatter та вставляє блок після нього. Використовує транслітерацію для створення суфікса гілки. Реалізує retry-обгортку для `npx` з обмеженням часу та інтервалом для перевірки.

## Публічний API

WORKTREE_START — Початок блоку worktree.
WORKTREE_END — Кінець блоку worktree.
injectWorktreeNotice — Змінює вміст SKILL.md, додаючи, оновлюючи або видаляючи worktree-блок.

## Гарантії поведінки

Якщо `meta.json.worktree === true`, то скіл виконується в окремому git-worktree.
Скіл не паралелізується.
Після створення worktree виконується `bun install` у цьому worktree.
Виконується shell-обгортка `n_cursor_npx` навколо `npx` для bootstrap-виклику.
Обгортка `n_cursor_npx` виконує retry на транзитні помилки реєстру/мережі (інтервал 30с, дефолт 5 хв, `N_CURSOR_NPX_RETRY_MAX_MIN`, ceiling 10 хв).
При виникненні nonzero CLI повертається одразу.
Команди, що вимагають command substitution, виконуються після створення worktree.

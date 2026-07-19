---
type: JS Module
title: auto-worktree-suite.mjs
resource: npm/scripts/utils/tests/auto-worktree-suite.mjs
docgen:
  crc: 175773bb
---

## Огляд

Спільний vitest-набір для мосту auto-worktree: поведінковий контракт `bringChangesBackToOriginal`/`removeAutoCreatedWorktree` описаний в одному місці й реєструється двома тест-файлами — `scripts/lib/tests/auto-worktree.test.mjs` (прямий імпорт з `scripts/lib/auto-worktree.mjs`) та `skills/taze/js/tests/orchestrate.test.mjs` (реекспорт з `orchestrate.mjs`). Прибирає jscpd-дублікат тіл тестів між цими файлами.

## Публічний API

- `describeAutoWorktreeBridge({ bringChangesBackToOriginal, removeAutoCreatedWorktree, branch })` — реєструє два describe-блоки:
  - **bringChangesBackToOriginal** — порожній `git status` → нічого не копіює; копіювання наявного файлу і видалення відсутнього в оригіналі; перейменування (`old -> new` у porcelain) переносить лише нову назву; провал `git status` → лог-попередження без перенесення.
  - **removeAutoCreatedWorktree** — виклик `npx @7n/mt worktree remove <branch>` з `cwd=originalCwd`; провал команди не кидає, лише логує.
- `branch` — назва worktree-гілки в тестах remove (`main-lint` у lint-мосту, `main-taze` у taze).

## Гарантії поведінки

- Файл — тест-підтримка: живе під `tests/`, у tarball пакета не потрапляє (`!**/tests/**` у `files`), імпортує `vitest` і `test-helpers.mjs`.
- Викликати лише всередині vitest-контексту (реєструє describe/test на імпорт-виклику).

---
type: JS Module
title: worktree-notice.mjs
resource: npm/scripts/lib/worktree-notice.mjs
docgen:
  crc: 1f7d5e0d
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 100
---

Цей файл вшиває worktree-інструкцію у синкнутий `SKILL.md` (рішення D2 зі spec). Коли `meta.json.worktree === true`, скіл вставляє/замінює ідемпотентний ре-синкнутий блок, що містить маркери WORKTREE_START та WORKTREE_END, забезпечуючи виконання скілу в окремому git-worktree та запобігаючи паралелізації. Функція `injectWorktreeNotice` керує наявністю або відсутністю цього блоку в `SKILL.md` на основі конфігурації.

## Поведінка

WORKTREE_START — Маркер початку блоку інструкцій для роботи в окремому git-worktree.
WORKTREE_END — Маркер кінця блоку інструкцій для роботи в окремому git-worktree.
injectWorktreeNotice — Вставляє, оновлює або видаляє блок інструкцій для роботи в worktree у вмісті SKILL.md залежно від булевого значення.

## Публічний API

WORKTREE_START — Позначає початок секції, що описує робоче дерево.
WORKTREE_END — Позначає кінець секції, що описує робоче дерево.
injectWorktreeNotice — Вставляє, змінює або видаляє блок інформації про робоче дерево у файлі `SKILL.md`.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).

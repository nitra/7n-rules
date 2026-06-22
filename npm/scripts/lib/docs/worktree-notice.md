---
type: JS Module
title: worktree-notice.mjs
resource: npm/scripts/lib/worktree-notice.mjs
docgen:
  crc: b4358793
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 100
---

## Огляд

Управляє вставкою інструкцій для виконання команд у ізольованому git-worktree у синкнутий `SKILL.md` (рішення D2 зі spec). Коли `main.json.worktree === true`, інструкції вставляються між маркерами `WORKTREE_START` та `WORKTREE_END`. Це забезпечує ре-синк ідемпотентність: наявний блок замінюється, а при `main.json.worktree === false` — видаляється. Механізм адаптований для агента, який читає `SKILL.md`.

## Поведінка

WORKTREE_START: Позначає початок блоку інструкцій для роботи в окремому git-worktree.
WORKTREE_END: Позначає кінець блоку інструкцій для роботи в окремому git-worktree.
injectWorktreeNotice: Вставляє, оновлює або видаляє блок інструкцій для роботи в worktree у вмісті SKILL.md залежно від булевого значення.

## Публічний API

WORKTREE_START — Позначає початок блоку, що описує робоче дерево.
WORKTREE_END — Позначає кінець блоку, що описує робоче дерево.
injectWorktreeNotice — Додає, змінює або видаляє блок робочого дерева у файлі `SKILL.md`.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).

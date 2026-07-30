---
type: JS Module
title: auto-worktree.mjs
resource: npm/scripts/lib/auto-worktree.mjs
docgen:
  crc: 6ece78e1
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 75
---

## Поведінка

Процес ініціюється викликом `ensureRunningInWorktree`, який перевіряє стан робочого каталогу, посилаючись на конфіг `main.json`. Якщо каталог не є ізольованим worktree, ця функція створює новий worktree, виконує `bun install` та підтверджує, чи потрібно закомітити та запушити незакомічені зміни вихідного каталогу. Якщо зміни були, процес зупиняється, доки не буде отримане підтвердження (або відбувається автоматичний комміт/пуш). У разі успішного створення worktree, подальші операції виконуються в ізольованому оточенні. Після цієї фази, якщо потрібно застосувати зміни, викликається `bringChangesBackToOriginal`, який копіює незакомічені зміни з новоствореного worktree назад у вихідний каталог, працюючи з глибоким описом статусу Git. Після успішного перенесення змін, для очищення системи, викликається `removeAutoCreatedWorktree`, яка прибирає тимчасовий worktree та його гілку.

## Сценарії використання

- `npm/scripts/lib/tests/auto-worktree.test.mjs` (ensureRunningInWorktree) — вже під .worktrees/ — повертає cwd без змін, нічого не створює; вже під .claude/worktrees/ (harness Claude Code) — повертає cwd без змін, нічого не створює; поза worktree, чисте дерево — сам створює worktree і ставить залежності; гілка зі slash — worktree name і шлях sanitized через native.sanitizeWorktreeName (slash → -); detached HEAD (немає поточної гілки) — кидає, не створює worktree; ще 4

## Гарантії поведінки

- (специфічних машинно-виведених гарантій немає)

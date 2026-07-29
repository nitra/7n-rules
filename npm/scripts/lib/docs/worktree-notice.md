---
type: JS Module
title: worktree-notice.mjs
resource: npm/scripts/lib/worktree-notice.mjs
docgen:
  crc: 0298c9c9
  model: omlx/gemma-4-e2b-it-4bit
  tier: local-min
  score: 80
---

## Огляд

Вшивання worktree-інструкції у синкнутий `SKILL.md` (рішення D2 зі spec).

Коли `main.json.worktree === true`, скіл має виконуватись в окремому git-worktree
і не паралелитись. Підказка адресована агенту, який читає `SKILL.md`, тож
вставляється в текст між стабільними маркерами — ре-синк ідемпотентний:
наявний блок замінюється, при `worktree:false` — видаляється.

Крок 0.1 блоку додає `bun install` у щойно створеному дереві (локальна копія
CLI усуває гонку з CDN. Команди винесені окремим кроком ПІСЛЯ
worktree-створення, бо bootstrap не належить до «без-expansion» preflight-снипета
(узгоджено з worktree.mdc).

## Публічний API

- WORKTREE_START — Маркер початку worktree-блоку (стабільний, не залежить від тексту всередині).
- WORKTREE_END — Маркер кінця worktree-блоку.
- injectWorktreeNotice — Вставляє / оновлює / видаляє worktree-блок у вмісті `SKILL.md`.

## Сценарії використання

- `npm/scripts/lib/tests/worktree-notice.test.mjs` (injectWorktreeNotice) — worktree=true → вставляє блок після frontmatter, перед H1; worktree=true → preflight без shell expansion і з literal worktree-командами; worktree=true → root-assert ловить запуск із піддиректорії (pwd vs toplevel); worktree=true → Крок 0.1 bootstrap = bun install (без ETARGET-обгортки); worktree=true → визнає .worktrees/ і .claude/worktrees/ як; ще 8

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.

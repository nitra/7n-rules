---
kind: nitra-spec
status: draft
adr: null
plan: ../plans/2026-06-01-worktree-add-gitignore.md
---

# Sync гарантує `.worktrees/` у `.gitignore` — дизайн

Дата: 2026-06-01
Власник: @vitaliytv
Статус: Draft (очікує апруву)

## Проблема

Інструментарій `n-cursor flow`/`worktree` створює в корені репо каталог
`.worktrees/<sanit>/` та sibling-артефакти (`<name>.md`, `<branch>.flow.json`,
`.events.jsonl`, `.flow-lock-*`). Усі вони — суто локальні, ніколи не комітяться.
У **цьому** репо рядок `.worktrees/` уже закомічено в `.gitignore` вручну, тож
проблеми не видно. Але в **чужому/новому** репо після першого worktree ці файли
вилізуть у `git status` як untracked, а інвентарний `.md` легко випадково
закомітити.

## Рішення

Гарантувати наявність рядка `.worktrees/` у кореневому `.gitignore` під час
**дефолтного sync** (`npx @nitra/cursor` без аргументів) — там, де вже є усталена
конвенція керування `.gitignore` (`syncGitignoreAdrFragment`). Реалізація — через
наявну idempotent+append-only утиліту `ensureGitignoreEntries`.

### Рівень вмонтування

**Окремий top-level sync-крок** у `runSync()` (`npm/bin/n-cursor.js`), сусід
виклику Claude-конфіг — **не** всередині `syncClaudeConfig`:

- `syncClaudeConfig` за назвою/JSDoc — про Claude/Cursor-конфіг (settings, hooks,
  slash-команди); його `.gitignore`-merge існує лише для **артефактів adr-хуків**.
  `.worktrees/` — ортогональний flow-концерн, під цю назву не підпадає.
- `syncClaudeConfig` має ранній `return` при `claude-config: false`; вкладення
  `.worktrees/` туди прив'язало б ignore до цього опт-ауту, хоча flow від нього
  не залежить.

### Безумовність (без гейта — рішення b1)

Додаємо `.worktrees/` **завжди**, незалежно від `.n-cursor.json`-тумблерів —
бо продюсер артефактів (`flow`, `n-flow.mdc` → `alwaysApply: true`, і
`worktree-cli`) **завжди активний**. Гейт за окремим worktree-rule (відхилений
варіант b2) міг би розсинхронитися з продюсером: вимкнули правило, але `flow init`
далі створює `.worktrees/` → ignore-рядка нема → повертається той самий баг.

На відміну від adr, де гейт коректний, бо продюсер (adr Stop-hook) і гейт
(adr-rule) — та сама сутність.

### Деталі реалізації

- Нова тонка функція `syncGitignoreWorktree(projectRoot)` у новому модулі
  `npm/scripts/lib/sync-gitignore-worktree.mjs`; кличе
  `ensureGitignoreEntries(projectRoot, ['.worktrees/'], '<header>')`, повертає
  `{ written: boolean }`.
- Окремий `runSyncStep(...)` у `runSync()`, поряд із Claude-конфіг-кроком.
- У звіті sync додати `'.gitignore (worktree)'`, коли `written === true`
  (симетрично наявному `'.gitignore (adr fragment)'`).
- Один запис `.worktrees/` покриває каталог і всі sibling-файли (вони в ньому).

## Альтернативи (відхилено)

- **`worktree add` дописує сам (варіант A).** Заводить паралельний gitignore-
  механізм повз наявну sync-конвенцію; спрацьовує лише коли кличуть саме CLI.
- **Всередині `syncClaudeConfig`.** Хибний концерн + зчеплення з `claude-config`
  опт-аутом.
- **Гейт за worktree-rule (b2).** Може розсинхронитися з завжди-активним flow.

## Ризики

- Side-effect на `.gitignore` користувача. Мітигація: append-only + idempotent +
  header-секція (як adr-фрагмент); merge не видаляє наявні рядки.
- Зайвий ignore-рядок у репо, що worktree не використає — нешкідливий no-op.

## Перевірка

- Свіже репо без `.gitignore` → після кроку `.gitignore` містить `.worktrees/`.
- Idempotency → повторний виклик не дублює рядок.
- Наявний кастомний `.gitignore` зберігається (append-only).
